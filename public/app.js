/* =========================================================
   PRODUCT SERIAL & MODEL SCANNER FOR TALLY (V3.0)
========================================================= */

const MAX_IMAGES = 20;

const state = {
  images: [],
  results: [],
  perLine: Number(localStorage.getItem("pss_perLine") || 2),
  delimiter: localStorage.getItem("pss_delimiter") || "comma",
  includeModelHeaders: localStorage.getItem("pss_headers") !== "false",
  aiEnabled: false,
  scanning: false,
  cameraStream: null,
  cameraCapturedCount: 0,
  availableCameras: [],
  currentCameraIndex: 0
};

const $ = (id) => document.getElementById(id);

// DOM Elements
const imageInput = $("imageInput");
const imageGrid = $("imageGrid");
const emptyState = $("emptyState");
const imageCount = $("imageCount");
const batchLimitBadge = $("batchLimitBadge");
const dropZone = $("dropZone");

const cameraPanel = $("cameraPanel");
const cameraVideo = $("cameraVideo");
const cameraCapturedCount = $("cameraCapturedCount");
const switchCameraBtn = $("switchCameraBtn");

const progressBar = $("progressBar");
const progressText = $("progressText");
const scanSummary = $("scanSummary");

const groupList = $("groupList");
const noResults = $("noResults");
const serialCount = $("serialCount");
const addModelBtn = $("addModelBtn");

const tallyOutput = $("tallyOutput");
const includeModelHeaders = $("includeModelHeaders");
const delimiterSelect = $("delimiterSelect");
const copyStatus = $("copyStatus");
const advancedDetails = $("advancedDetails");
const aiBadge = $("aiBadge");
const toastContainer = $("toastContainer");

const STORAGE_KEY = "productSerialScannerBatch_v3";

/* =========================================================
   TOAST NOTIFICATIONS
========================================================= */

function showToast(message, type = "info", duration = 3000) {
  if (!toastContainer) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  const icon = type === "success" ? "✓" : type === "error" ? "✕" : type === "warning" ? "⚠️" : "ℹ️";
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-10px)";
    toast.style.transition = "all 0.25s ease";
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/* =========================================================
   HELPERS & UTILITIES
========================================================= */

function uid() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeSerial(value) {
  return String(value || "").trim().replace(/\.{2,}|…/g, "").replace(/\s+/g, "");
}

function serialKey(value) {
  return normalizeSerial(value).toUpperCase();
}

function unique(values) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const clean = String(value || "").trim();
    if (!clean) continue;
    const key = clean.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      output.push(clean);
    }
  }
  return output;
}

function looksLikeMac(value) {
  return /^([0-9A-F]{2}[:-]){5}[0-9A-F]{2}$/i.test(value);
}

function looksLikeEAN(value) {
  const clean = normalizeSerial(value);
  return (
    /^\d{8}$/.test(clean) ||
    /^\d{12}$/.test(clean) ||
    /^\d{13}$/.test(clean) ||
    /^\d{14}$/.test(clean)
  );
}

function looksLikeSerial(value) {
  const clean = normalizeSerial(value);
  if (!clean || clean.length < 4 || clean.length > 80) return false;
  if (looksLikeMac(clean) || looksLikeEAN(clean)) return false;
  return /[A-Za-z0-9]/.test(clean);
}

/* =========================================================
   HEALTH CHECK FOR AI SERVER
========================================================= */

async function checkHealth() {
  try {
    const res = await fetch("/api/health");
    const data = await res.json();
    state.aiEnabled = !!data.aiEnabled;
    if (aiBadge) {
      aiBadge.textContent = state.aiEnabled ? `AI Active (${data.model || "Vision"})` : "Local OCR Mode";
      aiBadge.className = `badge ${state.aiEnabled ? "on" : "off"}`;
    }
  } catch (err) {
    state.aiEnabled = false;
    if (aiBadge) {
      aiBadge.textContent = "Local OCR Mode";
      aiBadge.className = "badge off";
    }
  }
}
checkHealth();

/* =========================================================
   IMAGE MANAGEMENT & 20-IMAGE LIMIT
========================================================= */

function updateImageCount() {
  const count = state.images.length;
  if (imageCount) imageCount.textContent = `${count} / ${MAX_IMAGES} images`;
  if (batchLimitBadge) batchLimitBadge.textContent = `${count} / ${MAX_IMAGES} Photos`;
  if (emptyState) emptyState.classList.toggle("hidden", count > 0);
}

function renderImages() {
  imageGrid.innerHTML = "";

  state.images.forEach((item) => {
    const template = document.getElementById("imageTemplate").content.cloneNode(true);
    const article = template.querySelector(".image-card");
    const img = template.querySelector(".thumb");
    const name = template.querySelector(".image-name");
    const status = template.querySelector(".image-status");
    const remove = template.querySelector(".remove-image");

    img.src = item.previewUrl;
    name.textContent = item.name;
    status.textContent = item.status || "Waiting";
    status.className = `image-status ${item.statusClass || ""}`;

    remove.addEventListener("click", () => {
      state.images = state.images.filter((imgItem) => imgItem.id !== item.id);
      URL.revokeObjectURL(item.previewUrl);
      renderImages();
      renderAdvanced();
      saveState();
      showToast("Photo removed.", "info");
    });

    imageGrid.appendChild(article);
  });

  updateImageCount();
}

function addFiles(fileList) {
  const incomingFiles = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
  if (incomingFiles.length === 0) return;

  const currentCount = state.images.length;
  const availableSlots = MAX_IMAGES - currentCount;

  if (availableSlots <= 0) {
    showToast(`Maximum limit of ${MAX_IMAGES} images reached! Remove images to add more.`, "error");
    return;
  }

  let filesToAdd = incomingFiles;
  if (incomingFiles.length > availableSlots) {
    filesToAdd = incomingFiles.slice(0, availableSlots);
    showToast(`Added ${availableSlots} images. Reached maximum batch limit of ${MAX_IMAGES}.`, "warning");
  } else {
    showToast(`Added ${filesToAdd.length} image${filesToAdd.length > 1 ? "s" : ""}.`, "success");
  }

  for (const file of filesToAdd) {
    state.images.push({
      id: uid(),
      name: file.name || `Photo ${state.images.length + 1}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: "Waiting",
      statusClass: "",
      details: null
    });
  }

  renderImages();
  saveState();
}

// File Input Change
imageInput.addEventListener("change", (event) => {
  addFiles(event.target.files);
  event.target.value = "";
});

// Clear All Button
$("clearBtn").addEventListener("click", () => {
  if (state.images.length === 0 && state.results.length === 0) return;
  if (confirm("Are you sure you want to clear all images and scanned results?")) {
    state.images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    state.images = [];
    state.results = [];
    renderImages();
    renderResults();
    renderAdvanced();
    saveState();
    showToast("Batch cleared.", "info");
  }
});

/* =========================================================
   DRAG & DROP SUPPORT
========================================================= */

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove("drag-over");
  });
});

dropZone.addEventListener("drop", (e) => {
  const files = e.dataTransfer.files;
  addFiles(files);
});

/* =========================================================
   MULTI-SHOT CAMERA MODE
========================================================= */

async function initCameraDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    state.availableCameras = devices.filter((d) => d.kind === "videoinput");
    if (state.availableCameras.length > 1) {
      switchCameraBtn.classList.remove("hidden");
    } else {
      switchCameraBtn.classList.add("hidden");
    }
  } catch (err) {
    console.warn("Could not enumerate cameras:", err);
  }
}

$("cameraBtn").addEventListener("click", async () => {
  if (state.images.length >= MAX_IMAGES) {
    showToast(`Maximum limit of ${MAX_IMAGES} images reached!`, "error");
    return;
  }

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("Camera access is not supported by this browser.", "error");
      return;
    }

    await initCameraDevices();
    await startCameraStream();
    state.cameraCapturedCount = 0;
    cameraCapturedCount.textContent = `Captured: ${state.cameraCapturedCount}`;
    cameraPanel.classList.remove("hidden");
    showToast("Camera active. Snap photos continuously!", "info");
  } catch (error) {
    console.error("Camera error:", error);
    showToast(`Could not open camera: ${error.message}`, "error");
  }
});

async function startCameraStream() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
  }

  const deviceId = state.availableCameras[state.currentCameraIndex]?.deviceId;
  const constraints = {
    video: deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false
  };

  state.cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
  cameraVideo.srcObject = state.cameraStream;
}

switchCameraBtn.addEventListener("click", async () => {
  if (state.availableCameras.length < 2) return;
  state.currentCameraIndex = (state.currentCameraIndex + 1) % state.availableCameras.length;
  await startCameraStream();
});

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
  }
  state.cameraStream = null;
  cameraVideo.srcObject = null;
  cameraPanel.classList.add("hidden");
}

$("closeCameraBtn").addEventListener("click", stopCamera);

$("captureBtn").addEventListener("click", () => {
  if (!cameraVideo.videoWidth) {
    showToast("Camera is preparing...", "warning");
    return;
  }

  if (state.images.length >= MAX_IMAGES) {
    showToast(`Limit reached! Maximum ${MAX_IMAGES} images allowed per batch.`, "error");
    return;
  }

  // Visual shutter flash effect
  const container = cameraVideo.parentElement;
  container.classList.add("shutter-flash");
  setTimeout(() => container.classList.remove("shutter-flash"), 200);

  const canvas = document.createElement("canvas");
  const maxWidth = 2400;
  const scale = Math.min(1, maxWidth / cameraVideo.videoWidth);

  canvas.width = Math.round(cameraVideo.videoWidth * scale);
  canvas.height = Math.round(cameraVideo.videoHeight * scale);

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(cameraVideo, 0, 0, canvas.width, canvas.height);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
    addFiles([file]);

    state.cameraCapturedCount++;
    cameraCapturedCount.textContent = `Captured: ${state.cameraCapturedCount}`;
  }, "image/jpeg", 0.95);
});

/* =========================================================
   IMAGE PREPROCESSING & BARCODE / OCR ENGINE
========================================================= */

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function preprocessImage(file) {
  const source = await readFileAsDataUrl(file);
  const img = new Image();
  img.src = source;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  const originalWidth = img.naturalWidth;
  const originalHeight = img.naturalHeight;
  const targetWidth = Math.min(3000, Math.max(originalWidth, 2200));
  const scale = targetWidth / originalWidth;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(originalWidth * scale);
  canvas.height = Math.round(originalHeight * scale);

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    let value = ((gray - 128) * 1.35) + 136;
    value = Math.max(0, Math.min(255, value));
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.92);
}

async function detectNativeBarcodes(file) {
  if (!("BarcodeDetector" in window)) return [];
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    const detector = new BarcodeDetector({ formats });
    const bitmap = await createImageBitmap(file);
    const detected = await detector.detect(bitmap);
    bitmap.close();
    return detected.map((item) => item.rawValue).filter(Boolean);
  } catch (error) {
    return [];
  }
}

async function detectZXing(file) {
  if (!window.ZXingBrowser) return [];
  const url = URL.createObjectURL(file);
  try {
    const reader = new ZXingBrowser.BrowserMultiFormatReader();
    const result = await reader.decodeFromImageUrl(url);
    return result?.text ? [result.text] : [];
  } catch (error) {
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function detectBarcodes(file) {
  let values = await detectNativeBarcodes(file);
  if (values.length) return unique(values);
  values = await detectZXing(file);
  return unique(values);
}

async function runOCR(file) {
  if (!window.Tesseract) throw new Error("Tesseract.js was not loaded.");

  let result = await Tesseract.recognize(file, "eng", {
    logger: (info) => {
      if (info.status === "recognizing text" && typeof info.progress === "number") {
        progressText.textContent = `OCR ${Math.round(info.progress * 100)}%`;
      }
    }
  });

  let text = result?.data?.text || "";

  if (text.trim().length < 20) {
    const enhanced = await preprocessImage(file);
    result = await Tesseract.recognize(enhanced, "eng", {
      logger: (info) => {
        if (info.status === "recognizing text" && typeof info.progress === "number") {
          progressText.textContent = `Enhanced OCR ${Math.round(info.progress * 100)}%`;
        }
      }
    });
    const secondText = result?.data?.text || "";
    if (secondText.trim().length > text.trim().length) text = secondText;
  }
  return text;
}

/* =========================================================
   SERIAL & MODEL EXTRACTION
========================================================= */

function cleanOCRLine(line) {
  return String(line || "").replace(/[|]/g, "I").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
}

function extractSerialsFromOCR(text) {
  const results = [];
  const lines = text.split(/\r?\n/).map(cleanOCRLine).filter(Boolean);

  const serialLabelRegex = /^(?:serial\s*(?:number|no\.?|#)?|s\s*\/\s*n|s\.n\.?|sn)\s*[:#\-]?\s*(.+)$/i;
  for (const line of lines) {
    const match = line.match(serialLabelRegex);
    if (!match) continue;
    const value = match[1].trim().replace(/^[\s:;|]+/, "");
    const pieces = value.split(/\s{2,}|[,;|]/).map((x) => x.trim()).filter(Boolean);
    for (const piece of pieces) {
      if (looksLikeSerial(piece)) results.push(piece);
    }
  }

  const inlineRegex = /(?:serial\s*(?:number|no\.?|#)?|s\s*\/\s*n|s\.n\.?|sn)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9._\/-]{3,})/gi;
  let match;
  while ((match = inlineRegex.exec(text)) !== null) {
    if (looksLikeSerial(match[1].trim())) results.push(match[1].trim());
  }

  const fuzzyRegex = /(?:ser[i1l][a-z1l]{2,4}\s*(?:no|number|n[o0])?)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9._\/-]{3,})/gi;
  while ((match = fuzzyRegex.exec(text)) !== null) {
    if (looksLikeSerial(match[1].trim())) results.push(match[1].trim());
  }

  return unique(results).filter(looksLikeSerial);
}

function extractModel(text) {
  const regex = /(?:model\s*(?:number|no\.?|#)?|part\s*(?:number|no\.?|#)?|type)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9._\/-]{1,79})/i;
  const match = text.match(regex);
  return match?.[1]?.trim() || "";
}

function extractProduct(text) {
  const lines = text.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const labels = /^(?:product|product\s*name|description|device|brand)\s*[:#\-]?\s*(.+)$/i;

  for (const line of lines) {
    const match = line.match(labels);
    if (match) return match[1].trim();
  }

  for (const line of lines.slice(0, 8)) {
    if (line.length >= 4 && line.length <= 80 && /[A-Za-z]{3,}/.test(line) && !/serial|model|ean|upc|gtin|mac/i.test(line)) {
      return line;
    }
  }
  return "";
}

/* =========================================================
   MODEL CATEGORIZATION & GROUPING
========================================================= */

function getGroup(productName, model) {
  const cleanModel = String(model || "").trim();
  const cleanProduct = String(productName || "").trim();
  const normalizedModel = cleanModel.toUpperCase();

  if (normalizedModel) {
    const existing = state.results.find((g) => g.model && g.model.trim().toUpperCase() === normalizedModel);
    if (existing) return existing;
  }

  const displayName = cleanModel ? cleanModel : cleanProduct ? cleanProduct : "General Inventory";
  const key = cleanModel ? `MODEL:${normalizedModel}` : `GROUP:${displayName.toUpperCase()}`;

  let group = state.results.find((item) => item.key === key);
  if (!group) {
    group = {
      id: uid(),
      key,
      productName: cleanProduct || "Product",
      model: cleanModel || displayName,
      serials: [],
      confidence: "medium",
      sources: [],
      notes: []
    };
    state.results.push(group);
  }

  return group;
}

function mergeResult({ productName, model, serials, imageId, confidence, notes }) {
  const group = getGroup(productName, model);

  if (productName && (!group.productName || group.productName === "Product")) {
    group.productName = productName;
  }
  if (model && !group.model) {
    group.model = model;
  }

  for (const serial of serials || []) {
    const clean = normalizeSerial(serial);
    if (!clean) continue;
    const exists = group.serials.some((ex) => serialKey(ex) === serialKey(clean));
    if (!exists) group.serials.push(clean);
  }

  if (imageId && !group.sources.includes(imageId)) group.sources.push(imageId);
  if (notes) group.notes.push(notes);
  group.confidence = confidence || group.confidence;
}

/* =========================================================
   GROQ AI VISION FALLBACK
========================================================= */

async function askQwen(imageDataUrl, ocrText, barcodeCandidates) {
  const response = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl, ocrText, barcodeCandidates })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `AI request failed with status ${response.status}`);
  }
  return data.result;
}

function shouldUseAI(local) {
  if (!state.aiEnabled) return false;
  return local.serials.length === 0 || !local.model || local.confidence === "low";
}

/* =========================================================
   PROCESS SINGLE IMAGE
========================================================= */

async function processImage(item, index, total) {
  item.status = "Scanning barcodes...";
  item.statusClass = "busy";
  renderImages();

  let barcodeCandidates = [];
  let ocrText = "";
  let serials = [];
  let model = "";
  let productName = "";
  let confidence = "low";
  let notes = "";

  try {
    barcodeCandidates = await detectBarcodes(item.file);
  } catch (err) {
    notes += `Barcode error: ${err.message}\n`;
  }

  try {
    item.status = "Running OCR...";
    renderImages();

    ocrText = await runOCR(item.file);
    serials = extractSerialsFromOCR(ocrText);
    model = extractModel(ocrText);
    productName = extractProduct(ocrText);

    for (const barcode of barcodeCandidates) {
      if (looksLikeSerial(barcode)) serials.push(barcode);
    }
    serials = unique(serials).filter(looksLikeSerial);

    confidence = serials.length && model ? "high" : serials.length ? "medium" : "low";
  } catch (err) {
    notes += `OCR error: ${err.message}\n`;
  }

  const local = { serials, model, productName, confidence };

  if (shouldUseAI(local)) {
    item.status = "AI Vision scanning...";
    item.statusClass = "busy";
    renderImages();

    try {
      const imageDataUrl = await preprocessImage(item.file);
      const ai = await askQwen(imageDataUrl, ocrText, barcodeCandidates);

      productName = ai.productName || productName;
      model = ai.model || model;
      serials = unique([...serials, ...(ai.serialNumbers || [])]).filter(looksLikeSerial);
      confidence = ai.confidence || confidence;
      if (ai.notes) notes += `AI: ${ai.notes}\n`;
    } catch (err) {
      notes += `AI error: ${err.message}\n`;
    }
  }

  mergeResult({ productName, model, serials, imageId: item.id, confidence, notes });

  item.status = serials.length ? `${serials.length} serial${serials.length === 1 ? "" : "s"} found` : "No serial found";
  item.statusClass = serials.length ? "ok" : "error";
  item.details = { barcodeCandidates, ocrText, localSerials: serials, productName, model, confidence, notes };

  renderImages();
  renderResults();
  renderAdvanced();
}

/* =========================================================
   SCAN ALL IMAGES
========================================================= */

async function scanAll() {
  if (state.scanning) return;
  if (!state.images.length) {
    showToast("Please add at least one image before scanning.", "warning");
    return;
  }

  state.scanning = true;
  state.results = [];
  progressBar.style.width = "0%";
  progressText.textContent = "Starting scan...";
  scanSummary.textContent = "Processing image batch...";
  renderResults();

  try {
    const total = state.images.length;
    for (let i = 0; i < total; i++) {
      await processImage(state.images[i], i, total);
      const pct = Math.round(((i + 1) / total) * 100);
      progressBar.style.width = `${pct}%`;
      progressText.textContent = `${i + 1} / ${total} images processed (${pct}%)`;
    }

    const totalSerials = state.results.reduce((sum, g) => sum + g.serials.length, 0);
    scanSummary.textContent = `Completed! ${totalSerials} serial${totalSerials === 1 ? "" : "s"} extracted across ${state.results.length} model categories.`;
    progressText.textContent = "Scan Complete";
    showToast(`Scan complete! Found ${totalSerials} serials.`, "success");
    saveState();
  } catch (error) {
    console.error("Scan error:", error);
    scanSummary.textContent = `Error: ${error.message}`;
    showToast(`Scan failed: ${error.message}`, "error");
  } finally {
    state.scanning = false;
  }
}

$("scanAllBtn").addEventListener("click", scanAll);

/* =========================================================
   RESULTS UI & SEPARATE MODEL CONTAINERS
========================================================= */

function renderResults() {
  groupList.innerHTML = "";
  let totalSerialsCount = 0;

  state.results.forEach((group, groupIdx) => {
    totalSerialsCount += group.serials.length;

    const box = document.createElement("article");
    box.className = "model-group-card";

    // 1. Header Bar
    const head = document.createElement("div");
    head.className = "model-group-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "model-title-edit";

    const modelInput = document.createElement("input");
    modelInput.type = "text";
    modelInput.className = "model-name-input";
    modelInput.value = group.model || "Model Name";
    modelInput.placeholder = "Enter Model Name";
    modelInput.addEventListener("change", () => {
      group.model = modelInput.value;
      updateTallyOutput();
      saveState();
    });

    titleWrap.appendChild(modelInput);

    const rightActions = document.createElement("div");
    rightActions.className = "group-actions-right";

    const badge = document.createElement("span");
    badge.className = "counter-badge";
    badge.textContent = `${group.serials.length} serials`;

    const removeGroupBtn = document.createElement("button");
    removeGroupBtn.type = "button";
    removeGroupBtn.className = "delete-serial-btn";
    removeGroupBtn.innerHTML = "&times;";
    removeGroupBtn.title = "Delete Model Container";
    removeGroupBtn.addEventListener("click", () => {
      state.results.splice(groupIdx, 1);
      renderResults();
      saveState();
      showToast("Model container deleted.", "info");
    });

    rightActions.append(badge, removeGroupBtn);
    head.append(titleWrap, rightActions);
    box.appendChild(head);

    // 2. Serials Input List
    const list = document.createElement("div");
    list.className = "serial-row-list";

    group.serials.forEach((serial, sIdx) => {
      const row = document.createElement("div");
      row.className = "serial-row-item";

      const indexSpan = document.createElement("span");
      indexSpan.className = "serial-index";
      indexSpan.textContent = String(sIdx + 1);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "serial-input";
      input.value = serial;
      input.addEventListener("input", () => {
        group.serials[sIdx] = input.value;
        updateTallyOutput();
        saveState();
      });

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "delete-serial-btn";
      removeBtn.innerHTML = "&times;";
      removeBtn.title = "Delete serial";
      removeBtn.addEventListener("click", () => {
        group.serials.splice(sIdx, 1);
        renderResults();
        saveState();
      });

      row.append(indexSpan, input, removeBtn);
      list.appendChild(row);
    });

    const addSerialBtn = document.createElement("button");
    addSerialBtn.type = "button";
    addSerialBtn.className = "add-serial-btn";
    addSerialBtn.textContent = "+ Add Serial Number";
    addSerialBtn.addEventListener("click", () => {
      group.serials.push("");
      renderResults();
      saveState();
    });

    box.append(list, addSerialBtn);

    // 3. Dedicated Model Output Container Box
    const tallyBox = document.createElement("div");
    tallyBox.className = "model-tally-box";

    const tallyLabel = document.createElement("div");
    tallyLabel.className = "model-tally-label";
    tallyLabel.innerHTML = `<span>📋 Tally Output: <strong>${group.model || "Model"}</strong></span>`;

    const modelArea = document.createElement("textarea");
    modelArea.className = "model-preview-textarea";
    modelArea.id = `modelArea_${group.id}`;
    modelArea.readOnly = true;
    modelArea.rows = 2;

    const actionContainer = document.createElement("div");
    actionContainer.className = "model-container-actions";

    const copyModelNameBtn = document.createElement("button");
    copyModelNameBtn.type = "button";
    copyModelNameBtn.className = "btn secondary-btn small-btn";
    copyModelNameBtn.innerHTML = `🏷️ Copy Model Name`;
    copyModelNameBtn.title = "Copy only the Model Name (e.g. CP-UNR-104F1)";
    copyModelNameBtn.addEventListener("click", () => {
      const text = group.model || "Model";
      navigator.clipboard.writeText(text).then(() => {
        showToast(`Copied model name "${text}" to clipboard!`, "success");
      });
    });

    const serialsOnlyCopyBtn = document.createElement("button");
    serialsOnlyCopyBtn.type = "button";
    serialsOnlyCopyBtn.className = "btn copy-model-btn";
    serialsOnlyCopyBtn.innerHTML = `📋 Copy Serials Only`;
    serialsOnlyCopyBtn.title = "Copy serial numbers for Tally without Model Name";
    serialsOnlyCopyBtn.addEventListener("click", () => copyModelContainer(group, false));

    const mainCopyBtn = document.createElement("button");
    mainCopyBtn.type = "button";
    mainCopyBtn.className = "btn secondary-btn small-btn";
    mainCopyBtn.innerHTML = `📋 Copy Model + Serials`;
    mainCopyBtn.title = "Copy Model Name on Line 1, Serials on Line 2 (Windows CRLF)";
    mainCopyBtn.addEventListener("click", () => copyModelContainer(group, true));

    const saveTxtBtn = document.createElement("button");
    saveTxtBtn.type = "button";
    saveTxtBtn.className = "btn secondary-btn small-btn";
    saveTxtBtn.textContent = "💾 Save TXT";
    saveTxtBtn.addEventListener("click", () => downloadModelTxt(group));

    actionContainer.append(serialsOnlyCopyBtn, copyModelNameBtn, mainCopyBtn, saveTxtBtn);
    tallyBox.append(tallyLabel, modelArea, actionContainer);
    box.appendChild(tallyBox);

    groupList.appendChild(box);
  });

  serialCount.textContent = `${totalSerialsCount} Serial${totalSerialsCount === 1 ? "" : "s"}`;
  noResults.classList.toggle("hidden", state.results.length > 0);
  updateTallyOutput();
}

addModelBtn.addEventListener("click", () => {
  const newGroup = {
    id: uid(),
    key: `CUSTOM:${Date.now()}`,
    productName: "Product",
    model: "NEW-MODEL-01",
    serials: [""],
    confidence: "high",
    sources: [],
    notes: []
  };
  state.results.push(newGroup);
  renderResults();
  saveState();
  showToast("Added new Model Container.", "info");
});

/* =========================================================
   TALLY OUTPUT GENERATION FOR EACH CONTAINER
========================================================= */

function getDelimiterString() {
  switch (state.delimiter) {
    case "space": return " ";
    case "comma_no_space": return ",";
    case "tab": return "\t";
    case "comma":
    default: return ", ";
  }
}

function formatSerialsChunk(serialsList, perLine, sep) {
  const lines = [];
  for (let i = 0; i < serialsList.length; i += perLine) {
    const chunk = serialsList.slice(i, i + perLine);
    lines.push(chunk.join(sep));
  }
  return lines.join("\r\n");
}

function updateTallyOutput() {
  const sep = getDelimiterString();
  const perLine = state.perLine || 2;
  const includeHeaders = includeModelHeaders ? includeModelHeaders.checked : true;

  if (state.results.length === 0) {
    if (tallyOutput) tallyOutput.value = "";
    return;
  }

  const allSections = [];

  for (const group of state.results) {
    const validSerials = (group.serials || []).map(normalizeSerial).filter(Boolean);
    const formattedBlock = formatSerialsChunk(validSerials, perLine, sep);

    const modelOutputText = includeHeaders
      ? (group.model ? `${group.model}\r\n${formattedBlock}` : formattedBlock)
      : formattedBlock;

    // Update individual model textarea preview inside container
    const area = document.getElementById(`modelArea_${group.id}`);
    if (area) {
      area.value = modelOutputText || "No valid serials";
    }

    if (validSerials.length > 0) {
      allSections.push(modelOutputText);
    }
  }

  if (tallyOutput) {
    tallyOutput.value = allSections.join("\r\n\r\n");
  }
}

function copyModelContainer(group, includeHeaderInCopy) {
  const validSerials = (group.serials || []).map(normalizeSerial).filter(Boolean);
  if (!validSerials.length) {
    showToast(`No serials to copy in ${group.model || "this model"}.`, "warning");
    return;
  }

  const sep = getDelimiterString();
  const formattedBlock = formatSerialsChunk(validSerials, state.perLine, sep);
  const textToCopy = includeHeaderInCopy && includeModelHeaders && includeModelHeaders.checked
    ? (group.model ? `${group.model}\r\n${formattedBlock}` : formattedBlock)
    : formattedBlock;

  navigator.clipboard.writeText(textToCopy).then(() => {
    showToast(`Copied ${includeHeaderInCopy ? "Model + Serials" : "Serials"} to clipboard!`, "success");
  }).catch((err) => {
    showToast(`Copy failed: ${err.message}`, "error");
  });
}

function downloadModelTxt(group) {
  const validSerials = (group.serials || []).map(normalizeSerial).filter(Boolean);
  if (!validSerials.length) {
    showToast("No serials to download.", "warning");
    return;
  }
  const sep = getDelimiterString();
  const formattedBlock = formatSerialsChunk(validSerials, state.perLine, sep);
  const text = group.model ? `${group.model}\r\n${formattedBlock}` : formattedBlock;

  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${(group.model || "model").replace(/[^a-z0-9]/gi, "_")}_serials.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast(`Downloaded TXT for ${group.model}.`, "success");
}

/* Radio buttons for 1, 2, 3, 4 line breaks */
document.querySelectorAll('input[name="perLine"]').forEach((radio) => {
  radio.checked = Number(radio.value) === state.perLine;
  radio.addEventListener("change", () => {
    state.perLine = Number(radio.value);
    localStorage.setItem("pss_perLine", String(state.perLine));
    updateTallyOutput();
    showToast(`Line break set to ${state.perLine} serials per line.`, "info");
  });
});

if (includeModelHeaders) {
  includeModelHeaders.checked = state.includeModelHeaders;
  includeModelHeaders.addEventListener("change", () => {
    state.includeModelHeaders = includeModelHeaders.checked;
    localStorage.setItem("pss_headers", String(state.includeModelHeaders));
    updateTallyOutput();
  });
}

if (delimiterSelect) {
  delimiterSelect.value = state.delimiter;
  delimiterSelect.addEventListener("change", () => {
    state.delimiter = delimiterSelect.value;
    localStorage.setItem("pss_delimiter", state.delimiter);
    updateTallyOutput();
  });
}

/* Main Copy Button */
$("copyBtn").addEventListener("click", async () => {
  const content = tallyOutput.value;
  if (!content.trim()) {
    showToast("Nothing to copy yet. Add and scan images first!", "warning");
    return;
  }

  try {
    await navigator.clipboard.writeText(content);
    if (copyStatus) copyStatus.textContent = "✓ Copied to Clipboard!";
    showToast("Copied all serials to clipboard for Tally!", "success");
    setTimeout(() => { if (copyStatus) copyStatus.textContent = ""; }, 4000);
  } catch (err) {
    showToast(`Copy failed: ${err.message}`, "error");
  }
});

/* Export TXT & CSV */
$("downloadTxtBtn").addEventListener("click", () => {
  const content = tallyOutput.value;
  if (!content.trim()) {
    showToast("No data to export.", "warning");
    return;
  }
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `tally_serials_${Date.now()}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Downloaded TXT export.", "success");
});

$("downloadCsvBtn").addEventListener("click", () => {
  if (state.results.length === 0) {
    showToast("No data to export.", "warning");
    return;
  }

  const rows = [["Model", "Product Name", "Serial Number"]];
  for (const group of state.results) {
    for (const serial of group.serials) {
      const clean = normalizeSerial(serial);
      if (clean) {
        rows.push([`"${group.model}"`, `"${group.productName}"`, `"${clean}"`]);
      }
    }
  }

  const csvContent = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `tally_serials_${Date.now()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Exported CSV file.", "success");
});

/* =========================================================
   ADVANCED DIAGNOSTICS & STATE PERSISTENCE
========================================================= */

function renderAdvanced() {
  if (!advancedDetails) return;
  const debugData = {
    totalImages: state.images.length,
    resultsCount: state.results.length,
    perLine: state.perLine,
    delimiter: state.delimiter,
    includeModelHeaders: state.includeModelHeaders,
    aiEnabled: state.aiEnabled,
    images: state.images.map((img) => ({ name: img.name, status: img.status, details: img.details })),
    results: state.results
  };
  advancedDetails.innerHTML = `<pre>${JSON.stringify(debugData, null, 2)}</pre>`;
}

function saveState() {
  try {
    const dataToSave = {
      results: state.results,
      perLine: state.perLine,
      delimiter: state.delimiter,
      includeModelHeaders: state.includeModelHeaders
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
  } catch (err) {
    console.warn("Could not save state to localStorage:", err);
  }
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed.results)) state.results = parsed.results;
      renderResults();
      renderAdvanced();
    }
  } catch (err) {
    console.warn("Could not load saved state:", err);
  }
}

loadState();
updateImageCount();

/* =========================================================
   BETTER AUTH & GOOGLE OAUTH FRONTEND INTEGRATION
========================================================= */

const openAuthModalBtn = $("openAuthModalBtn");
const closeAuthModalBtn = $("closeAuthModalBtn");
const authModal = $("authModal");
const userLoggedInView = $("userLoggedInView");
const userAvatar = $("userAvatar");
const userName = $("userName");
const logoutBtn = $("logoutBtn");
const googleSignInBtn = $("googleSignInBtn");

const tabSignIn = $("tabSignIn");
const tabSignUp = $("tabSignUp");
const signInForm = $("signInForm");
const signUpForm = $("signUpForm");

let currentUser = null;

// Modal Toggles
openAuthModalBtn?.addEventListener("click", () => {
  authModal?.classList.remove("hidden");
});

closeAuthModalBtn?.addEventListener("click", () => {
  authModal?.classList.add("hidden");
});

authModal?.addEventListener("click", (e) => {
  if (e.target === authModal) authModal.classList.add("hidden");
});

// Auth Tabs Switch
tabSignIn?.addEventListener("click", () => {
  tabSignIn.classList.add("active");
  tabSignUp.classList.remove("active");
  signInForm?.classList.remove("hidden");
  signUpForm?.classList.add("hidden");
});

tabSignUp?.addEventListener("click", () => {
  tabSignUp.classList.add("active");
  tabSignIn.classList.remove("active");
  signUpForm?.classList.remove("hidden");
  signInForm?.classList.add("hidden");
});

// Google OAuth Sign In
googleSignInBtn?.addEventListener("click", async () => {
  try {
    showToast("Redirecting to Google Sign-In...", "info");
    window.location.href = "/api/auth/sign-in/social?provider=google&callbackURL=" + encodeURIComponent(window.location.origin);
  } catch (err) {
    showToast(`Google Auth Error: ${err.message}`, "error");
  }
});

// Email Sign In
signInForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("signInEmail").value;
  const password = $("signInPassword").value;

  try {
    const res = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || "Invalid credentials");

    showToast("Signed in successfully!", "success");
    authModal?.classList.add("hidden");
    await checkSession();
  } catch (err) {
    showToast(`Sign in failed: ${err.message}`, "error");
  }
});

// Email Sign Up
signUpForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("signUpName").value;
  const email = $("signUpEmail").value;
  const password = $("signUpPassword").value;

  try {
    const res = await fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || "Registration failed");

    showToast("Account created successfully!", "success");
    authModal?.classList.add("hidden");
    await checkSession();
  } catch (err) {
    showToast(`Sign up failed: ${err.message}`, "error");
  }
});

// Logout
logoutBtn?.addEventListener("click", async () => {
  try {
    await fetch("/api/auth/sign-out", { method: "POST" });
    currentUser = null;
    updateAuthUI();
    showToast("Logged out successfully.", "info");
  } catch (err) {
    showToast(`Logout error: ${err.message}`, "error");
  }
});

// Check Session on Load
async function checkSession() {
  try {
    const res = await fetch("/api/auth/get-session");
    if (!res.ok) {
      currentUser = null;
      updateAuthUI();
      return;
    }
    const data = await res.json();
    currentUser = data?.user || null;
    updateAuthUI();
  } catch (err) {
    currentUser = null;
    updateAuthUI();
  }
}

function updateAuthUI() {
  if (currentUser) {
    if (userName) userName.textContent = currentUser.name || currentUser.email || "User";
    if (userAvatar) {
      userAvatar.src = currentUser.image || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name || "User")}&background=38bdf8&color=04131d`;
    }
    userLoggedInView?.classList.remove("hidden");
    openAuthModalBtn?.classList.add("hidden");
  } else {
    userLoggedInView?.classList.add("hidden");
    openAuthModalBtn?.classList.remove("hidden");
  }
}

checkSession();