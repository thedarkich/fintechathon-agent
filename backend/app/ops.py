"""Small operational commands. No secret values are printed."""

import argparse
import json
import os
import sqlite3
from pathlib import Path
from urllib.request import urlopen


def backup(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if not source.is_file():
        raise ValueError("Database does not exist")
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as incoming:
        with sqlite3.connect(destination) as outgoing:
            incoming.backup(outgoing)
            if outgoing.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise ValueError("Backup integrity check failed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("serve")
    commands.add_parser("liveness")
    commands.add_parser("check")
    operator = commands.add_parser("make-operator")
    operator.add_argument("email")
    backup_parser = commands.add_parser("backup")
    backup_parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    if args.command == "liveness":
        with urlopen("http://127.0.0.1:8000/api/health", timeout=3) as response:
            if not isinstance(json.load(response).get("ok"), bool):
                raise SystemExit(1)
        return
    from app.config import Settings

    settings = Settings()
    if args.command == "backup":
        backup(settings.data_dir / "bank.db", args.destination)
        print("Database backup verified. Protect it: it holds customer data.")
    elif args.command == "make-operator":
        from sqlmodel import Session, select

        from app.db import make_engine
        from app.models import UserAccount

        with Session(make_engine(settings.data_dir / "bank.db")) as session:
            user = session.exec(select(UserAccount).where(UserAccount.email == args.email.strip().lower())).first()
            if user is None:
                raise SystemExit("No account with that email.")
            user.operator = True
            session.add(user)
            session.commit()
        print("Operator access granted.")
    elif args.command == "check":
        print(json.dumps({
            "llm_enabled": settings.llm_enabled,
            "ai_configured": bool(settings.ai_base_url and settings.ai_model and settings.ai_api_key.get_secret_value()),
            "admin_configured": len(settings.admin_token.get_secret_value()) >= 32,
            "privacy_salt_configured": len(settings.ip_hash_salt.get_secret_value()) >= 32,
            "public_base_url": settings.public_base_url,
            "passkey_rp_id": settings.passkey_rp_id,
            "demo_tools_enabled": settings.demo_tools_enabled,
            "static_build_present": (settings.static_dir / "index.html").is_file(),
        }, indent=2))
    elif args.command == "serve":
        import uvicorn

        settings.data_dir.mkdir(parents=True, exist_ok=True)
        uvicorn.run("app.main:app", host="0.0.0.0", port=8000, workers=1, proxy_headers=False, access_log=False,
                    log_level="warning")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        print(json.dumps({"error": "OPERATION_FAILED", "category": type(exc).__name__}))
        raise SystemExit(1) from None
