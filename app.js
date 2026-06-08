const els = {
  dropZone: document.querySelector("#dropZone"),
  fileInput: document.querySelector("#fileInput"),
  convertBtn: document.querySelector("#convertBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  downloadLink: document.querySelector("#downloadLink"),
  logs: document.querySelector("#logs"),
  summary: document.querySelector("#summary"),
  readyStatus: document.querySelector("#readyStatus"),
  progressBar: document.querySelector("#progressBar"),
  progressWrap: document.querySelector(".progress-wrap"),
  canvas: document.querySelector("#pageCanvas"),
  pollingStation: document.querySelector("#pollingStation"),
  sectionHeading: document.querySelector("#sectionHeading"),
  startPage: document.querySelector("#startPage"),
  endPage: document.querySelector("#endPage"),
  backendUrl: document.querySelector("#backendUrl"),
};

const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
const TARGET_WIDTH = 1653;
const APP_VERSION = "20260608-hosted-backend";

let selectedFile = null;
let pdfjsLib = null;
let activeDownloadUrl = null;

function log(message, type = "info") {
  const stamp = new Date().toLocaleTimeString();
  const marker = type === "warn" ? "!" : type === "ok" ? "*" : "-";
  els.logs.textContent += `[${stamp}] ${marker} ${message}\n`;
  els.logs.scrollTop = els.logs.scrollHeight;
}

function setStatus(text) {
  els.readyStatus.textContent = text;
}

function setProgress(percent) {
  els.progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function setSummary(text) {
  els.summary.textContent = text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadLibraries() {
  if (!pdfjsLib) {
    log("Loading PDF renderer...");
    pdfjsLib = await import(PDFJS_URL);
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  if (!window.Tesseract) {
    throw new Error("OCR library did not load. Check your internet connection and refresh.");
  }
  if (!window.XLSX) {
    throw new Error("Excel library did not load. Check your internet connection and refresh.");
  }
}

function acceptFile(file) {
  const isPdf = file && (file.type === "application/pdf" || /\.pdf$/i.test(file.name));
  if (!isPdf) {
    log("Please choose a PDF file.", "warn");
    return;
  }
  selectedFile = file;
  els.convertBtn.disabled = false;
  els.downloadLink.hidden = true;
  setProgress(0);
  setStatus("PDF loaded");
  setSummary(`${file.name} selected`);
  log(`Selected file: ${file.name} (${formatBytes(file.size)})`);
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function normalizeId(text) {
  const compact = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]{3}[0-9O]{7}$/.test(compact)) return null;
  return compact.slice(0, 3) + compact.slice(3).replaceAll("O", "0");
}

function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

function normalizeFuzzyId(text) {
  const exact = normalizeId(text);
  if (exact) return exact;

  const compact = String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length < 8 || compact.length > 14) return null;

  let bestPrefix = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const prefix of ["NDF", "CST"]) {
    const score = distance(compact.slice(0, 3), prefix);
    if (score < bestScore) {
      bestPrefix = prefix;
      bestScore = score;
    }
  }
  if (bestScore > 2 || !bestPrefix) return null;

  const digitMap = { O: "0", Q: "0", D: "0", I: "1", L: "1", T: "1", Z: "2", A: "4", S: "5", G: "6", B: "8" };
  const digits = compact
    .slice(3)
    .split("")
    .map((char) => (/\d/.test(char) ? char : digitMap[char] || ""))
    .join("")
    .slice(0, 7);
  return digits.length === 7 ? `${bestPrefix}${digits}` : null;
}

function cleanText(text) {
  return String(text || "")
    .replaceAll("|", "I")
    .replace(/\s+/g, " ")
    .replace(/Name\s+:/g, "Name:")
    .replace(/Number\s+:/g, "Number:")
    .replace(/Age\s+:/g, "Age:")
    .replace(/Gender\s+:/g, "Gender:")
    .trim();
}

function gridFor(width, height) {
  const scaleX = width / 1653;
  const scaleY = height / 2339;
  return {
    colLefts: [38, 566, 1095].map((value) => value * scaleX),
    colWidth: 520 * scaleX,
    rowTops: Array.from({ length: 10 }, (_, index) => (75 + 220.5 * index) * scaleY),
    rowHeight: 205 * scaleY,
  };
}

function cellPosition(cx, cy, grid) {
  let col = 0;
  let row = 0;
  let bestCol = Number.POSITIVE_INFINITY;
  let bestRow = Number.POSITIVE_INFINITY;

  grid.colLefts.forEach((left, index) => {
    const distance = Math.abs(cx - (left + grid.colWidth / 2));
    if (distance < bestCol) {
      bestCol = distance;
      col = index;
    }
  });

  grid.rowTops.forEach((top, index) => {
    const distance = Math.abs(cy - (top + 18 * (grid.rowHeight / 205)));
    if (distance < bestRow) {
      bestRow = distance;
      row = index;
    }
  });

  return { row, col };
}

function cellBounds(cx, cy, grid) {
  const { row, col } = cellPosition(cx, cy, grid);
  return {
    x1: grid.colLefts[col] - 8,
    y1: grid.rowTops[row] - 10,
    x2: grid.colLefts[col] + grid.colWidth + 8,
    y2: grid.rowTops[row] + grid.rowHeight,
    row,
    col,
  };
}

function boundsForPosition(row, col, grid) {
  return {
    x1: grid.colLefts[col] - 8,
    y1: grid.rowTops[row] - 10,
    x2: grid.colLefts[col] + grid.colWidth + 8,
    y2: grid.rowTops[row] + grid.rowHeight,
    row,
    col,
  };
}

function idBoundsForPosition(row, col, grid) {
  const scaleX = grid.colWidth / 520;
  const scaleY = grid.rowHeight / 205;
  const left = grid.colLefts[col];
  const top = grid.rowTops[row];
  return {
    x1: left + 360 * scaleX,
    y1: top - 4 * scaleY,
    x2: left + 520 * scaleX,
    y2: top + 45 * scaleY,
  };
}

function itemFromTesseract(item) {
  const box = item.bbox || {};
  const x1 = box.x0 ?? 0;
  const y1 = box.y0 ?? 0;
  const x2 = box.x1 ?? 0;
  const y2 = box.y1 ?? 0;
  return {
    text: item.text || "",
    x1,
    y1,
    x2,
    y2,
    cx: (x1 + x2) / 2,
    cy: (y1 + y2) / 2,
    height: Math.max(1, y2 - y1),
    confidence: item.confidence ?? 0,
  };
}

function wordsToLines(words) {
  const sorted = words
    .slice()
    .filter((word) => cleanText(word.text))
    .sort((a, b) => a.cy - b.cy || a.x1 - b.x1);
  const groups = [];

  for (const word of sorted) {
    const last = groups.at(-1);
    const threshold = Math.max(10, word.height * 0.75);
    if (!last || Math.abs(last.cy - word.cy) > threshold) {
      groups.push({ cy: word.cy, words: [word] });
    } else {
      last.words.push(word);
      last.cy = last.words.reduce((sum, item) => sum + item.cy, 0) / last.words.length;
    }
  }

  return groups.map((group) => {
    const lineWords = group.words.slice().sort((a, b) => a.x1 - b.x1);
    return {
      text: lineWords.map((word) => word.text).join(" "),
      x1: Math.min(...lineWords.map((word) => word.x1)),
      y1: Math.min(...lineWords.map((word) => word.y1)),
      x2: Math.max(...lineWords.map((word) => word.x2)),
      y2: Math.max(...lineWords.map((word) => word.y2)),
      cx: lineWords.reduce((sum, word) => sum + word.cx, 0) / lineWords.length,
      cy: group.cy,
    };
  });
}

function parseCell(words, voterId) {
  const useful = wordsToLines(words)
    .sort((a, b) => a.cy - b.cy || a.x1 - b.x1)
    .map((line) => cleanText(line.text))
    .filter((text) => {
      const compact = text.replace(/\s+/g, "");
      if (!text || /^photo$/i.test(text) || /^available$/i.test(text)) return false;
      if (normalizeId(text) === voterId) return false;
      if (/^\d{1,4}$/.test(compact)) return false;
      return !/Photo|Available/i.test(text);
    });

  let name = "";
  let relationType = "";
  const relationParts = [];
  let houseNumber = "";
  let age = "";
  let gender = "";
  let mode = null;

  for (const text of useful) {
    if (/^Name\s*:/i.test(text)) {
      name = text.replace(/^Name\s*:\s*/i, "").trim();
      mode = "name";
      continue;
    }

    const relation = text.match(/^(Fathers|Husbands|Mothers|Others)\s*Name\s*:\s*(.*)$/i);
    if (relation) {
      relationType = {
        fathers: "Father",
        husbands: "Husband",
        mothers: "Mother",
        others: "Other",
      }[relation[1].toLowerCase()] || relation[1];
      if (relation[2].trim()) relationParts.push(relation[2].trim());
      mode = "relation";
      continue;
    }

    const house = text.match(/^House\s*Number\s*:\s*(.*)$/i);
    if (house) {
      houseNumber = house[1].trim();
      mode = null;
      continue;
    }

    const ageGender = text.match(/Age\s*:?\s*(\d{1,3})\s*Gend(?:er|ler)\s*:?\s*(Male|Female|M|F)/i);
    if (ageGender) {
      age = ageGender[1];
      gender = /^m/i.test(ageGender[2]) ? "Male" : "Female";
      mode = null;
      continue;
    }

    if (mode === "relation" && !/House|Age|Gender|Gendler/i.test(text)) {
      relationParts.push(text.trim());
    } else if (mode === "name" && !relationType && !/House|Age|Gender|Gendler/i.test(text)) {
      name = `${name} ${text}`.trim();
    }
  }

  return {
    "Voter ID": voterId,
    Name: name,
    "Relation Type": relationType,
    "Relation Name": relationParts.join(" ").trim(),
    "House Number": houseNumber,
    Age: age,
    Gender: gender,
  };
}

async function renderPage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = TARGET_WIDTH / baseViewport.width;
  const viewport = page.getViewport({ scale });
  const context = els.canvas.getContext("2d", { willReadFrequently: true });

  els.canvas.width = Math.floor(viewport.width);
  els.canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return els.canvas;
}

async function ocrCanvas(canvas, pageNumber) {
  const result = await window.Tesseract.recognize(canvas, "eng", {
    logger: (event) => {
      if (event.status === "recognizing text" && Number.isFinite(event.progress)) {
        const percent = Math.round(event.progress * 100);
        setSummary(`OCR page ${pageNumber}: ${percent}%`);
      }
    },
  });
  const words = (result.data.words || []).map(itemFromTesseract);
  const lines = (result.data.lines || []).map(itemFromTesseract);
  setSummary(`OCR page ${pageNumber}: focused ID pass`);
  const idResult = await window.Tesseract.recognize(canvas, "eng", {
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
    preserve_interword_spaces: "1",
  });
  const idWords = (idResult.data.words || []).map(itemFromTesseract);
  return { words, lines, idWords };
}

function extractRowsFromPage(ocrData, pageNumber, width, height) {
  const words = ocrData.words.length ? ocrData.words : ocrData.lines;
  const grid = gridFor(width, height);
  const seen = new Set();
  const entries = [];
  const candidateIds = [];

  for (let row = 0; row < grid.rowTops.length; row += 1) {
    for (let col = 0; col < grid.colLefts.length; col += 1) {
      const bounds = boundsForPosition(row, col, grid);
      const cellWords = words.filter(
        (candidate) =>
          candidate.cx >= bounds.x1 &&
          candidate.cx <= bounds.x2 &&
          candidate.cy >= bounds.y1 &&
          candidate.cy <= bounds.y2,
      );
      const cellLines = wordsToLines(cellWords);
      if (!cellLines.some((line) => /^Name\s*:/i.test(cleanText(line.text)))) continue;

      const idBounds = idBoundsForPosition(row, col, grid);
      const regionWords = [...ocrData.idWords, ...words].filter(
        (candidate) =>
          candidate.cx >= idBounds.x1 &&
          candidate.cx <= idBounds.x2 &&
          candidate.cy >= idBounds.y1 &&
          candidate.cy <= idBounds.y2,
      );
      const regionText = regionWords
        .slice()
        .sort((a, b) => a.cy - b.cy || a.x1 - b.x1)
        .map((word) => word.text)
        .join("");
      const candidates = [
        ...regionWords.map((word) => word.text),
        ...regionWords.map((word, index) => `${word.text}${regionWords[index + 1]?.text || ""}`),
        regionText,
      ];
      const voterId = candidates.map(normalizeFuzzyId).find(Boolean) || "";
      if (voterId) candidateIds.push(voterId);
      const seenKey = voterId || `${pageNumber}-${row}-${col}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);

      entries.push({
        pageNumber,
        row: bounds.row,
        col: bounds.col,
        parsed: parseCell(cellWords, voterId),
      });
    }
  }

  for (const word of words) {
    const voterId = normalizeFuzzyId(word.text);
    if (!voterId || seen.has(voterId)) continue;
    const bounds = cellBounds(word.cx, word.cy, grid);
    const cellWords = words.filter(
      (candidate) =>
        candidate.cx >= bounds.x1 &&
        candidate.cx <= bounds.x2 &&
        candidate.cy >= bounds.y1 &&
        candidate.cy <= bounds.y2,
    );
    entries.push({
      pageNumber,
      row: bounds.row,
      col: bounds.col,
      parsed: parseCell(cellWords, voterId),
    });
  }

  entries.sort((a, b) => a.row - b.row || a.col - b.col);
  return { entries, candidateIds };
}

function buildWorkbook(rows, sectionHeading) {
  const headers = [
    "No. and Name of Polling Station",
    "Serial No",
    "Voter ID",
    "Name",
    "Relation Type",
    "Relation Name",
    "House Number",
    "Age",
    "Gender",
  ];
  const data = [[sectionHeading], headers, ...rows.map((row) => headers.map((header) => row[header] || ""))];
  const worksheet = window.XLSX.utils.aoa_to_sheet(data);
  worksheet["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  worksheet["!cols"] = [
    { wch: 30 },
    { wch: 10 },
    { wch: 14 },
    { wch: 34 },
    { wch: 14 },
    { wch: 36 },
    { wch: 16 },
    { wch: 8 },
    { wch: 10 },
  ];
  worksheet["!autofilter"] = { ref: `A2:I${rows.length + 2}` };

  const workbook = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(workbook, worksheet, "Voter Roll");
  return workbook;
}

function downloadWorkbook(workbook, sourceName) {
  if (activeDownloadUrl) URL.revokeObjectURL(activeDownloadUrl);
  const baseName = sourceName.replace(/\.pdf$/i, "").replace(/[^a-z0-9_-]+/gi, "_");
  const outputName = `${baseName || "voter_roll"}.xlsx`;
  const bytes = window.XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  activeDownloadUrl = URL.createObjectURL(blob);
  els.downloadLink.href = activeDownloadUrl;
  els.downloadLink.download = outputName;
  els.downloadLink.hidden = false;
  els.downloadLink.textContent = `Download ${outputName}`;
  return outputName;
}

async function convertWithBackend(apiUrl) {
  const startPage = Math.max(1, Number.parseInt(els.startPage.value, 10) || 1);
  const endPageInput = Number.parseInt(els.endPage.value, 10);
  const baseUrl = apiUrl.replace(/\/+$/, "");
  const endpoint = `${baseUrl}/jobs`;
  const form = new FormData();
  form.append("file", selectedFile);
  form.append("polling_station", els.pollingStation.value.trim());
  form.append("section_heading", els.sectionHeading.value.trim());
  form.append("start_page", String(startPage));
  if (Number.isFinite(endPageInput)) form.append("end_page", String(endPageInput));

  log(`Submitting backend job: ${endpoint}`);
  setSummary("Uploading PDF to backend");
  els.progressWrap.classList.add("shimmer");
  const response = await fetch(endpoint, { method: "POST", body: form });
  if (!response.ok) {
    let detail = "";
    try {
      const json = await response.json();
      detail = json.detail ? ` ${json.detail}` : "";
    } catch {
      detail = ` ${await response.text()}`;
    }
    throw new Error(`Backend conversion failed (${response.status}).${detail}`);
  }

  const created = await response.json();
  log(`Job created: ${created.job_id}`);
  let job = created;
  while (!["completed", "failed"].includes(job.status)) {
    setProgress(Number(job.progress) || 0);
    setSummary(job.message || "Backend job running");
    log(`Job ${job.status}: ${job.progress}% - ${job.message || "working"}`);
    await sleep(2000);
    const statusResponse = await fetch(`${baseUrl}/jobs/${job.job_id}`);
    if (!statusResponse.ok) {
      throw new Error(`Could not fetch job status (${statusResponse.status}).`);
    }
    job = await statusResponse.json();
  }

  setProgress(Number(job.progress) || 100);
  if (job.status === "failed") {
    throw new Error(job.message || "Backend job failed.");
  }

  log(`Job completed: ${job.entries} entries, ${job.missing_key_fields} rows with missing key fields.`, "ok");
  setSummary("Success. Excel is ready to download.");
  const downloadResponse = await fetch(`${baseUrl}/jobs/${job.job_id}/download`);
  if (!downloadResponse.ok) {
    throw new Error(`Download failed (${downloadResponse.status}).`);
  }

  const blob = await downloadResponse.blob();
  if (activeDownloadUrl) URL.revokeObjectURL(activeDownloadUrl);
  activeDownloadUrl = URL.createObjectURL(blob);
  const baseName = selectedFile.name.replace(/\.pdf$/i, "").replace(/[^a-z0-9_-]+/gi, "_");
  const outputName = `${baseName || "voter_roll"}.xlsx`;

  els.downloadLink.href = activeDownloadUrl;
  els.downloadLink.download = outputName;
  els.downloadLink.hidden = false;
  els.downloadLink.textContent = `Download ${outputName}`;
  setProgress(100);
  setStatus("Done");
  setSummary(`Success. ${job.entries} entries. ${job.missing_key_fields} rows with missing key fields.`);
  log(`Download ready: ${outputName}`, "ok");
}

async function convert() {
  if (!selectedFile) return;
  els.convertBtn.disabled = true;
  els.downloadLink.hidden = true;
  setStatus("Working");
  setProgress(0);

  try {
    const backendUrl = els.backendUrl.value.trim();
    if (backendUrl) {
      await convertWithBackend(backendUrl);
      return;
    }

    await loadLibraries();
    const startPage = Math.max(1, Number.parseInt(els.startPage.value, 10) || 1);
    const endPageInput = Number.parseInt(els.endPage.value, 10);
    const fileBuffer = await selectedFile.arrayBuffer();
    log("Opening PDF in browser...");
    const pdf = await pdfjsLib.getDocument({ data: fileBuffer }).promise;
    const endPage = Math.min(pdf.numPages, Number.isFinite(endPageInput) ? endPageInput : pdf.numPages);
    log(`PDF pages: ${pdf.numPages}. Processing pages ${startPage} to ${endPage}.`);

    const allEntries = [];
    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      log(`Rendering page ${pageNumber}...`);
      const canvas = await renderPage(pdf, pageNumber);
      log(`OCR page ${pageNumber} at ${canvas.width}x${canvas.height}px...`);
      const ocrData = await ocrCanvas(canvas, pageNumber);
      const { entries, candidateIds } = extractRowsFromPage(ocrData, pageNumber, canvas.width, canvas.height);
      allEntries.push(...entries);
      const progress = ((pageNumber - startPage + 1) / (endPage - startPage + 1)) * 90;
      setProgress(progress);
      log(
        `Page ${pageNumber}: ${ocrData.words.length} words, ${ocrData.lines.length} lines, ` +
          `${ocrData.idWords.length} ID-pass words, ${candidateIds.length} ID candidates, ` +
          `${entries.length} voter entries found.`,
      );
      if (!entries.length) {
        const sample = ocrData.words
          .slice(0, 30)
          .map((word) => cleanText(word.text))
          .filter(Boolean)
          .join(" ");
        log(`Page ${pageNumber} sample OCR words: ${sample || "none"}`, "warn");
      }
    }

    allEntries.sort((a, b) => a.pageNumber - b.pageNumber || a.row - b.row || a.col - b.col);
    const rows = allEntries.map((entry, index) => ({
      "No. and Name of Polling Station": els.pollingStation.value.trim(),
      "Serial No": index + 1,
      ...entry.parsed,
    }));

    const missing = rows.filter(
      (row) => !row["Voter ID"] || !row.Name || !row["House Number"] || !row.Age || !row.Gender,
    );
    log(`Building Excel workbook with ${rows.length} rows...`);
    if (missing.length) {
      log(`${missing.length} rows have missing key fields. Review the downloaded file.`, "warn");
    }
    const workbook = buildWorkbook(rows, els.sectionHeading.value.trim());
    const outputName = downloadWorkbook(workbook, selectedFile.name);
    setProgress(100);
    setStatus("Done");
    setSummary(`${rows.length} entries. ${missing.length} rows with missing key fields.`);
    log(`Done. ${rows.length} entries exported to ${outputName}.`, "ok");
  } catch (error) {
    setStatus("Error");
    setSummary("Conversion failed");
    log(error?.message || String(error), "warn");
  } finally {
    els.progressWrap.classList.remove("shimmer");
    els.convertBtn.disabled = false;
  }
}

els.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  els.dropZone.classList.add("dragging");
});

els.dropZone.addEventListener("dragleave", () => {
  els.dropZone.classList.remove("dragging");
});

els.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  els.dropZone.classList.remove("dragging");
  acceptFile(event.dataTransfer.files?.[0]);
});

els.fileInput.addEventListener("change", (event) => {
  acceptFile(event.target.files?.[0]);
});

els.convertBtn.addEventListener("click", convert);

els.clearBtn.addEventListener("click", () => {
  els.logs.textContent = "";
  log("Logs cleared.");
});

log(`Ready. Version ${APP_VERSION}. Choose a scanned voter-roll PDF to begin.`);
