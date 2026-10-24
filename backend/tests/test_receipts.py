"""Receipts: parsed in isolation, read by rules (or a model), and never able to instruct the agent."""

from pathlib import Path

import pytest
from conftest import ORIGIN

DEMO = Path(__file__).resolve().parents[2] / "docs" / "demo"


def upload(bank, name):
    with open(DEMO / name, "rb") as handle:
        response = bank.client.post("/api/uploads", files={"file": (name, handle, "application/pdf")}, headers=ORIGIN)
    assert response.status_code == 200, response.text
    return response.json()


def test_receipt_is_read_by_rules_without_a_model(bank):
    body = upload(bank, "receipt-hotpot.pdf")
    assert body["read_by"] == "rules"
    assert body["reading"]["total_fen"] == 48_600
    assert len(body["reading"]["items"]) == 11
    assert body["flags"] == []
    assert bank.client.get(body["preview"]).status_code == 200


def test_split_a_receipt(bank):
    receipt = upload(bank, "receipt-hotpot.pdf")
    response = bank.post("/api/chat", {"message": "和刘洋、王芳AA", "attachment_id": receipt["id"], "lang": "zh"})
    plan = response.json()["plan"]
    assert plan["steps"][0]["action"] == "collect"
    assert plan["tier"] == "yellow"
    assert "¥162.00" in plan["steps"][0]["text"]  # ¥486 shared by three


def test_hidden_instructions_are_flagged_and_raise_the_tier(bank):
    receipt = upload(bank, "receipt-hotpot-hidden-instructions.pdf")
    assert "HIDDEN_TEXT" in receipt["flags"] and "INSTRUCTIONS_IN_RECEIPT" in receipt["flags"]
    assert receipt["reading"]["total_fen"] == 48_600  # the hidden text did not change the reading
    response = bank.post("/api/chat", {"message": "split this with Liu Yang and Wang Fang", "attachment_id": receipt["id"], "lang": "en"})
    plan = response.json()["plan"]
    assert plan["steps"][0]["action"] == "collect"  # nothing about Zhou Kai or a transfer
    assert plan["tier"] == "red" and plan["steps"][0]["signals"]


def test_reading_a_receipt_on_its_own(bank):
    receipt = upload(bank, "receipt-hotpot.pdf")
    body = bank.post("/api/chat", {"message": "这张小票多少钱", "attachment_id": receipt["id"]}).json()
    assert body["plan"]["steps"][0]["action"] == "read_receipt"
    assert "¥486.00" in body["messages"][-1]["text"]


def test_someone_elses_receipt_is_not_usable(bank, tmp_path):
    receipt = upload(bank, "receipt-hotpot.pdf")
    bank.post("/api/logout")
    other = {"name": "Other", "email": "other@example.com", "password": "another long password", "pin": "135792"}
    assert bank.client.post("/api/register", json=other, headers=ORIGIN).status_code == 201
    assert bank.client.get(receipt["preview"]).status_code == 404
    body = bank.post("/api/chat", {"message": "这张小票多少钱", "attachment_id": receipt["id"]}).json()
    assert body["plan"] is None or body["plan"]["steps"][0]["action"] != "read_receipt"


def test_not_a_pdf_or_image_is_refused(bank):
    response = bank.client.post("/api/uploads", files={"file": ("x.txt", b"hello", "text/plain")}, headers=ORIGIN)
    assert response.status_code == 422


def test_only_png_and_jpeg_decoders_ever_see_an_upload():
    from io import BytesIO

    from PIL import Image

    from app.pipeline.ingest import InputError, _image, ingest_bytes

    def encoded(fmt):
        buffer = BytesIO()
        Image.new("RGB", (40, 30), "white").save(buffer, format=fmt)
        return buffer.getvalue()

    assert ingest_bytes(encoded("PNG")).kind == "image" and ingest_bytes(encoded("JPEG")).kind == "image"
    with pytest.raises(InputError):
        ingest_bytes(encoded("GIF"))  # refused by its first bytes
    with pytest.raises(InputError):
        _image(encoded("TIFF"))  # and even past that check, Pillow's other readers are never tried
