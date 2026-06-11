const els = {
  houseDrop: document.querySelector("#houseDrop"),
  houseFile: document.querySelector("#houseFile"),
  houseName: document.querySelector("#houseName"),
  houseColumn: document.querySelector("#houseColumn"),
  fileMetric: document.querySelector("#fileMetric"),
  fixedMetric: document.querySelector("#fixedMetric"),
  statusMetric: document.querySelector("#statusMetric"),
  readyStatus: document.querySelector("#readyStatus"),
  fixBtn: document.querySelector("#fixBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  downloadLink: document.querySelector("#downloadLink"),
  backendUrl: document.querySelector("#backendUrl"),
  progressBar: document.querySelector("#progressBar"),
  progressWrap: document.querySelector(".merge-progress-bar"),
  houseProgress: document.querySelector("#houseProgress"),
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
  els.houseProgress.classList.toggle("running", kind === "running");
  els.houseProgress.classList.toggle("done", kind === "done");
  els.houseProgress.classList.toggle("error", kind === "error");
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
  const base = (selectedFile?.name || "voter_roll").replace(/\.xlsx$/i, "");
  const name = `${base}_fixed_hno`.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "");
  return `${name || "voter_roll_fixed_hno"}.xlsx`;
}

function acceptFile(file) {
  if (!isXlsx(file)) {
    log("Please choose an .xlsx file.", "warn");
    return;
  }

  selectedFile = file;
  els.houseName.textContent = file.name;
  els.fileMetric.textContent = `${file.name} (${formatBytes(file.size)})`;
  els.fixedMetric.textContent = "0";
  els.fixBtn.disabled = false;
  els.downloadLink.hidden = true;
  els.summary.textContent = "Ready to fix house numbers";
  setStatus("Ready");
  setProgressState("idle", "Ready to fix", "File is selected. Start fixing when ready.", 0, "upload");
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

async function fixHouseNumbers() {
  if (!selectedFile) return;

  const baseUrl = els.backendUrl.value.trim().replace(/\/+$/, "");
  const column = els.houseColumn.value.trim();
  if (!baseUrl) {
    log("Backend API URL is required.", "warn");
    return;
  }
  if (!column) {
    log("House number column is required.", "warn");
    return;
  }

  els.fixBtn.disabled = true;
  els.fixBtn.textContent = "Uploading...";
  els.downloadLink.hidden = true;
  els.progressWrap.classList.add("shimmer");
  setStatus("Uploading");
  els.summary.textContent = "Uploading file to backend";
  setProgressState("running", "Fixing house numbers", "Uploading Excel file to the backend", 20, "upload");

  try {
    const endpoint = `${baseUrl}/fix-house-numbers`;
    const form = new FormData();
    form.append("file", selectedFile);
    form.append("column", column);

    log(`Submitting house-number fix: ${endpoint}`);
    log(`House number column: ${column}`);
    els.fixBtn.textContent = "Fixing...";
    setProgressState("running", "Fixing house numbers", "Checking the selected column for Excel date values", 60, "send", ["upload"]);

    const response = await fetch(endpoint, { method: "POST", body: form });
    if (!response.ok) {
      throw new Error(`House-number fix failed (${response.status}).${await readError(response)}`);
    }

    const fixedCount = response.headers.get("X-Fixed-Count") || "0";
    const blob = await response.blob();
    if (activeDownloadUrl) URL.revokeObjectURL(activeDownloadUrl);
    activeDownloadUrl = URL.createObjectURL(blob);

    const name = outputName();
    els.downloadLink.href = activeDownloadUrl;
    els.downloadLink.download = name;
    els.downloadLink.textContent = `Download ${name}`;
    els.downloadLink.hidden = false;
    els.fixedMetric.textContent = fixedCount;

    setStatus("Done");
    els.summary.textContent = `Fixed ${fixedCount} house-number cells`;
    setProgressState("done", "Download ready", "The fixed Excel file is ready.", 100, "download", ["upload", "send", "download"]);
    els.fixBtn.textContent = "Fix Another File";
    log(`Download ready: ${name}`, "ok");
    log(`Fixed cells: ${fixedCount}`, "ok");
  } catch (error) {
    setStatus("Error");
    els.summary.textContent = "House-number fix failed";
    setProgressState("error", "Fix failed", error?.message || String(error), 100, "send", ["upload"]);
    log(error?.message || String(error), "warn");
  } finally {
    els.progressWrap.classList.remove("shimmer");
    els.fixBtn.disabled = !selectedFile;
    if (!["Done"].includes(els.statusMetric.textContent)) {
      els.fixBtn.textContent = "Fix House Numbers";
    }
  }
}

els.houseFile.addEventListener("change", (event) => acceptFile(event.target.files?.[0]));
els.fixBtn.addEventListener("click", fixHouseNumbers);
els.clearBtn.addEventListener("click", () => {
  els.logs.textContent = "";
  log("Logs cleared.");
});

wireDrop(els.houseDrop);
setProgressState("idle", "Ready to fix", "Choose an Excel file, then start the fix.", 0, "upload");
log("Ready. Choose one Excel voter-roll file to fix house numbers.");
