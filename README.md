# Voter Roll PDF to Excel

Static browser tool for converting scanned voter-roll PDFs into `.xlsx`.

## Use

Open `index.html` from a static web server or GitHub Pages, then:

1. Drag in a scanned PDF.
2. Confirm start/end voter-entry pages.
4. Click **Generate Excel**.
5. Use the download link when the logs show completion.

The tool parses Assembly Constituency, Section, and Polling Station details from
the PDF and adds them to the Excel rows.

Use **Add Telugu columns** for existing `.xlsx` files. Enter comma-separated
column names such as `Name,RelationshipType,RelationshipName`; the backend adds
Telugu transliteration columns to the returned workbook.

The hosted Railway backend URL is filled in by default for faster Python OCR.
Clear **Backend API URL** to run browser-only OCR instead.

## GitHub Pages

Commit the `voter-roll-tool` folder and enable GitHub Pages for the repository.
If Pages serves the repository root, the tool URL will be:

```text
https://YOUR-USERNAME.github.io/YOUR-REPO/voter-roll-tool/
```

## Logs

The page prints live logs for:

- PDF file selected
- Library loading
- PDF page count
- Page rendering
- OCR progress per page
- Voter entries found per page
- Total Excel rows
- Missing key field count

## Notes

- With the default backend URL, the PDF is sent to the private Railway backend for processing.
- If **Backend API URL** is blank, the PDF never leaves the browser.
- The first load needs internet because the static page uses CDN libraries for PDF rendering, OCR, and Excel export.
- Browser OCR is slower than the Python tool. Expect larger rolls to take a few minutes.
- The parser is tuned for the 3-column Election Roll box layout used in the tested PDF.

## Railway Backend

The default backend is `https://voter-roll-backend-production.up.railway.app`.
The frontend submits an async job, polls progress, shows a shimmer while the
backend works, and displays the download link when Excel is ready.
