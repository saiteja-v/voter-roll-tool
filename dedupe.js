const els = {
  dedupeDrop: document.querySelector("#dedupeDrop"),
  dedupeFile: document.querySelector("#dedupeFile"),
  dedupeName: document.querySelector("#dedupeName"),
  headerRow: document.querySelector("#headerRow"),
  fileMetric: document.querySelector("#fileMetric"),
  removedMetric: document.querySelector("#removedMetric"),
  remainingMetric: document.querySelector("#remainingMetric"),
  statusMetric: document.querySelector("#statusMetric"),
  readyStatus: document.querySelector("#readyStatus"),
  dedupeBtn: document.querySelector("#dedupeBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  downloadLink: document.querySelector("#downloadLink"),
  backendUrl: document.querySelector("#backendUrl"),
  progressBar: document.querySelector("#progressBar"),
  progressWrap: document.querySelector(".merge-progress-bar"),
  dedupeProgress: document.querySelector("#dedupeProgress"),
  progressTitle: document.querySelector("#progressTitle"),
  progressDetail: document.querySelector("#progressDetail"),
  progressPercent: document.querySelector("#progressPercent"),
  steps: document.querySelectorAll("[data-step]"),
  logs: document.querySelector("#logs"),
  summary: document.querySelector("#summary"),
};

let selectedFile = null;
let activeDownloadUrl = null;

function log(message, type = "info") {
  const stamp = new Date().toLocaleTimeString();
  const marker = type === "warn" ? "!" : type === "ok" ? "*" : "-";
  els.logs.textContent += `[${stamp}] ${marker} ${message}\n`;
  els.logs.scrollTop = els.logs.scrollHeight;
}

function setProgress(percent) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  els.progressBar.style.width = `${safePercent}%`;
  els.progressPercent.textContent = `${Math.round(safePercent)}%`;
}

function setStatus(text) {
  els.readyStatus.textContent = text;
  els.statusMetric.textContent = text;
}

function setStep(activeStep, doneSteps = []) {
  els.steps.forEach((step) => {
    const name = step.dataset.step;
    step.classList.toggle("active", name === activeStep);
    step.classList.toggle("done", doneSteps.includes(name));
  });
}

function setProgressState(kind, title, detail, percent, activeStep, doneSteps = []) {
  els.dedupeProgress.classList.toggle("running", kind === "running");
  els.dedupeProgress.classList.toggle("done", kind === "done");
  els.dedupeProgress.classList.toggle("error", kind === "error");
  els.progressTitle.textContent = title;
  els.progressDetail.textContent = detail;
  setProgress(percent);
  setStep(activeStep, doneSteps);
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function isXlsx(file) {
  return file && /\.xlsx$/i.test(file.name);
}

function outputName() {
  const base = (selectedFile?.name || "workbook").replace(/\.xlsx$/i, "");
  const name = `${base}_deduped`.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "");
  return `${name || "workbook_deduped"}.xlsx`;
}

function acceptFile(file) {
  if (!isXlsx(file)) {
    log("Please choose an .xlsx file.", "warn");
    return;
  }

  selectedFile = file;
  els.dedupeName.textContent = file.name;
  els.fileMetric.textContent = `${file.name} (${formatBytes(file.size)})`;
  els.removedMetric.textContent = "0";
  els.remainingMetric.textContent = "0";
  els.dedupeBtn.disabled = false;
  els.downloadLink.hidden = true;
  els.summary.textContent = "Ready to remove duplicate rows";
  setStatus("Ready");
  setProgressState("idle", "Ready to remove duplicates", "File is selected. Start when ready.", 0, "upload");
  log(`Selected file: ${file.name} (${formatBytes(file.size)})`);
}

function wireDrop(zone) {
  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("dragging");
  });
  zone.addEventListener("dragleave", () => {
    zone.classList.remove("dragging");
  });
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("dragging");
    acceptFile(event.dataTransfer.files?.[0]);
  });
}

async function readError(response) {
  try {
    const json = await response.json();
    return json.detail ? ` ${json.detail}` : "";
  } catch {
    const text = await response.text();
    return text ? ` ${text}` : "";
  }
}

async function removeDuplicates() {
  if (!selectedFile) return;

  const baseUrl = els.backendUrl.value.trim().replace(/\/+$/, "");
  const headerRow = Math.max(1, Number.parseInt(els.headerRow.value, 10) || 1);
  if (!baseUrl) {
    log("Backend API URL is required.", "warn");
    return;
  }

  els.dedupeBtn.disabled = true;
  els.dedupeBtn.textContent = "Uploading...";
  els.downloadLink.hidden = true;
  els.progressWrap.classList.add("shimmer");
  setStatus("Uploading");
  els.summary.textContent = "Uploading file to backend";
  setProgressState("running", "Removing duplicates", "Uploading Excel file to the backend", 20, "upload");

  try {
    const endpoint = `${baseUrl}/remove-duplicate-rows`;
    const form = new FormData();
    form.append("file", selectedFile);
    form.append("header_row", String(headerRow));

    log(`Submitting duplicate removal: ${endpoint}`);
    log(`Header row: ${headerRow}`);
    els.dedupeBtn.textContent = "Removing...";
    setProgressState("running", "Removing duplicates", "Checking exact full-row matches", 60, "send", ["upload"]);

    const response = await fetch(endpoint, { method: "POST", body: form });
    if (!response.ok) {
      throw new Error(`Duplicate removal failed (${response.status}).${await readError(response)}`);
    }

    const removed = response.headers.get("X-Duplicate-Rows-Removed") || "0";
    const remaining = response.headers.get("X-Remaining-Rows") || "0";
    const blob = await response.blob();
    if (activeDownloadUrl) URL.revokeObjectURL(activeDownloadUrl);
    activeDownloadUrl = URL.createObjectURL(blob);

    const name = outputName();
    els.downloadLink.href = activeDownloadUrl;
    els.downloadLink.download = name;
    els.downloadLink.textContent = `Download ${name}`;
    els.downloadLink.hidden = false;
    els.removedMetric.textContent = removed;
    els.remainingMetric.textContent = remaining;

    setStatus("Done");
    els.summary.textContent = `Removed ${removed} duplicate rows`;
    setProgressState("done", "Download ready", "The deduped Excel file is ready.", 100, "download", ["upload", "send", "download"]);
    els.dedupeBtn.textContent = "Process Another File";
    log(`Download ready: ${name}`, "ok");
    log(`Rows removed: ${removed}`, "ok");
  } catch (error) {
    setStatus("Error");
    els.summary.textContent = "Duplicate removal failed";
    setProgressState("error", "Duplicate removal failed", error?.message || String(error), 100, "send", ["upload"]);
    log(error?.message || String(error), "warn");
  } finally {
    els.progressWrap.classList.remove("shimmer");
    els.dedupeBtn.disabled = !selectedFile;
    if (!["Done"].includes(els.statusMetric.textContent)) {
      els.dedupeBtn.textContent = "Remove Duplicate Rows";
    }
  }
}

els.dedupeFile.addEventListener("change", (event) => acceptFile(event.target.files?.[0]));
els.dedupeBtn.addEventListener("click", removeDuplicates);
els.clearBtn.addEventListener("click", () => {
  els.logs.textContent = "";
  log("Logs cleared.");
});

wireDrop(els.dedupeDrop);
setProgressState("idle", "Ready to remove duplicates", "Choose an Excel file, then start duplicate removal.", 0, "upload");
log("Ready. Choose one Excel file to remove exact duplicate rows.");
