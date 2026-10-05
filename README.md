# Product Serial Scanner 2.0

Generic multi-image serial-number scanner for Tally ERP 9.

## Features
- Add many images at once.
- Take multiple camera photos into the same batch.
- Barcode detection + Tesseract OCR locally first.
- Optional Qwen 3.8 27B vision fallback through Groq.
- Merge results from all photos.
- Remove duplicate serials automatically.
- Group results by product/model when possible.
- Edit/add/remove serials manually.
- 1, 2 or 3 serials per Tally line (tabs between serials).
- Temporary browser localStorage only; no database.

## Run
1. Install Node.js 18+.
2. `npm install`
3. Copy `.env.example` to `.env`.
4. Add `GROQ_API_KEY` if you want Qwen vision fallback.
5. `npm start`
6. Open `http://localhost:3000`.

Do not open index.html directly; use the local server for camera permissions.

Always verify serials visually before entering an invoice.
