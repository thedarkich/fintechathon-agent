"""Single-process API. Runtime settings are loaded only during startup."""

from contextlib import asynccontextmanager
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.accounts import router as accounts
from app.api.agent import router as agent
from app.api.bank import router as bank
from app.api.demo import router as demo
from app.api.operator import router as operator
from app.api.screens import router as screens
from app.api.security import RequestBoundary, problem
from app.api.uploads import router as uploads
from app.config import Settings
from app.runtime import Runtime


def create_app(settings=None, *, runtime=None):
    @asynccontextmanager
    async def lifespan(app):
        current = runtime or Runtime(settings or Settings())
        app.state.runtime = current
        if current.settings.static_dir.is_dir():
            app.mount("/", StaticFiles(directory=current.settings.static_dir, html=True), name="frontend")
        await current.start()
        try:
            yield
        finally:
            await current.stop()

    app = FastAPI(lifespan=lifespan, title="Banking AI Agent", version="0.1.0",
                  docs_url="/api/docs", redoc_url=None, openapi_url="/api/openapi.json",
                  swagger_ui_oauth2_redirect_url="/api/docs/oauth2-redirect")  # under /api, so the docs switch covers it
    app.add_middleware(RequestBoundary)
    hosts = {"localhost", "127.0.0.1", "testserver"}

    @app.middleware("http")
    async def host_boundary(request, call_next):
        current = getattr(app.state, "runtime", None)
        configured = urlparse(current.settings.public_base_url).hostname if current else None
        if request.url.hostname not in {*hosts, configured}:
            return JSONResponse({"message_en": "Unrecognized host.", "message_zh": "未知主机。"}, status_code=400)
        return await call_next(request)

    @app.middleware("http")
    async def docs_switch(request, call_next):
        # security best practice: a deployment for real customers (demo tools off) doesn't publish the API docs
        current = getattr(app.state, "runtime", None)
        if request.url.path in {"/api/docs", "/api/docs/oauth2-redirect", "/api/openapi.json"} and current \
                and not current.settings.demo_tools_enabled:
            return JSONResponse({"message_en": "Not found.", "message_zh": "未找到。"}, status_code=404)
        return await call_next(request)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, exc):
        body = exc.detail if isinstance(exc.detail, dict) and "message_en" in exc.detail else {
            "message_en": "Request could not be completed.", "message_zh": "无法完成请求。"}
        return JSONResponse(body, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def invalid(request, exc):
        fields = sorted({str(e["loc"][-1]) for e in exc.errors() if e.get("loc")})
        return JSONResponse({"message_en": "Invalid request fields.", "message_zh": "请求字段无效。", "fields": fields},
                            status_code=422)

    @app.exception_handler(Exception)
    async def failure(request, exc):
        return JSONResponse({"message_en": "The service is temporarily unavailable.", "message_zh": "服务暂时不可用。"},
                            status_code=503)

    @app.get("/api/health")
    async def health(request: Request):
        return request.app.state.runtime.health()

    app.include_router(accounts)
    app.include_router(agent)
    app.include_router(bank)
    app.include_router(demo)
    app.include_router(operator)
    app.include_router(screens)
    app.include_router(uploads)

    @app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"], include_in_schema=False)
    async def unknown_api(path: str):
        raise problem(404, "API endpoint not found.", "未找到 API 接口。")

    return app


app = create_app()
