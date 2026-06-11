const els = {
  transliterateDrop: document.querySelector("#transliterateDrop"),
  transliterateFile: document.querySelector("#transliterateFile"),
  transliterateName: document.querySelector("#transliterateName"),
  columnsInput: document.querySelector("#columnsInput"),
  columnsMetric: document.querySelector("#columnsMetric"),
  fileMetric: document.querySelector("#fileMetric"),
  statusMetric: document.querySelector("#statusMetric"),
  readyStatus: document.querySelector("#readyStatus"),
  transliterateBtn: document.querySelector("#transliterateBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  downloadLink: document.querySelector("#downloadLink"),
  backendUrl: document.querySelector("#backendUrl"),
  progressBar: document.querySelector("#progressBar"),
  progressWrap: document.querySelector(".merge-progress-bar"),
  transliterateProgress: document.querySelector("#transliterateProgress"),
  progressTitle: document.querySelector("#progressTitle"),
  progressDetail: document.querySelector("#progressDetail"),
  progressPercent: document.querySelector("#progressPercent"),
  steps: document.querySelectorAll("[data-step]"),
  logs: document.querySelector("#logs"),
  summary: document.querySelector("#summary"),
};

let selectedFile = null;
let activeDownloadUrl = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  els.transliterateProgress.classList.toggle("running", kind === "running");
  els.transliterateProgress.classList.toggle("done", kind === "done");
  els.transliterateProgress.classList.toggle("error", kind === "error");
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

function cleanColumns() {
  return els.columnsInput.value
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

function outputName() {
  const base = (selectedFile?.name || "voter_roll").replace(/\.xlsx$/i, "");
  const name = `${base}_transliterated`.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "");
  return `${name || "voter_roll_transliterated"}.xlsx`;
}

function updateColumnsMetric() {
  const columns = cleanColumns();
  els.columnsMetric.textContent = columns.length ? columns.join(", ") : "Not set";
}

function acceptFile(file) {
  if (!isXlsx(file)) {
    log("Please choose an .xlsx file.", "warn");
    return;
  }

  selectedFile = file;
  els.transliterateName.textContent = file.name;
  els.fileMetric.textContent = `${file.name} (${formatBytes(file.size)})`;
  els.transliterateBtn.disabled = cleanColumns().length === 0;
  els.downloadLink.hidden = true;
  els.summary.textContent = "Ready to add English columns";
  setStatus("Ready");
  setProgressState("idle", "Ready to transliterate", "File is selected. Start when ready.", 0, "upload");
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

function jobStep(progress) {
  if (progress >= 87) return ["download", ["upload", "job", "transliterate"]];
  if (progress >= 15) return ["transliterate", ["upload", "job"]];
  return ["job", ["upload"]];
}

async function transliterateColumns() {
  if (!selectedFile) return;

  const baseUrl = els.backendUrl.value.trim().replace(/\/+$/, "");
  const columns = cleanColumns();
  if (!baseUrl) {
    log("Backend API URL is required.", "warn");
    return;
  }
  if (!columns.length) {
    log("Enter at least one Telugu column name.", "warn");
    return;
  }

  els.transliterateBtn.disabled = true;
  els.transliterateBtn.textContent = "Uploading...";
  els.downloadLink.hidden = true;
  els.progressWrap.classList.add("shimmer");
  setStatus("Uploading");
  els.summary.textContent = "Uploading file to backend";
  setProgressState("running", "Transliteration in progress", "Step 1 of 4: Uploading file to the backend", 10, "upload");

  try {
    const endpoint = `${baseUrl}/transliterate-columns`;
    const form = new FormData();
    form.append("file", selectedFile);
    form.append("columns", columns.join(","));

    log(`Submitting transliteration job: ${endpoint}`);
    log(`Columns: ${columns.join(", ")}`);
    setProgressState("running", "Transliteration in progress", "Step 1 of 4: Uploading file to the backend", 20, "upload");

    const response = await fetch(endpoint, { method: "POST", body: form });
    if (!response.ok) {
      throw new Error(`Transliteration job failed to start (${response.status}).${await readError(response)}`);
    }

    let job = await response.json();
    log(`Transliteration job created: ${job.job_id}`);
    els.transliterateBtn.textContent = "Working...";
    setProgressState("running", "Transliteration in progress", "Step 2 of 4: Job started", Number(job.progress) || 25, "job", ["upload"]);

    while (!["completed", "failed"].includes(job.status)) {
      const progress = Number(job.progress) || 0;
      const [activeStep, doneSteps] = jobStep(progress);
      setStatus(job.status === "queued" ? "Queued" : "Running");
      els.summary.textContent = job.message || "Transliteration job running";
      setProgressState(
        "running",
        "Transliteration in progress",
        job.message || "Adding English columns",
        progress,
        activeStep,
        doneSteps,
      );
      log(`Job ${job.status}: ${job.progress}% - ${job.message || "working"}`);
      await sleep(2500);

      const statusResponse = await fetch(`${baseUrl}/jobs/${job.job_id}`);
      if (!statusResponse.ok) {
        if (statusResponse.status === 404) {
          throw new Error("The backend lost this transliteration job, usually because the server restarted. Please run it again.");
        }
        throw new Error(`Could not fetch job status (${statusResponse.status}).`);
      }
      job = await statusResponse.json();
    }

    setProgress(Number(job.progress) || 100);
    if (job.status === "failed") {
      throw new Error(job.message || "Transliteration job failed.");
    }

    log("Transliteration complete. Downloading result.", "ok");
    els.summary.textContent = "Transliteration complete. Preparing download.";
    setProgressState("running", "Transliteration in progress", "Step 4 of 4: Preparing download", 95, "download", ["upload", "job", "transliterate"]);

    const downloadUrl = job.download_url ? `${baseUrl}${job.download_url}` : `${baseUrl}/jobs/${job.job_id}/download`;
    const downloadResponse = await fetch(downloadUrl);
    if (!downloadResponse.ok) {
      throw new Error(`Download failed (${downloadResponse.status}).`);
    }

    const blob = await downloadResponse.blob();
    if (activeDownloadUrl) URL.revokeObjectURL(activeDownloadUrl);
    activeDownloadUrl = URL.createObjectURL(blob);

    const name = outputName();
    els.downloadLink.href = activeDownloadUrl;
    els.downloadLink.download = name;
    els.downloadLink.textContent = `Download ${name}`;
    els.downloadLink.hidden = false;

    setStatus("Done");
    els.summary.textContent = "Excel with English columns is ready to download";
    setProgressState("done", "Download ready", "The transliterated Excel file is ready.", 100, "download", ["upload", "job", "transliterate", "download"]);
    els.transliterateBtn.textContent = "Transliterate Another File";
    log(`Download ready: ${name}`, "ok");
  } catch (error) {
    setStatus("Error");
    els.summary.textContent = "Transliteration failed";
    setProgressState("error", "Transliteration failed", error?.message || String(error), 100, "transliterate", ["upload"]);
    log(error?.message || String(error), "warn");
  } finally {
    els.progressWrap.classList.remove("shimmer");
    els.transliterateBtn.disabled = !selectedFile || cleanColumns().length === 0;
    if (!["Done"].includes(els.statusMetric.textContent)) {
      els.transliterateBtn.textContent = "Add English Columns";
    }
  }
}

els.transliterateFile.addEventListener("change", (event) => acceptFile(event.target.files?.[0]));
els.columnsInput.addEventListener("input", () => {
  updateColumnsMetric();
  els.transliterateBtn.disabled = !selectedFile || cleanColumns().length === 0;
});
els.transliterateBtn.addEventListener("click", transliterateColumns);
els.clearBtn.addEventListener("click", () => {
  els.logs.textContent = "";
  log("Logs cleared.");
});

wireDrop(els.transliterateDrop);
updateColumnsMetric();
setProgressState("idle", "Ready to transliterate", "Choose an Excel file and enter Telugu column names.", 0, "upload");
log("Ready. Choose one Excel voter-roll file to add English transliteration columns.");
