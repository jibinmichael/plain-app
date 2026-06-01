# plain — conversion service

A standalone FastAPI microservice that converts uploaded documents to clean
Markdown via [Microsoft MarkItDown](https://github.com/microsoft/markitdown),
so uploads can join plain's truth layer.

## Run

```bash
cd conversion-service
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
# POST a file:
curl -F "file=@notes.pdf" http://localhost:8000/convert
```

Or via Docker:

```bash
docker build -t plain-convert .
docker run -p 8000:8000 plain-convert
```

## API

- `GET /health` → `{ ok: true }`
- `POST /convert` (multipart `file`) → `{ markdown, meta:{filename,title,bytes,content_type} }`
  - `413` if larger than `MAX_UPLOAD_BYTES` (default 25 MB)
  - `422` with `{error}` if it can't be converted — never a 500 crash

## Env

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `8000` | listen port |
| `MAX_UPLOAD_BYTES` | `26214400` | hard size cap (also enforced by the Next route) |

Any OCR/LLM credentials MarkItDown might use stay in **this** service's env —
never in the Next app or the browser.

## Deploy

Deploy as its own container (Fly.io, Render, Cloud Run, a VM — anything that
runs a container). Point the Next app at it with `CONVERSION_SERVICE_URL`.
