# Voter Roll Backend

Python API for converting scanned voter-roll PDFs to Excel using server-side OCR.

## Endpoints

- `GET /health`
- `POST /convert`

`/convert` accepts multipart form fields:

- `file`: PDF file
- `polling_station`: repeated polling-station column value
- `section_heading`: highlighted first-row heading
- `start_page`: first voter-entry page, default `3`
- `end_page`: last voter-entry page
- `dpi`: render DPI, default `200`

The response is an `.xlsx` download. Response headers include:

- `X-Total-Entries`
- `X-Missing-Key-Fields`
- `X-Converter-Version`

## Railway

Deploy this `backend` folder as the Railway service root.

Recommended variables:

```text
OCR_WORKERS=2
ALLOWED_ORIGINS=https://saiteja-v.github.io
```

Railway will provide `PORT` automatically.

## Local Run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
