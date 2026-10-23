"""Runs one checked analysis function in a fresh interpreter. Limits are installed before anything
else; the only input is stdin (the code and the customer's own transactions), the only output is
one JSON result on stdout."""

import json
import resource
import sys


def limit_resources():
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
    resource.setrlimit(resource.RLIMIT_NOFILE, (16, 16))


SAFE_BUILTINS = {
    name: __builtins__[name] if isinstance(__builtins__, dict) else getattr(__builtins__, name)
    for name in ("abs", "all", "any", "bool", "dict", "enumerate", "filter", "float", "int", "len", "list", "map",
                 "max", "min", "range", "reversed", "round", "set", "sorted", "str", "sum", "tuple", "zip",
                 "isinstance", "divmod", "ValueError", "KeyError", "ZeroDivisionError", "Exception")
}
ALLOWED = {"math", "statistics", "datetime", "collections", "itertools"}
# imported by the standard library itself (datetime.strptime needs it), never by the checked code: guard.py rejects it
INTERNAL = {"_strptime"}


def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):  # noqa: A002
    if level or name.split(".")[0] not in ALLOWED | INTERNAL:
        raise ImportError("module not allowed")
    return __import__(name, globals, locals, fromlist, level)


def clean(result):
    if not isinstance(result, dict) or not isinstance(result.get("title"), str):
        raise ValueError("answer() must return a dict with a title")
    value = result.get("value")
    if value is not None and not isinstance(value, int | float):
        raise ValueError("value must be a number")
    rows = []
    for row in list(result.get("rows") or [])[:50]:
        label, number = row[0], row[1]
        if not isinstance(number, int | float):
            raise ValueError("row values must be numbers")
        rows.append([str(label)[:60], round(float(number), 2)])
    unit = result.get("unit") if result.get("unit") in ("yuan", "count", "percent") else "yuan"
    return {"title": result["title"][:120], "value": None if value is None else round(float(value), 2),
            "rows": rows, "unit": unit}


def main():
    limit_resources()
    payload = json.loads(sys.stdin.read(8 * 1024 * 1024))
    builtins = dict(SAFE_BUILTINS, __import__=guarded_import)
    scope = {"__builtins__": builtins}
    exec(compile(payload["code"], "<analysis>", "exec"), scope)  # noqa: S102 - checked code, restricted builtins
    result = clean(scope["answer"](payload["txns"]))
    sys.stdout.write(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Only the error type leaves the worker, never data or tracebacks.
        sys.stdout.write(json.dumps({"error": type(exc).__name__}))
        sys.exit(2)
