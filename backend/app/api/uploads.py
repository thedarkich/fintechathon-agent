"""Receipt uploads: parsed in the isolated worker, read once, kept private to the customer."""

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import FileResponse
from sqlmodel import Session

from app import receipts
from app.agent import audit
from app.api.accounts import throttle
from app.api.security import problem, require_user
from app.models import Upload
from app.pipeline.ingest import MAX_BYTES, InputError
from app.pipeline.isolated_ingest import ingest_isolated
from app.storage import write_private_bytes

router = APIRouter(prefix="/api/uploads", dependencies=[Depends(require_user)])


def view(upload: Upload) -> dict:
    return {"id": upload.id, "kind": upload.kind, "read_by": upload.read_by, "reading": upload.reading,
            "flags": upload.flags, "preview": f"/api/uploads/{upload.id}/preview" if upload.preview_path else None}


@router.post("")
async def upload(request: Request, file: Annotated[UploadFile, File()], user_id: str = Depends(require_user)):
    throttle(request, [("upload-user", user_id, 3600, 30)])
    data = await file.read(MAX_BYTES + 1)
    try:
        document = await ingest_isolated(data)
    except InputError:
        raise problem(422, "Upload a PDF, PNG or JPEG receipt under 5 MB.", "请上传 5 MB 以内的 PDF、PNG 或 JPEG 小票。") from None
    runtime = request.app.state.runtime
    reading, read_by = await receipts.read(document, runtime.gateway, runtime.settings.ai_vision_model or runtime.settings.ai_model)
    flags = receipts.flags_for(document, reading)
    row = Upload(user_id=user_id, kind=document.kind, read_by=read_by, reading=receipts.summary(reading), flags=flags)
    if document.images:
        path = runtime.settings.data_dir / "uploads" / user_id / f"{row.id}.png"
        write_private_bytes(path, document.images[0])
        row.preview_path = str(path)
    with Session(runtime.engine) as session:
        session.add(row)
        audit.append(session, user_id, "upload", {"upload": row.id, "kind": row.kind, "read_by": read_by,
                                                  "flags": flags, "total_fen": row.reading.get("total_fen")})
        session.commit()
        return view(row)


@router.get("/{upload_id}/preview")
async def preview(request: Request, upload_id: str, user_id: str = Depends(require_user)):
    runtime = request.app.state.runtime
    with Session(runtime.engine) as session:
        row = session.get(Upload, upload_id)
        if row is None or row.user_id != user_id or not row.preview_path:
            raise problem(404, "Not found.", "未找到。")
        root = (runtime.settings.data_dir / "uploads").resolve()
        path = Path(row.preview_path).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise problem(404, "Not found.", "未找到。")
        return FileResponse(path, media_type="image/png", headers={"Cache-Control": "private, no-store"})
