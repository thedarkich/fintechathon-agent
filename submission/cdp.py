"""Headless Chrome for the PDF builders: finds Chrome or Chromium, starts it with a DevTools port and drives it over the
DevTools protocol. Set CHROME to a browser's path to choose one."""
import asyncio
import json
import os
import shutil
import socket
import subprocess
import tempfile
import urllib.request
from pathlib import Path

import websockets

NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]
WINDOWS = [r"C:\Program Files\Google\Chrome\Application\chrome.exe", r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"]
LOCAL = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # the DevTools port is local: never through a proxy


def find_chrome() -> str:
    if os.environ.get("CHROME"):
        return os.environ["CHROME"]
    for name in NAMES:
        if found := shutil.which(name):
            return found
    for path in WINDOWS:
        if Path(path).exists():
            return path
    raise SystemExit("No Chrome or Chromium found: install one, or set CHROME to its path.")


class Chrome:
    """async with Chrome() as chrome: await chrome.open(page); await chrome.pdf(out, ...)"""

    async def __aenter__(self):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.profile = tempfile.mkdtemp(prefix="pdf-chrome-")
        args = [find_chrome(), "--headless=new", f"--remote-debugging-port={self.port}", f"--user-data-dir={self.profile}",
                "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--allow-file-access-from-files"]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            args.append("--no-sandbox")  # cloud VMs run as root, where Chrome's sandbox won't start
        self.process = subprocess.Popen([*args, "about:blank"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(120):
            try:
                pages = json.load(LOCAL.open(f"http://127.0.0.1:{self.port}/json/list", timeout=2))
                break
            except OSError:
                await asyncio.sleep(0.25)
        else:
            raise SystemExit("Chrome didn't start.")
        url = next(p for p in pages if p["type"] == "page")["webSocketDebuggerUrl"]
        try:
            self.ws = await websockets.connect(url, max_size=256 * 1024 * 1024, proxy=None)
        except TypeError:  # websockets before 15 has no proxy option and never uses one
            self.ws = await websockets.connect(url, max_size=256 * 1024 * 1024)
        self.n = 0
        await self.send("Page.enable")
        await self.send("Runtime.enable")
        return self

    async def __aexit__(self, *exc):
        await self.ws.close()
        self.process.terminate()
        try:
            self.process.wait(10)
        except subprocess.TimeoutExpired:
            self.process.kill()
        shutil.rmtree(self.profile, ignore_errors=True)

    async def send(self, method, **params):
        self.n += 1
        mid = self.n
        await self.ws.send(json.dumps({"id": mid, "method": method, "params": params}))
        while True:
            msg = json.loads(await self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    async def js(self, expression):
        result = await self.send("Runtime.evaluate", expression=expression, awaitPromise=True, returnByValue=True)
        return result["result"].get("value")

    async def open(self, page: Path, settle: float = 3):
        """Opens a local HTML file and waits for its fonts; returns the font families that loaded and broken images."""
        await self.send("Page.navigate", url=page.resolve().as_uri())
        await asyncio.sleep(settle)
        await self.js("document.fonts.ready.then(() => true)")
        await asyncio.sleep(1)
        return await self.js("({fonts: [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))],"
                             " broken: [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.src.slice(-40))})")
