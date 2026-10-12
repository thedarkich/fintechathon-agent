"""Static checks on generated analysis code before it may run (docs/SPEC.md §9).

Only a small, side-effect-free subset of Python is accepted: no imports outside an allow-list,
no dunder names or private attributes, no file, network, process or reflection built-ins.
"""

import ast

MAX_CODE = 4000
ALLOWED_MODULES = {"math", "statistics", "datetime", "collections", "itertools"}
BANNED_NAMES = {
    "open", "exec", "eval", "compile", "__import__", "input", "globals", "locals", "vars", "getattr",
    "setattr", "delattr", "hasattr", "breakpoint", "help", "exit", "quit", "memoryview", "type", "object",
    "super", "classmethod", "staticmethod", "property", "dir", "id", "bytes", "bytearray", "print",
}
# Frame and generator internals (reachable without underscores) and format-string attribute access.
BANNED_ATTRIBUTES = {
    "gi_frame", "gi_code", "gi_yieldfrom", "cr_frame", "cr_code", "ag_frame", "ag_code", "f_globals", "f_locals",
    "f_back", "f_builtins", "f_code", "tb_frame", "tb_next", "format", "format_map", "mro",
}
ALLOWED_NODES = (
    ast.Module, ast.FunctionDef, ast.arguments, ast.arg, ast.Return, ast.Assign, ast.AugAssign, ast.AnnAssign,
    ast.For, ast.While, ast.If, ast.Break, ast.Continue, ast.Pass, ast.Expr, ast.BoolOp, ast.BinOp, ast.UnaryOp,
    ast.Lambda, ast.IfExp, ast.Dict, ast.Set, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp,
    ast.Compare, ast.Call, ast.keyword, ast.Constant, ast.Attribute, ast.Subscript, ast.Slice, ast.Name,
    ast.List, ast.Tuple, ast.Load, ast.Store, ast.Del, ast.comprehension, ast.Import, ast.ImportFrom, ast.alias,
    ast.And, ast.Or, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow, ast.USub, ast.UAdd,
    ast.Not, ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.In, ast.NotIn, ast.Is, ast.IsNot,
    ast.JoinedStr, ast.FormattedValue,
)


class CodeRejected(ValueError):
    pass


def check(code: str) -> None:
    if not code or len(code) > MAX_CODE:
        raise CodeRejected("CODE_SIZE")
    try:
        tree = ast.parse(code, mode="exec")
    except SyntaxError:
        raise CodeRejected("CODE_SYNTAX") from None
    defines_answer = False
    for node in ast.walk(tree):
        if not isinstance(node, ALLOWED_NODES):
            raise CodeRejected(f"NODE_{type(node).__name__.upper()}")
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] not in ALLOWED_MODULES:
                    raise CodeRejected("IMPORT")
        if isinstance(node, ast.ImportFrom):
            if (node.module or "").split(".")[0] not in ALLOWED_MODULES or node.level:
                raise CodeRejected("IMPORT")
        if isinstance(node, ast.Name) and (node.id in BANNED_NAMES or node.id.startswith("__")):
            raise CodeRejected("NAME")
        if isinstance(node, ast.Attribute) and (node.attr.startswith("_") or node.attr in BANNED_ATTRIBUTES):
            raise CodeRejected("ATTRIBUTE")
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and "__" in node.value:
            raise CodeRejected("DUNDER_STRING")
        if isinstance(node, ast.alias) and (node.asname or "").startswith("_"):
            raise CodeRejected("NAME")
        if isinstance(node, ast.FunctionDef) and node.name == "answer" and node in tree.body:
            defines_answer = True
    if not defines_answer:
        raise CodeRejected("NO_ANSWER_FUNCTION")
