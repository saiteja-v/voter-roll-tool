const els = {
  familyDrop: document.querySelector("#familyDrop"),
  familyFile: document.querySelector("#familyFile"),
  familyName: document.querySelector("#familyName"),
  fileMetric: document.querySelector("#fileMetric"),
  statusMetric: document.querySelector("#statusMetric"),
  readyStatus: document.querySelector("#readyStatus"),
  groupBtn: document.querySelector("#groupBtn"),
  clearBtn: document.querySelector("#clearBtn"),
  downloadLink: document.querySelector("#downloadLink"),
  backendUrl: document.querySelector("#backendUrl"),
  progressBar: document.querySelector("#progressBar"),
  progressWrap: document.querySelector(".merge-progress-bar"),
  familyProgress: document.querySelector("#familyProgress"),
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
  els.familyProgress.classList.toggle("running", kind === "running");
  els.familyProgress.classList.toggle("done", kind === "done");
  els.familyProgress.classList.toggle("error", kind === "error");
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
  const name = `${base}_by_family`.replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "");
  return `${name || "voter_roll_by_family"}.xlsx`;
}

function acceptFile(file) {
  if (!isXlsx(file)) {
    log("Please choose an .xlsx file.", "warn");
    return;
  }

  selectedFile = file;
  els.familyName.textContent = file.name;
  els.fileMetric.textContent = `${file.name} (${formatBytes(file.size)})`;
  els.groupBtn.disabled = false;
  els.downloadLink.hidden = true;
  els.summary.textContent = "Ready to group by F.ID";
  setStatus("Ready");
  setProgressState("idle", "Ready to group", "File is selected. Start grouping when ready.", 0, "upload");
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

async function groupFamilies() {
  if (!selectedFile) return;

  const baseUrl = els.backendUrl.value.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    log("Backend API URL is required.", "warn");
    return;
  }

  els.groupBtn.disabled = true;
  els.groupBtn.textContent = "Uploading...";
  els.downloadLink.hidden = true;
  els.progressWrap.classList.add("shimmer");
  setStatus("Uploading");
  els.summary.textContent = "Uploading file to backend";
  setProgressState("running", "Grouping in progress", "Step 1 of 4: Uploading file to the backend", 10, "upload");

  try {
    const endpoint = `${baseUrl}/group-by-family`;
    const form = new FormData();
    form.append("file", selectedFile);

    log(`Submitting family grouping job: ${endpoint}`);
    setProgressState("running", "Grouping in progress", "Step 1 of 4: Uploading file to the backend", 20, "upload");

    const response = await fetch(endpoint, { method: "POST", body: form });
    if (!response.ok) {
      throw new Error(`Family grouping job failed to start (${response.status}).${await readError(response)}`);
    }

    let job = await response.json();
    log(`Family grouping job created: ${job.job_id}`);
    els.groupBtn.textContent = "Grouping...";
    setProgressState("running", "Grouping in progress", "Step 2 of 4: Job started", Number(job.progress) || 25, "job", ["upload"]);

    while (!["completed", "failed"].includes(job.status)) {
      setStatus(job.status === "queued" ? "Queued" : "Running");
      els.summary.textContent = job.message || "Family grouping job running";
      const progress = Number(job.progress) || 0;
      const detail =
        progress >= 40
          ? `Step 3 of 4: ${job.message || "Grouping rows by F.ID"}`
          : `Step 2 of 4: ${job.message || "Waiting for grouping job to start"}`;
      setProgressState(
        "running",
        "Grouping in progress",
        detail,
        progress,
        progress >= 40 ? "group" : "job",
        progress >= 40 ? ["upload", "job"] : ["upload"],
      );
      log(`Job ${job.status}: ${job.progress}% - ${job.message || "working"}`);
      await sleep(2500);

      const statusResponse = await fetch(`${baseUrl}/jobs/${job.job_id}`);
      if (!statusResponse.ok) {
        if (statusResponse.status === 404) {
          throw new Error("The backend lost this grouping job, usually because the server restarted. Please run it again.");
        }
        throw new Error(`Could not fetch job status (${statusResponse.status}).`);
      }
      job = await statusResponse.json();
    }

    setProgress(Number(job.progress) || 100);
    if (job.status === "failed") {
      throw new Error(job.message || "Family grouping job failed.");
    }

    log("Grouping complete. Downloading result.", "ok");
    els.summary.textContent = "Grouping complete. Preparing download.";
    setProgressState("running", "Grouping in progress", "Step 4 of 4: Preparing download", 95, "download", ["upload", "job", "group"]);

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
    els.summary.textContent = "Grouped Excel is ready to download";
    setProgressState("done", "Download ready", "The family-grouped Excel file is ready.", 100, "download", ["upload", "job", "group", "download"]);
    els.groupBtn.textContent = "Group Another File";
    log(`Download ready: ${name}`, "ok");
  } catch (error) {
    setStatus("Error");
    els.summary.textContent = "Family grouping failed";
    setProgressState("error", "Grouping failed", error?.message || String(error), 100, "group", ["upload"]);
    log(error?.message || String(error), "warn");
  } finally {
    els.progressWrap.classList.remove("shimmer");
    els.groupBtn.disabled = !selectedFile;
    if (!["Done"].includes(els.statusMetric.textContent)) {
      els.groupBtn.textContent = "Group Families and Create Excel";
    }
  }
}

els.familyFile.addEventListener("change", (event) => acceptFile(event.target.files?.[0]));
els.groupBtn.addEventListener("click", groupFamilies);
els.clearBtn.addEventListener("click", () => {
  els.logs.textContent = "";
  log("Logs cleared.");
});

wireDrop(els.familyDrop);
setProgressState("idle", "Ready to group", "Choose an Excel file, then start grouping.", 0, "upload");
log("Ready. Choose one Excel voter-roll file to group by F.ID.");
