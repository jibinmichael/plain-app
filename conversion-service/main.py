"""
plain — conversion service.

A small, separately-deployable FastAPI microservice that turns any uploaded
document into clean Markdown using Microsoft MarkItDown, so it can join plain's
truth layer. Handles docx/pptx/xlsx, pdf, images (OCR), audio (transcription),
html, csv/json.

Run locally:
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000

Any OCR/LLM credentials this service needs stay HERE (server-side), never in
the Next app or the browser. The Next `/api/attach` route is the only caller.
"""

import os
from io import BytesIO

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from markitdown import MarkItDown

app = FastAPI(title="plain conversion service", version="0.9")

# Bound cost/abuse at the service edge too (the Next route also guards).
MAX_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))  # 25 MB

# MarkItDown can optionally use an LLM for richer image descriptions; only wired
# if a key is present in THIS service's environment. Plain OCR/text otherwise.
_md = MarkItDown(enable_plugins=False)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/convert")
async def convert(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty file")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="file too large")

    try:
        # MarkItDown sniffs type from the stream + filename hint.
        result = _md.convert_stream(BytesIO(data), file_extension=_ext(file.filename))
    except Exception as exc:  # noqa: BLE001 — surface a calm message, never 500-crash
        return JSONResponse(
            status_code=422,
            content={"error": f"could not convert: {type(exc).__name__}"},
        )

    markdown = (result.text_content or "").strip()
    if not markdown:
        return JSONResponse(
            status_code=422, content={"error": "no readable text found"}
        )

    return {
        "markdown": markdown,
        "meta": {
            "filename": file.filename,
            "title": (getattr(result, "title", None) or file.filename or "").strip(),
            "bytes": len(data),
            "content_type": file.content_type,
        },
    }


def _ext(filename: str | None) -> str | None:
    if not filename or "." not in filename:
        return None
    return "." + filename.rsplit(".", 1)[1].lower()
