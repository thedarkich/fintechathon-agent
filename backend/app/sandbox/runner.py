"""Launch the worker: fresh interpreter (-I), empty environment, throwaway directory, own session,
wall-clock timeout, bounded output. Every run is reported back for the audit log."""

import hashlib
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from contextlib import suppress
from pathlib import Path

from app.sandbox.guard import CodeRejected, check

WALL_SECONDS = 5
MAX_OUTPUT = 256 * 1024
BACKEND = Path(__file__).resolve().parents[2]
BOOTSTRAP = "import runpy,sys;sys.path.insert(0,sys.argv[1]);runpy.run_module('app.sandbox.worker',run_name='__main__')"
LIMITS = {"memory_mb": 256, "cpu_seconds": 2, "wall_seconds": WALL_SECONDS, "files": "none", "network_modules": "blocked",
          "imports": ["math", "statistics", "datetime", "collections", "itertools"]}


class SandboxError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def code_hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def run(code: str, txns: list[dict]) -> dict:
    """Returns {'result', 'ms', 'code_hash', 'limits'}; raises SandboxError with a short code."""
    try:
        check(code)
    except CodeRejected as exc:
        raise SandboxError(f"REJECTED_{exc}") from None
    if not sys.platform.startswith("linux"):
        raise SandboxError("NEEDS_LINUX")
    payload = json.dumps({"code": code, "txns": txns}, ensure_ascii=False).encode()
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="analysis-") as directory:
        process = subprocess.Popen(
            [sys.executable, "-I", "-B", "-c", BOOTSTRAP, str(BACKEND)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, cwd=directory,
            env={"LANG": "C.UTF-8"}, start_new_session=True, close_fds=True,
        )
        try:
            out, _ = process.communicate(payload, timeout=WALL_SECONDS)
        except subprocess.TimeoutExpired:
            raise SandboxError("TIMEOUT") from None
        finally:
            with suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
    elapsed = round((time.monotonic() - started) * 1000)
    if len(out) > MAX_OUTPUT:
        raise SandboxError("OUTPUT_TOO_LARGE")
    try:
        data = json.loads(out or b"{}")
    except ValueError:
        raise SandboxError("BAD_OUTPUT") from None
    if process.returncode != 0 or "error" in data:
        raise SandboxError(f"RUNTIME_{data.get('error', 'KILLED') if isinstance(data, dict) else 'KILLED'}")
    return {"result": data, "ms": elapsed, "code_hash": code_hash(code), "limits": LIMITS}
