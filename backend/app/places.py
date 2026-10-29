"""Real places near the customer, from three sources asked at once: Amap (高德地图), Tencent Location Service (腾讯位置
服务, the maps inside WeChat) and OpenStreetMap (through its Nominatim search). Amap and Tencent answer once their key
is set; OpenStreetMap needs none.

The same place from two sources (matching names, under 150 m apart) becomes one, keeping what each knows: Amap's
rating and average spend, a phone number from whichever has one. Amap and Tencent work in China's GCJ-02 coordinates,
browsers and OpenStreetMap in WGS-84, so positions are converted both ways.

What comes back is data shown to the customer, never text for the model: a place's name can't instruct anything.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import logging
import math
import re
import time
from dataclasses import asdict, dataclass, field
from urllib.parse import urlencode, urlsplit

import httpx

log = logging.getLogger(__name__)

# Futian, Shenzhen: where a search looks when the visitor doesn't share a location
FALLBACK = (22.5431, 114.0579)
FALLBACK_LABEL = ("深圳福田中心区", "Futian, Shenzhen")
USER_AGENT = "CentralUnionBankDemo/1.0 (+https://github.com/thedarkich/fintechathon-agent)"
TIMEOUT = 8.0
RADIUS = 3000
MERGE_METRES = 150
LIMIT = 10
CACHE_SECONDS = 600
SOURCES = ("amap", "qq", "osm")
PHOTOS = 3  # per place
PHOTO_BYTES = 3_000_000
PHOTO_WIDTH = 320  # pixels: Amap's images come resized (its originals run to 2000 pixels and 600 KB)
PHOTO_CACHE = 200  # photos kept in memory, for a card that loads again
NAMED_RADIUS = 50_000  # metres: how far from the customer a named place ('万象城') is looked for
# where a place's photos may come from: Amap's image servers, and Wikimedia for the odd OpenStreetMap place with a picture
PHOTO_HOSTS = (".autonavi.com", ".amap.com")
# Hong Kong and Macau, separate from the mainland and from each other: a shop in one can't take an order or a booking
# from across the boundary
SAR = ("CN-HK", "CN-MO")


@dataclass
class Place:
    id: str  # "amap:B0FFG…", "qq:123…", "osm:node/123…"
    name: str
    lat: float  # WGS-84
    lon: float
    address: str = ""
    category: str = ""
    phone: str = ""
    rating: float | None = None
    cost_yuan: float | None = None  # average spend per person (Amap's 人均)
    hours: str = ""
    name_en: str = ""
    sources: list[str] = field(default_factory=list)
    photos: list[str] = field(default_factory=list)  # the services' own image addresses, fetched only through photo()
    distance_m: int | None = None
    region: str = ""  # "cn" for the mainland, or one of SAR, when the source says (OpenStreetMap does)


class SourceError(Exception):
    pass


# --- China's GCJ-02 offset (the published conversion, accurate to about a metre) ---

_A, _EE = 6378245.0, 0.00669342162296594323


def _in_china(lat: float, lon: float) -> bool:
    return 73.66 < lon < 135.05 and 3.86 < lat < 53.55


def _offset(lat: float, lon: float) -> tuple[float, float]:
    x, y = lon - 105.0, lat - 35.0
    dlat = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * math.sqrt(abs(x))
    dlat += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    dlat += (20.0 * math.sin(y * math.pi) + 40.0 * math.sin(y / 3.0 * math.pi)) * 2.0 / 3.0
    dlat += (160.0 * math.sin(y / 12.0 * math.pi) + 320.0 * math.sin(y * math.pi / 30.0)) * 2.0 / 3.0
    dlon = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * math.sqrt(abs(x))
    dlon += (20.0 * math.sin(6.0 * x * math.pi) + 20.0 * math.sin(2.0 * x * math.pi)) * 2.0 / 3.0
    dlon += (20.0 * math.sin(x * math.pi) + 40.0 * math.sin(x / 3.0 * math.pi)) * 2.0 / 3.0
    dlon += (150.0 * math.sin(x / 12.0 * math.pi) + 300.0 * math.sin(x / 30.0 * math.pi)) * 2.0 / 3.0
    rad = lat / 180.0 * math.pi
    magic = 1 - _EE * math.sin(rad) ** 2
    root = math.sqrt(magic)
    dlat = dlat * 180.0 / (_A * (1 - _EE) / (magic * root) * math.pi)
    dlon = dlon * 180.0 / (_A / root * math.cos(rad) * math.pi)
    return dlat, dlon


def wgs_to_gcj(lat: float, lon: float) -> tuple[float, float]:
    if not _in_china(lat, lon):
        return lat, lon
    dlat, dlon = _offset(lat, lon)
    return lat + dlat, lon + dlon


def gcj_to_wgs(lat: float, lon: float) -> tuple[float, float]:
    """The inverse has no closed form: step back by the offset found where the guess lands, three times over."""
    if not _in_china(lat, lon):
        return lat, lon
    wlat, wlon = lat, lon
    for _ in range(3):
        glat, glon = wgs_to_gcj(wlat, wlon)
        wlat, wlon = wlat - (glat - lat), wlon - (glon - lon)
    return wlat, wlon


def metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    rad = math.radians
    a = math.sin(rad(lat2 - lat1) / 2) ** 2 + math.cos(rad(lat1)) * math.cos(rad(lat2)) * math.sin(rad(lon2 - lon1) / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(a))


# --- what to ask each source ---

# plain words for a kind of place, and what OpenStreetMap calls it (Nominatim matches these words to the place's tag)
KINDS = [
    ("restaurant", "餐厅", ("餐厅", "饭店", "餐馆", "饭馆", "吃饭", "美食", "好吃的", "吃的", "restaurant", "restaurants", "food",
                           "dinner", "lunch", "eat")),
    ("cafe", "咖啡", ("咖啡", "咖啡店", "咖啡馆", "cafe", "café", "coffee")),
    ("florist", "花店", ("花店", "鲜花", "鲜花店", "florist", "flowers", "flower shop")),
    ("bakery", "蛋糕店", ("蛋糕", "蛋糕店", "面包", "面包店", "烘焙", "bakery", "cake", "cakes")),
    ("bar", "酒吧", ("酒吧", "bar", "pub")),
    ("hotel", "酒店", ("酒店", "宾馆", "hotel")),
    ("supermarket", "超市", ("超市", "supermarket")),
    ("gift shop", "礼品店", ("礼品店", "礼品", "礼物", "gift shop", "gifts")),
    ("atm", "ATM", ("atm", "取款机", "自动取款机")),
    ("bank", "银行", ("银行网点", "银行", "bank", "bank branch")),
]


def terms(query: str) -> tuple[str, str]:
    """(the words for Amap and Tencent, which index Chinese; the words for OpenStreetMap)."""
    folded = query.strip().casefold()
    for osm, zh, words in KINDS:
        if folded in words:
            return zh, osm
    return query.strip(), query.strip()


def _text(value) -> str:
    # Amap writes a missing field as an empty list
    if isinstance(value, list):
        value = ";".join(str(v) for v in value if v)
    return str(value or "").strip()


def _number(value) -> float | None:
    try:
        number = float(_text(value))
    except ValueError:
        return None
    return number if number > 0 else None


def _last(value: str, separators: str) -> str:
    parts = [p for p in re.split(f"[{re.escape(separators)}]", _text(value)) if p]
    return parts[-1] if parts else ""


async def amap(client: httpx.AsyncClient, key: str, query: str, lat: float, lon: float, radius: int) -> list[Place]:
    glat, glon = wgs_to_gcj(lat, lon)
    response = await client.get("https://restapi.amap.com/v5/place/around", params={
        "key": key, "keywords": query, "location": f"{glon:.6f},{glat:.6f}", "radius": radius, "sortrule": "distance",
        "page_size": 20, "show_fields": "business,photos"})
    data = response.json()
    if str(data.get("status")) != "1":
        raise SourceError(str(data.get("infocode") or "amap"))
    found = []
    for poi in data.get("pois") or []:
        location = _text(poi.get("location")).split(",")
        if len(location) != 2 or not poi.get("id") or not _text(poi.get("name")):
            continue
        plat, plon = gcj_to_wgs(float(location[1]), float(location[0]))
        business = poi.get("business") or poi.get("biz_ext") or {}
        found.append(Place(id=f"amap:{poi['id']}", name=_text(poi["name"]), lat=plat, lon=plon,
                           address=_text(poi.get("address")), category=_last(poi.get("type"), ";|"),
                           phone=_text(business.get("tel") or poi.get("tel")), rating=_number(business.get("rating")),
                           cost_yuan=_number(business.get("cost")),
                           hours=_text(business.get("opentime_today") or business.get("opentime_week")), sources=["amap"],
                           photos=[url for url in (_text(p.get("url")) for p in poi.get("photos") or [] if isinstance(p, dict))
                                   if photo_allowed(url)][:PHOTOS]))
    return found


def qq_signed(path: str, params: dict, secret: str) -> dict:
    """Tencent's request signature: the path, the parameters sorted by name (unencoded) and the secret, MD5'd."""
    if not secret:
        return params
    joined = "&".join(f"{k}={params[k]}" for k in sorted(params))
    return {**params, "sig": hashlib.md5(f"{path}?{joined}{secret}".encode()).hexdigest()}


async def qq(client: httpx.AsyncClient, key: str, secret: str, query: str, lat: float, lon: float, radius: int) -> list[Place]:
    glat, glon = wgs_to_gcj(lat, lon)
    path = "/ws/place/v1/search"
    params = qq_signed(path, {"key": key, "keyword": query, "boundary": f"nearby({glat:.6f},{glon:.6f},{radius},1)",
                              "page_size": "20", "page_index": "1", "orderby": "_distance"}, secret)
    data = (await client.get(f"https://apis.map.qq.com{path}", params=params)).json()
    if data.get("status") != 0:
        raise SourceError(str(data.get("status") or "qq"))
    found = []
    for poi in data.get("data") or []:
        location = poi.get("location") or {}
        if "lat" not in location or "lng" not in location or not poi.get("id") or not _text(poi.get("title")):
            continue
        plat, plon = gcj_to_wgs(float(location["lat"]), float(location["lng"]))
        found.append(Place(id=f"qq:{poi['id']}", name=_text(poi["title"]), lat=plat, lon=plon,
                           address=_text(poi.get("address")), category=_last(poi.get("category"), ":"),
                           phone=_text(poi.get("tel")), sources=["qq"]))
    return found


OSM_TYPES = {"restaurant": ("餐厅", "Restaurant"), "cafe": ("咖啡馆", "Cafe"), "fast_food": ("快餐", "Fast food"),
             "bar": ("酒吧", "Bar"), "pub": ("酒吧", "Pub"), "food_court": ("美食广场", "Food court"),
             "florist": ("花店", "Florist"), "bakery": ("面包店", "Bakery"), "confectionery": ("甜品店", "Sweets"),
             "hotel": ("酒店", "Hotel"), "supermarket": ("超市", "Supermarket"), "atm": ("ATM", "ATM"), "bank": ("银行", "Bank")}
# Amap's and Tencent's categories come only in Chinese: the common ones, for the English screen (others stay as they are)
CATEGORY_EN = {
    "餐饮相关": "Restaurant", "中餐厅": "Chinese restaurant", "综合酒楼": "Chinese restaurant", "火锅店": "Hot pot",
    "火锅": "Hot pot", "海鲜酒楼": "Seafood", "四川菜(川菜)": "Sichuan", "川菜": "Sichuan", "广东菜(粤菜)": "Cantonese",
    "粤菜": "Cantonese", "湖南菜(湘菜)": "Hunan", "湘菜": "Hunan", "潮州菜": "Chaozhou", "东北菜": "Northeastern",
    "茶餐厅": "Hong Kong café", "快餐厅": "Fast food", "外国餐厅": "International", "西餐厅": "Western",
    "日本料理": "Japanese", "韩国料理": "Korean", "咖啡厅": "Café", "咖啡": "Café", "茶艺馆": "Teahouse",
    "冷饮店": "Drinks", "甜品店": "Desserts", "糕饼店": "Bakery", "面包甜点": "Bakery", "烧烤": "Barbecue",
    "酒吧": "Bar", "花卉": "Florist", "花卉市场": "Florist", "花店": "Florist", "礼品饰品店": "Gift shop",
    "超级市场": "Supermarket", "超市": "Supermarket", "银行": "Bank", "自动提款机": "ATM",
}


def _osm_region(address: dict) -> str:
    code = address.get("ISO3166-2-lvl3") or address.get("ISO3166-2-lvl4") or ""
    return code if code in SAR else _text(address.get("country_code")).lower()


def _osm_address(address: dict, lang: str) -> str:
    """A short address: district, road and number run together in Chinese; number, road, district in English."""
    district = address.get("city_district") or address.get("suburb") or address.get("quarter") or ""
    road = address.get("road") or address.get("pedestrian") or ""
    number = address.get("house_number", "")
    if lang == "zh":
        return f"{district}{road}{number}".strip()
    return ", ".join(p for p in (f"{number} {road}".strip(), district) if p)


async def osm(client: httpx.AsyncClient, base: str, query: str, lat: float, lon: float, radius: int, lang: str) -> list[Place]:
    dlat = radius / 111_320
    dlon = radius / (111_320 * max(math.cos(math.radians(lat)), 0.2))
    data = (await client.get(f"{base}/search", params={
        "q": query, "viewbox": f"{lon - dlon:.6f},{lat + dlat:.6f},{lon + dlon:.6f},{lat - dlat:.6f}", "bounded": 1,
        "format": "jsonv2", "limit": 20, "extratags": 1, "namedetails": 1, "addressdetails": 1,
        "accept-language": "zh-CN,zh" if lang == "zh" else "en"})).json()
    if not isinstance(data, list):
        raise SourceError("osm")
    found = []
    for item in data:
        names = item.get("namedetails") or {}
        name = _text(names.get("name") or item.get("name"))
        if not name or item.get("category") not in ("amenity", "shop", "tourism", "leisure"):
            continue
        extra = item.get("extratags") or {}
        cuisine = _text(extra.get("cuisine")).replace("_", " ")
        found.append(Place(id=f"osm:{item.get('osm_type', 'node')}/{item.get('osm_id')}", name=name,
                           lat=float(item["lat"]), lon=float(item["lon"]), address=_osm_address(item.get("address") or {}, lang),
                           category=OSM_TYPES.get(_text(item.get("type")), ("", ""))[0 if lang == "zh" else 1] or cuisine,
                           phone=_text(extra.get("phone") or extra.get("contact:phone")),
                           hours=_text(extra.get("opening_hours")), name_en=_text(names.get("name:en")), sources=["osm"],
                           region=_osm_region(item.get("address") or {}),
                           photos=[url for url in (_text(extra.get("image")),) if photo_allowed(url)]))
    return found


async def _again(call, *args):
    """A map service's answer, asked once more after a moment if the first try fails (a busy moment, a new key's
    request limit)."""
    try:
        return await call(*args)
    except (SourceError, httpx.HTTPError):
        await asyncio.sleep(0.4)
        return await call(*args)


async def _image(client: httpx.AsyncClient, url: str) -> tuple[bytes, str] | None:
    try:
        async with client.stream("GET", url) as response:
            kind = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if response.status_code != 200 or kind not in ("image/jpeg", "image/png", "image/webp", "image/gif"):
                return None
            body = b""
            async for chunk in response.aiter_bytes():
                body += chunk
                if len(body) > PHOTO_BYTES:
                    return None
            return body, kind
    except httpx.HTTPError:
        return None


def photo_allowed(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    return parts.scheme in ("http", "https") and (host.endswith(PHOTO_HOSTS) or host == "upload.wikimedia.org")


# --- merging ---

def _base(name: str) -> str:
    """'海底捞火锅(中航天虹店)' → '海底捞火锅': the brand without the branch, spaces and punctuation."""
    name = re.sub(r"[（(【\[].*?[)）】\]]", "", name)
    return re.sub(r"[\s·・,，.。'’\-_/]", "", name).casefold()


def same(a: Place, b: Place) -> bool:
    if metres(a.lat, a.lon, b.lat, b.lon) > MERGE_METRES:
        return False
    x, y = _base(a.name), _base(b.name)
    return bool(x and y) and (x == y or (min(len(x), len(y)) >= 2 and (x in y or y in x)))


def merge(groups: list[list[Place]]) -> list[Place]:
    """One entry per place, in source order (Amap, Tencent, OpenStreetMap): the first keeps its id and name, and each
    later source fills what it leaves empty."""
    merged: list[Place] = []
    for place in (p for group in groups for p in group):
        twin = next((m for m in merged if same(m, place)), None)
        if twin is None:
            merged.append(place)
            continue
        for name in ("address", "category", "phone", "hours", "name_en", "region"):
            if not getattr(twin, name) and getattr(place, name):
                setattr(twin, name, getattr(place, name))
        twin.rating = twin.rating or place.rating
        twin.cost_yuan = twin.cost_yuan or place.cost_yuan
        twin.sources += [s for s in place.sources if s not in twin.sources]
        twin.photos = (twin.photos + [u for u in place.photos if u not in twin.photos])[:PHOTOS]
    return merged


class Places:
    """The sources this server can ask, a short memory of answers, and OpenStreetMap's one-request-a-second rule."""

    def __init__(self, settings, *, transport: httpx.AsyncBaseTransport | None = None):
        self.amap_key = settings.amap_key.get_secret_value()
        self.qq_key = settings.qqmap_key.get_secret_value()
        self.qq_secret = settings.qqmap_sk.get_secret_value()
        self.osm_base = settings.nominatim_url.rstrip("/") if settings.places_osm else ""
        self.transport = transport
        self.cache: dict[tuple, tuple[float, list[Place], dict]] = {}
        self.regions: dict[tuple, str] = {}
        self.photos: dict[str, tuple[bytes, str]] = {}
        self._shared: tuple[asyncio.AbstractEventLoop, httpx.AsyncClient] | None = None
        self._osm_lock: asyncio.Lock | None = None
        self._osm_last = 0.0

    def enabled(self) -> dict[str, bool]:
        return {"amap": bool(self.amap_key), "qq": bool(self.qq_key), "osm": bool(self.osm_base)}

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=TIMEOUT, transport=self.transport, headers={"User-Agent": USER_AGENT},
                                 follow_redirects=False)

    @contextlib.asynccontextmanager
    async def connection(self):
        """The one client the server keeps open to the map services: on a slow link a new encrypted connection takes
        longer than the request itself (1.8 s of 2.4 s, measured to Amap on 29 October)."""
        loop = asyncio.get_running_loop()
        if self._shared is None or self._shared[0] is not loop or self._shared[1].is_closed:
            self._shared = (loop, self.client())
        yield self._shared[1]

    async def close(self):
        if self._shared and not self._shared[1].is_closed:
            await self._shared[1].aclose()
        self._shared = None

    async def _osm_turn(self):
        """Nominatim's usage policy allows one request a second from an application."""
        if self._osm_lock is None:
            self._osm_lock = asyncio.Lock()
        async with self._osm_lock:
            wait = self._osm_last + 1.1 - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self._osm_last = time.monotonic()

    async def _osm(self, client, query, lat, lon, radius, lang):
        await self._osm_turn()
        return await osm(client, self.osm_base, query, lat, lon, radius, lang)

    async def search(self, query: str, lat: float, lon: float, *, radius: int = RADIUS, lang: str = "zh"
                     ) -> tuple[list[Place], dict[str, str]]:
        """Up to LIMIT places, nearest first, and how each source did: ok, failed or off."""
        key = (query, round(lat, 3), round(lon, 3), radius, lang)
        hit = self.cache.get(key)
        if hit and time.monotonic() - hit[0] < CACHE_SECONDS:
            return [Place(**asdict(p)) for p in hit[1]], dict(hit[2])
        china, world = terms(query)
        on = self.enabled()
        status = {name: "off" for name in SOURCES}
        async with self.connection() as client:
            calls = {}
            if on["amap"]:
                calls["amap"] = _again(amap, client, self.amap_key, china, lat, lon, radius)
            if on["qq"]:
                calls["qq"] = _again(qq, client, self.qq_key, self.qq_secret, china, lat, lon, radius)
            if on["osm"]:
                calls["osm"] = self._osm(client, world, lat, lon, radius, lang)
            answers = await asyncio.gather(*calls.values(), return_exceptions=True)
        groups = []
        for name, answer in zip(calls, answers, strict=True):
            # an error's text can carry the request (and its key): only the service's own code is logged
            status[name] = "failed" if isinstance(answer, BaseException) else "ok"
            if isinstance(answer, BaseException):
                log.warning("places: %s failed (%s)", name, answer if isinstance(answer, SourceError) else type(answer).__name__)
            groups.append([] if isinstance(answer, BaseException) else answer)
        places = merge(groups)
        for place in places:
            place.distance_m = round(metres(lat, lon, place.lat, place.lon))
        places = sorted((p for p in places if p.distance_m <= radius * 1.2), key=lambda p: p.distance_m)[:LIMIT]
        if any(p.region in SAR for p in places):  # near Hong Kong or Macau: only places in the customer's own region
            here = await self.region(lat, lon)
            places = [p for p in places if not p.region or p.region == here]
        if any(s == "ok" for s in status.values()):
            if len(self.cache) > 200:
                self.cache.pop(next(iter(self.cache)))
            self.cache[key] = (time.monotonic(), places, status)
        return places, status

    async def region(self, lat: float, lon: float) -> str:
        """Which region a point is in ("cn" for the mainland, or one of SAR), from OpenStreetMap; the mainland when
        it can't tell, as the bank's customers are there."""
        if (lat, lon) == FALLBACK:
            return "cn"
        key = (round(lat, 3), round(lon, 3))
        if key not in self.regions:
            try:
                await self._osm_turn()
                async with self.connection() as client:
                    data = (await client.get(f"{self.osm_base}/reverse", params={
                        "lat": f"{lat:.5f}", "lon": f"{lon:.5f}", "format": "jsonv2", "zoom": 10, "addressdetails": 1})).json()
                region = _osm_region(data.get("address") or {})
            except (httpx.HTTPError, ValueError, AttributeError):
                return "cn"
            if len(self.regions) > 500:
                self.regions.pop(next(iter(self.regions)))
            self.regions[key] = region or "cn"
        return self.regions[key]

    async def photo(self, url: str) -> tuple[bytes, str] | None:
        """A place's photo for the customer's page (the page itself loads nothing from outside): only from the allowed
        hosts, only a raster image, at most PHOTO_BYTES. Amap's come resized to PHOTO_WIDTH (the original if that fails),
        and the latest few are kept."""
        if not photo_allowed(url):
            return None
        if (kept := self.photos.pop(url, None)) is not None:
            self.photos[url] = kept
            return kept
        async with self.connection() as client:
            got = None
            if (urlsplit(url).hostname or "").endswith(PHOTO_HOSTS):
                got = await _image(client, f"{url}{'&' if '?' in url else '?'}x-oss-process=image/resize,w_{PHOTO_WIDTH}")
            got = got or await _image(client, url)
        if got:
            if len(self.photos) >= PHOTO_CACHE:
                self.photos.pop(next(iter(self.photos)))
            self.photos[url] = got
        return got

    async def _amap_locate(self, client, text, lang, centre):
        # Amap's place search knows '武汉大学' across China (its address lookup puts it in Zhuhai first); a name it
        # can't place nationally ('万象城', a chain) is looked for near the customer
        glat, glon = wgs_to_gcj(*centre)
        for path, params in (("/v5/place/text", {}),
                             ("/v5/place/around", {"location": f"{glon:.6f},{glat:.6f}", "radius": NAMED_RADIUS})):
            data = (await client.get(f"https://restapi.amap.com{path}", params={
                "key": self.amap_key, "keywords": text, "page_size": 1, **params})).json()
            pois = data.get("pois") or []
            if str(data.get("status")) == "1" and pois and "," in _text(pois[0].get("location")):
                lon, lat = (float(v) for v in _text(pois[0]["location"]).split(","))
                return gcj_to_wgs(lat, lon)
        return None

    async def _qq_locate(self, client, text, lang, centre):
        path = "/ws/geocoder/v1/"
        data = (await client.get(f"https://apis.map.qq.com{path}",
                                 params=qq_signed(path, {"key": self.qq_key, "address": text}, self.qq_secret))).json()
        location = (data.get("result") or {}).get("location") or {}
        if data.get("status") == 0 and "lat" in location:
            return gcj_to_wgs(float(location["lat"]), float(location["lng"]))
        return None

    async def _osm_locate(self, client, text, lang, centre):
        await self._osm_turn()
        data = (await client.get(f"{self.osm_base}/search", params={
            "q": text, "format": "jsonv2", "limit": 1, "countrycodes": "cn", "accept-language": "zh-CN,zh" if lang == "zh" else "en"})).json()
        if isinstance(data, list) and data:
            return float(data[0]["lat"]), float(data[0]["lon"])
        return None

    async def locate(self, text: str, lang: str = "zh", centre: tuple[float, float] = FALLBACK) -> tuple[float, float] | None:
        """Where a place the customer names is ('武汉大学'), WGS-84: Amap, then Tencent, then OpenStreetMap, each one
        asked only when the one before doesn't know it. The centre (the customer's location) settles a name with many
        places."""
        on = self.enabled()
        async with self.connection() as client:
            for name, ask in (("amap", self._amap_locate), ("qq", self._qq_locate), ("osm", self._osm_locate)):
                if not on[name]:
                    continue
                try:
                    if found := await ask(client, text, lang, centre):
                        return found
                except (httpx.HTTPError, ValueError, KeyError, TypeError):
                    continue
        return None


def view(place: Place, rank: int, lang: str) -> dict:
    """What the customer's screen gets: the place, and a link to it on Amap's map (which works in any browser)."""
    glat, glon = wgs_to_gcj(place.lat, place.lon)
    name = place.name_en if lang == "en" and place.name_en else place.name
    return {"rank": rank, "id": place.id, "name": name, "name_local": place.name, "address": place.address,
            "category": CATEGORY_EN.get(place.category, place.category) if lang == "en" else place.category,
            "phone": place.phone, "rating": place.rating, "cost_yuan": place.cost_yuan,
            "hours": place.hours, "sources": place.sources, "distance_m": place.distance_m,
            "photos": ["/api/places/photo?" + urlencode({"id": place.id, "n": n}) for n in range(len(place.photos))],
            "map_url": "https://uri.amap.com/marker?" + urlencode({"position": f"{glon:.6f},{glat:.6f}", "name": place.name,
                                                                    "callnative": 0})}
