const els = {
  baseDrop: document.querySelector("#baseDrop"),
  compareDrop: document.querySelector("#compareDrop"),
  baseFile: document.querySelector("#baseFile"),
  compareFile: document.querySelector("#compareFile"),
  baseName: document.querySelector("#baseName"),
  compareName: document.querySelector("#compareName"),
  baseMetric: document.querySelector("#baseMetric"),
  compareMetric: document.querySelector("#compareMetric"),
  statusMetric: document.querySelector("#statusMetric"),
  readyStatus: document.querySelector("#readyStatus"),
  mergeBtn: document.querySelector("#mergeBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  downloadLink: document.querySelector("#downloadLink"),
  backendUrl: document.querySelector("#backendUrl"),
  progressBar: document.querySelector("#progressBar"),
  progressWrap: document.querySelector(".merge-progress-bar"),
  mergeProgress: document.querySelector("#mergeProgress"),
  progressTitle: document.querySelector("#progressTitle"),
  progressDetail: document.querySelector("#progressDetail"),
  progressPercent: document.querySelector("#progressPercent"),
  steps: document.querySelectorAll("[data-step]"),
  logs: document.querySelector("#logs"),
  summary: document.querySelector("#summary"),
};

let baseFile = null;
let compareFile = null;
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
  els.mergeProgress.classList.toggle("running", kind === "running");
  els.mergeProgress.classList.toggle("done", kind === "done");
  els.mergeProgress.classList.toggle("error", kind === "error");
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

function updateReadyState() {
  els.mergeBtn.disabled = !(baseFile && compareFile);
  if (baseFile && compareFile) {
    els.summary.textContent = "Ready to merge by EPIC ID";
    setStatus("Ready");
    setProgressState("idle", "Ready to compare", "Both files are selected. Start the merge when ready.", 0, "upload");
  }
}

function acceptFile(kind, file) {
  if (!isXlsx(file)) {
    log("Please choose an .xlsx file.", "warn");
    return;
  }

  if (kind === "base") {
    baseFile = file;
    els.baseName.textContent = file.name;
    els.baseMetric.textContent = `${file.name} (${formatBytes(file.size)})`;
    log(`Selected base file: ${file.name} (${formatBytes(file.size)})`);
  } else {
    compareFile = file;
    els.compareName.textContent = file.name;
    els.compareMetric.textContent = `${file.name} (${formatBytes(file.size)})`;
    log(`Selected compare file: ${file.name} (${formatBytes(file.size)})`);
  }

  els.downloadLink.hidden = true;
  setProgress(0);
  updateReadyState();
}

function wireDrop(zone, kind) {
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
    acceptFile(kind, event.dataTransfer.files?.[0]);
  });
}

function outputName() {
  const base = (baseFile?.name || "base").replace(/\.xlsx$/i, "");
  const compare = (compareFile?.name || "compare").replace(/\.xlsx$/i, "");
  const name = `${base}_merged_with_${compare}`.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "");
  return `${name || "merged_voter_rolls"}.xlsx`;
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

async function mergeFiles() {
  if (!baseFile || !compareFile) return;

  const baseUrl = els.backendUrl.value.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    log("Backend API URL is required.", "warn");
    return;
  }

  els.mergeBtn.disabled = true;
  els.mergeBtn.textContent = "Uploading...";
  els.downloadLink.hidden = true;
  els.progressWrap.classList.add("shimmer");
  setStatus("Uploading");
  els.summary.textContent = "Uploading files to backend";
  setProgressState("running", "Merge in progress", "Step 1 of 4: Uploading files to the backend", 10, "upload");

  try {
    const endpoint = `${baseUrl}/merge-epic`;
    const form = new FormData();
    form.append("file_a", baseFile);
    form.append("file_b", compareFile);

    log(`Submitting merge job: ${endpoint}`);
    log("Matching mode: exact EPIC ID");
    setProgressState("running", "Merge in progress", "Step 1 of 4: Uploading files to the backend", 20, "upload");

    const response = await fetch(endpoint, { method: "POST", body: form });
    if (!response.ok) {
      throw new Error(`Merge job failed to start (${response.status}).${await readError(response)}`);
    }

    let job = await response.json();
    log(`Merge job created: ${job.job_id}`);
    els.mergeBtn.textContent = "Merging...";
    setProgressState("running", "Merge in progress", "Step 2 of 4: Merge job started", Number(job.progress) || 25, "job", ["upload"]);
    while (!["completed", "failed"].includes(job.status)) {
      setStatus(job.status === "queued" ? "Queued" : "Running");
      els.summary.textContent = job.message || "Merge job running";
      const progress = Number(job.progress) || 0;
      const detail =
        progress >= 30
          ? `Step 3 of 4: ${job.message || "Matching records by EPIC ID"}`
          : `Step 2 of 4: ${job.message || "Waiting for merge job to start"}`;
      setProgressState(
        "running",
        "Merge in progress",
        detail,
        progress,
        progress >= 30 ? "merge" : "job",
        progress >= 30 ? ["upload", "job"] : ["upload"],
      );
      log(`Job ${job.status}: ${job.progress}% - ${job.message || "working"}`);
      await sleep(2500);

      const statusResponse = await fetch(`${baseUrl}/jobs/${job.job_id}`);
      if (!statusResponse.ok) {
        if (statusResponse.status === 404) {
          throw new Error("The backend lost this merge job, usually because the server restarted. Please run the merge again.");
        }
        throw new Error(`Could not fetch job status (${statusResponse.status}).`);
      }
      job = await statusResponse.json();
    }

    setProgress(Number(job.progress) || 100);
    if (job.status === "failed") {
      throw new Error(job.message || "Merge job failed.");
    }

    log("Merge complete. Downloading result.", "ok");
    els.summary.textContent = "Merge complete. Preparing download.";
    setProgressState("running", "Merge in progress", "Step 4 of 4: Preparing download", 95, "download", ["upload", "job", "merge"]);
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
    els.summary.textContent = "Merged Excel is ready to download";
    setProgressState("done", "Download ready", "The merged Excel file is ready.", 100, "download", ["upload", "job", "merge", "download"]);
    els.mergeBtn.textContent = "Compare Again";
    log(`Download ready: ${name}`, "ok");
  } catch (error) {
    setStatus("Error");
    els.summary.textContent = "Merge failed";
    setProgressState("error", "Merge failed", error?.message || String(error), 100, "merge", ["upload"]);
    log(error?.message || String(error), "warn");
  } finally {
    els.progressWrap.classList.remove("shimmer");
    els.mergeBtn.disabled = !(baseFile && compareFile);
    if (!["Done"].includes(els.statusMetric.textContent)) {
      els.mergeBtn.textContent = "Compare Lists and Create Excel";
    }
  }
}

els.baseFile.addEventListener("change", (event) => acceptFile("base", event.target.files?.[0]));
els.compareFile.addEventListener("change", (event) => acceptFile("compare", event.target.files?.[0]));
els.mergeBtn.addEventListener("click", mergeFiles);
els.clearBtn.addEventListener("click", () => {
  els.logs.textContent = "";
  log("Logs cleared.");
});

wireDrop(els.baseDrop, "base");
wireDrop(els.compareDrop, "compare");
setProgressState("idle", "Ready to compare", "Choose both Excel files, then start the merge.", 0, "upload");
log("Ready. Choose two Excel voter-roll files to merge by EPIC ID.");
