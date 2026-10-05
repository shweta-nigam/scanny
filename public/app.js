const state = {
  images: [],
  results: [],
  perLine: Number(localStorage.getItem("pss_perLine") || 2),
  aiEnabled: false,
  scanning: false,
  cameraStream: null
};

const $ = (id) => document.getElementById(id);

const imageInput = $("imageInput");
const imageGrid = $("imageGrid");
const emptyState = $("emptyState");
const imageCount = $("imageCount");
const cameraPanel = $("cameraPanel");
const cameraVideo = $("cameraVideo");
const progressBar = $("progressBar");
const progressText = $("progressText");
const scanSummary = $("scanSummary");
const groupList = $("groupList");
const noResults = $("noResults");
const serialCount = $("serialCount");
const tallyOutput = $("tallyOutput");
const advancedDetails = $("advancedDetails");
const aiBadge = $("aiBadge");

const STORAGE_KEY = "productSerialScannerBatchV3";

/* =========================================================
   BASIC HELPERS
========================================================= */

function uid() {
  return crypto.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeSerial(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "");
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

  if (!clean) return false;

  if (clean.length < 4) return false;

  if (clean.length > 80) return false;

  if (looksLikeMac(clean)) return false;

  /*
    Pure 8/12/13/14 digit values are more likely
    to be EAN/UPC/GTIN than serial numbers.
  */
  if (looksLikeEAN(clean)) return false;

  return /[A-Za-z0-9]/.test(clean);
}


/* =========================================================
   IMAGE MANAGEMENT
========================================================= */

function updateImageCount() {
  imageCount.textContent =
    `${state.images.length} image${state.images.length === 1 ? "" : "s"}`;

  emptyState.classList.toggle(
    "hidden",
    state.images.length > 0
  );
}

function renderImages() {
  imageGrid.innerHTML = "";

  state.images.forEach((item) => {
    const template = document
      .getElementById("imageTemplate")
      .content
      .cloneNode(true);

    const article = template.querySelector(".image-item");
    const img = template.querySelector(".thumb");
    const name = template.querySelector(".image-name");
    const status = template.querySelector(".image-status");
    const remove = template.querySelector(".remove-image");

    img.src = item.previewUrl;

    name.textContent = item.name;

    status.textContent = item.status || "Waiting";

    status.className =
      `image-status ${item.statusClass || ""}`;

    remove.addEventListener("click", () => {
      state.images = state.images.filter(
        (image) => image.id !== item.id
      );

      URL.revokeObjectURL(item.previewUrl);

      renderImages();
      renderAdvanced();
    });

    imageGrid.appendChild(article);
  });

  updateImageCount();
}

function addFiles(fileList) {
  const files = Array.from(fileList || [])
    .filter((file) => file.type.startsWith("image/"));

  for (const file of files) {
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
}

imageInput.addEventListener("change", (event) => {
  addFiles(event.target.files);

  // Allow selecting the same image again later.
  event.target.value = "";
});


/* =========================================================
   CAMERA
========================================================= */

$("cameraBtn").addEventListener("click", async () => {
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      alert("Camera access is not supported by this browser.");
      return;
    }

    state.cameraStream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: {
            ideal: "environment"
          },
          width: {
            ideal: 1920
          },
          height: {
            ideal: 1080
          }
        },
        audio: false
      });

    cameraVideo.srcObject = state.cameraStream;

    cameraPanel.classList.remove("hidden");

  } catch (error) {
    console.error("Camera error:", error);

    alert(
      `Could not open camera.\n\n${error.message}`
    );
  }
});


function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream
      .getTracks()
      .forEach((track) => track.stop());
  }

  state.cameraStream = null;

  cameraVideo.srcObject = null;

  cameraPanel.classList.add("hidden");
}


$("closeCameraBtn").addEventListener(
  "click",
  stopCamera
);


$("captureBtn").addEventListener(
  "click",
  () => {
    if (!cameraVideo.videoWidth) {
      alert("Camera is not ready yet.");
      return;
    }

    const canvas =
      document.createElement("canvas");

    const maxWidth = 2400;

    const scale = Math.min(
      1,
      maxWidth / cameraVideo.videoWidth
    );

    canvas.width =
      Math.round(cameraVideo.videoWidth * scale);

    canvas.height =
      Math.round(cameraVideo.videoHeight * scale);

    const ctx =
      canvas.getContext("2d", {
        alpha: false
      });

    ctx.drawImage(
      cameraVideo,
      0,
      0,
      canvas.width,
      canvas.height
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) return;

        const file =
          new File(
            [blob],
            `camera-${Date.now()}.jpg`,
            {
              type: "image/jpeg"
            }
          );

        addFiles([file]);
      },
      "image/jpeg",
      0.95
    );
  }
);


/* =========================================================
   FILE -> DATA URL
========================================================= */

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader =
      new FileReader();

    reader.onload =
      () => resolve(reader.result);

    reader.onerror =
      reject;

    reader.readAsDataURL(file);
  });
}


/* =========================================================
   IMAGE PREPROCESSING
========================================================= */

/*
  This is important for your product labels.

  A full photograph may contain a small label.
  OCR performs much better after enlarging and
  increasing contrast.
*/

async function preprocessImage(file) {
  const source =
    await readFileAsDataUrl(file);

  const img =
    new Image();

  img.src = source;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  const originalWidth =
    img.naturalWidth;

  const originalHeight =
    img.naturalHeight;

  /*
    Upscale smaller images.
    Limit very large images.
  */
  const targetWidth =
    Math.min(
      3000,
      Math.max(
        originalWidth,
        2200
      )
    );

  const scale =
    targetWidth / originalWidth;

  const canvas =
    document.createElement("canvas");

  canvas.width =
    Math.round(originalWidth * scale);

  canvas.height =
    Math.round(originalHeight * scale);

  const ctx =
    canvas.getContext("2d", {
      willReadFrequently: true
    });

  ctx.drawImage(
    img,
    0,
    0,
    canvas.width,
    canvas.height
  );

  /*
    Increase contrast and brightness.
  */

  const imageData =
    ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

  const data =
    imageData.data;

  for (
    let i = 0;
    i < data.length;
    i += 4
  ) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    /*
      Grayscale
    */
    const gray =
      0.299 * r +
      0.587 * g +
      0.114 * b;

    /*
      Contrast
    */
    const contrast = 1.35;

    let value =
      ((gray - 128) * contrast) + 128;

    /*
      Slight brightness boost
    */
    value += 8;

    value =
      Math.max(
        0,
        Math.min(255, value)
      );

    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  ctx.putImageData(
    imageData,
    0,
    0
  );

  return canvas.toDataURL(
    "image/jpeg",
    0.92
  );
}


/* =========================================================
   BARCODE DETECTION
========================================================= */

async function detectNativeBarcodes(file) {

  console.log(
    "BarcodeDetector available:",
    "BarcodeDetector" in window
  );

  if (!("BarcodeDetector" in window)) {
    return [];
  }

  try {
    const formats =
      await BarcodeDetector.getSupportedFormats();

    console.log(
      "Supported barcode formats:",
      formats
    );

    const detector =
      new BarcodeDetector({
        formats
      });

    const bitmap =
      await createImageBitmap(file);

    const detected =
      await detector.detect(bitmap);

    bitmap.close();

    const values =
      detected
        .map((item) => item.rawValue)
        .filter(Boolean);

    console.log(
      "Native barcode results:",
      values
    );

    return values;

  } catch (error) {

    console.warn(
      "Native barcode detection failed:",
      error
    );

    return [];
  }
}


async function detectZXing(file) {

  console.log(
    "ZXing available:",
    Boolean(window.ZXingBrowser)
  );

  if (!window.ZXingBrowser) {
    return [];
  }

  const url =
    URL.createObjectURL(file);

  try {

    const reader =
      new ZXingBrowser.BrowserMultiFormatReader();

    /*
      Try image decoding.
    */

    const result =
      await reader.decodeFromImageUrl(url);

    if (!result) {
      return [];
    }

    const value =
      result.text || "";

    console.log(
      "ZXing result:",
      value
    );

    return value ? [value] : [];

  } catch (error) {

    console.warn(
      "ZXing barcode detection failed:",
      error
    );

    return [];

  } finally {

    URL.revokeObjectURL(url);
  }
}


async function detectBarcodes(file) {

  let values =
    await detectNativeBarcodes(file);

  if (values.length) {
    return unique(values);
  }

  values =
    await detectZXing(file);

  return unique(values);
}


/* =========================================================
   OCR
========================================================= */

async function runOCR(file) {

  if (!window.Tesseract) {
    throw new Error(
      "Tesseract.js was not loaded."
    );
  }

  console.log(
    "Starting OCR..."
  );

  /*
    First attempt:
    original image.
  */

  let result =
    await Tesseract.recognize(
      file,
      "eng",
      {
        logger: (info) => {

          if (
            info.status ===
              "recognizing text" &&
            typeof info.progress ===
              "number"
          ) {

            const percentage =
              Math.round(
                info.progress * 100
              );

            progressText.textContent =
              `OCR ${percentage}%`;
          }

        }
      }
    );

  let text =
    result?.data?.text || "";

  console.log(
    "FIRST OCR RESULT:",
    text
  );

  /*
    If OCR result is extremely poor,
    run it again on a processed image.
  */

  if (
    text.trim().length < 20
  ) {

    console.log(
      "OCR result is weak. Trying enhanced image..."
    );

    const enhanced =
      await preprocessImage(file);

    result =
      await Tesseract.recognize(
        enhanced,
        "eng",
        {
          logger: (info) => {

            if (
              info.status ===
                "recognizing text" &&
              typeof info.progress ===
                "number"
            ) {

              const percentage =
                Math.round(
                  info.progress * 100
                );

              progressText.textContent =
                `Enhanced OCR ${percentage}%`;
            }

          }
        }
      );

    const secondText =
      result?.data?.text || "";

    console.log(
      "ENHANCED OCR RESULT:",
      secondText
    );

    if (
      secondText.trim().length >
      text.trim().length
    ) {
      text = secondText;
    }
  }

  console.log(
    "FINAL OCR TEXT:",
    text
  );

  return text;
}


/* =========================================================
   SERIAL EXTRACTION
========================================================= */

function cleanOCRLine(line) {

  return String(line || "")
    .replace(/[|]/g, "I")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();

}


function extractSerialsFromOCR(text) {

  console.log(
    "Searching OCR for serial numbers..."
  );

  const results = [];

  const lines =
    text
      .split(/\r?\n/)
      .map(cleanOCRLine)
      .filter(Boolean);

  /*
    First: explicitly labelled serial fields.
  */

  const serialLabelRegex =
    /^(?:serial\s*(?:number|no\.?|#)?|s\s*\/\s*n|s\.n\.?|sn)\s*[:#\-]?\s*(.+)$/i;

  for (const line of lines) {

    const match =
      line.match(serialLabelRegex);

    if (!match) continue;

    const value =
      match[1]
        .trim()
        .replace(
          /^[\s:;|]+/,
          ""
        );

    console.log(
      "Serial-labelled line:",
      line,
      "=>",
      value
    );

    /*
      Sometimes OCR puts multiple values
      on the same line.
    */

    const pieces =
      value
        .split(
          /\s{2,}|[,;|]/
        )
        .map((x) => x.trim())
        .filter(Boolean);

    for (const piece of pieces) {

      if (
        looksLikeSerial(piece)
      ) {
        results.push(piece);
      }
    }
  }


  /*
    Second: handle labels embedded in a line.

    Example:

    Serial No: EVAN26051910100835
  */

  const inlineRegex =
    /(?:serial\s*(?:number|no\.?|#)?|s\s*\/\s*n|s\.n\.?|sn)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9._\/-]{3,})/gi;

  let match;

  while (
    (match =
      inlineRegex.exec(text)) !== null
  ) {

    const value =
      match[1].trim();

    console.log(
      "Inline serial candidate:",
      value
    );

    if (
      looksLikeSerial(value)
    ) {
      results.push(value);
    }
  }


  /*
    Third: sometimes OCR changes "Serial No"
    into things like "Serlal No" or "SeriaI No".
  */

  const fuzzyRegex =
    /(?:ser[i1l][a-z1l]{2,4}\s*(?:no|number|n[o0])?)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9._\/-]{3,})/gi;

  while (
    (match =
      fuzzyRegex.exec(text)) !== null
  ) {

    const value =
      match[1].trim();

    console.log(
      "Fuzzy serial candidate:",
      value
    );

    if (
      looksLikeSerial(value)
    ) {
      results.push(value);
    }
  }


  const finalResults =
    unique(
      results
    ).filter(
      looksLikeSerial
    );

  console.log(
    "FINAL OCR SERIAL CANDIDATES:",
    finalResults
  );

  return finalResults;
}


/* =========================================================
   MODEL EXTRACTION
========================================================= */

function extractModel(text) {

  const regex =
    /(?:model\s*(?:number|no\.?|#)?|part\s*(?:number|no\.?|#)?)\s*[:#\-]?\s*([A-Z0-9][A-Z0-9._\/-]{1,79})/i;

  const match =
    text.match(regex);

  const model =
    match?.[1]?.trim() || "";

  console.log(
    "Detected model:",
    model
  );

  return model;
}


/* =========================================================
   PRODUCT NAME
========================================================= */

function extractProduct(text) {

  const lines =
    text
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean);

  const labels =
    /^(?:product|product\s*name|description|device|type)\s*[:#\-]?\s*(.+)$/i;

  for (const line of lines) {

    const match =
      line.match(labels);

    if (match) {

      const value =
        match[1].trim();

      console.log(
        "Detected product:",
        value
      );

      return value;
    }
  }

  /*
    If no explicit product label exists,
    take a reasonable early line.
  */

  for (
    const line of lines.slice(0, 10)
  ) {

    if (
      line.length >= 4 &&
      line.length <= 80 &&
      /[A-Za-z]{3,}/.test(line) &&
      !/serial|model|ean|upc|gtin|mac|input|output/i.test(line)
    ) {

      console.log(
        "Possible product:",
        line
      );

      return line;
    }
  }

  return "";
}


/* =========================================================
   GROUPING
========================================================= */

function getGroup(
  productName,
  model
) {

  const normalizedModel =
    String(model || "")
      .trim()
      .toUpperCase();

  const normalizedProduct =
    String(productName || "")
      .trim()
      .toUpperCase();

  /*
    Prefer model because it is usually
    more reliable than product name.
  */

  if (normalizedModel) {

    const existing =
      state.results.find(
        (group) =>
          group.model &&
          group.model
            .trim()
            .toUpperCase() ===
            normalizedModel
      );

    if (existing) {
      return existing;
    }
  }

  const key =
    `${normalizedProduct}||${normalizedModel}`;

  let group =
    state.results.find(
      (item) =>
        item.key === key
    );

  if (!group) {

    group = {
      id: uid(),
      key,
      productName:
        productName ||
        "Unknown product",
      model:
        model || "",
      serials: [],
      confidence: "medium",
      sources: [],
      notes: []
    };

    state.results.push(group);
  }

  return group;
}


function mergeResult({
  productName,
  model,
  serials,
  imageId,
  confidence,
  notes
}) {

  const group =
    getGroup(
      productName,
      model
    );

  if (
    productName &&
    (
      !group.productName ||
      group.productName ===
        "Unknown product"
    )
  ) {
    group.productName =
      productName;
  }

  if (
    model &&
    !group.model
  ) {
    group.model =
      model;
  }

  for (
    const serial of serials
  ) {

    const clean =
      normalizeSerial(serial);

    if (!clean) continue;

    const alreadyExists =
      group.serials.some(
        (existing) =>
          serialKey(existing) ===
          serialKey(clean)
      );

    if (!alreadyExists) {
      group.serials.push(clean);
    }
  }

  if (
    imageId &&
    !group.sources.includes(imageId)
  ) {
    group.sources.push(imageId);
  }

  if (notes) {
    group.notes.push(notes);
  }

  group.confidence =
    confidence ||
    group.confidence;
}


/* =========================================================
   QWEN
========================================================= */

async function askQwen(
  imageDataUrl,
  ocrText,
  barcodeCandidates
) {

  console.log(
    "Sending image to Qwen..."
  );

  const response =
    await fetch(
      "/api/analyze",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          imageDataUrl,
          ocrText,
          barcodeCandidates
        })
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  console.log(
    "Qwen response:",
    data
  );

  if (
    !response.ok ||
    !data.ok
  ) {

    throw new Error(
      data.error ||
      `AI request failed: ${response.status}`
    );
  }

  return data.result;
}


/* =========================================================
   SHOULD WE USE AI?
========================================================= */

function shouldUseAI(local) {

  if (!state.aiEnabled) {
    return false;
  }

  /*
    Use Qwen when:

    1. No serial was found
    OR
    2. No model was found
    OR
    3. OCR confidence is low.
  */

  return (
    local.serials.length === 0 ||
    !local.model ||
    local.confidence === "low"
  );
}


/* =========================================================
   PROCESS ONE IMAGE
========================================================= */

async function processImage(
  item,
  index,
  total
) {

  console.group(
    `PROCESSING IMAGE ${index + 1}/${total}`
  );

  item.status =
    "Reading barcode...";

  item.statusClass =
    "busy";

  renderImages();

  let barcodeCandidates = [];

  let ocrText = "";

  let serials = [];

  let model = "";

  let productName = "";

  let confidence = "low";

  let notes = "";


  /* -----------------------------------------
     BARCODE
  ----------------------------------------- */

  try {

    barcodeCandidates =
      await detectBarcodes(
        item.file
      );

  } catch (error) {

    console.error(
      "Barcode error:",
      error
    );

    notes +=
      `Barcode error: ${error.message}\n`;
  }


  /* -----------------------------------------
     OCR
  ----------------------------------------- */

  try {

    item.status =
      "Reading text...";

    renderImages();

    ocrText =
      await runOCR(
        item.file
      );

    console.log(
      "OCR TEXT:",
      ocrText
    );

    serials =
      extractSerialsFromOCR(
        ocrText
      );

    model =
      extractModel(
        ocrText
      );

    productName =
      extractProduct(
        ocrText
      );

    /*
      Barcode values are only candidates.
      Don't automatically treat every barcode
      as a serial.
    */

    for (
      const barcode of
        barcodeCandidates
    ) {

      if (
        looksLikeSerial(
          barcode
        )
      ) {

        serials.push(
          barcode
        );
      }
    }

    serials =
      unique(serials)
        .filter(
          looksLikeSerial
        );

    confidence =
      serials.length &&
      model
        ? "high"
        : serials.length
          ? "medium"
          : "low";

  } catch (error) {

    console.error(
      "OCR error:",
      error
    );

    notes +=
      `OCR error: ${error.message}\n`;
  }


  const local = {
    serials,
    model,
    productName,
    confidence
  };


  /* -----------------------------------------
     LOG LOCAL RESULT
  ----------------------------------------- */

  console.log(
    "LOCAL RESULT:",
    local
  );


  /* -----------------------------------------
     QWEN FALLBACK
  ----------------------------------------- */

  if (
    shouldUseAI(local)
  ) {

    item.status =
      "Qwen checking...";

    item.statusClass =
      "busy";

    renderImages();

    try {

      const imageDataUrl =
        await preprocessImage(
          item.file
        );

      const ai =
        await askQwen(
          imageDataUrl,
          ocrText,
          barcodeCandidates
        );

      console.log(
        "QWEN RESULT:",
        ai
      );

      productName =
        ai.productName ||
        productName;

      model =
        ai.model ||
        model;

      serials =
        unique([
          ...serials,
          ...(ai.serialNumbers || [])
        ])
        .filter(
          looksLikeSerial
        );

      confidence =
        ai.confidence ||
        confidence;

      if (ai.notes) {
        notes +=
          `Qwen: ${ai.notes}\n`;
      }

    } catch (error) {

      console.error(
        "Qwen error:",
        error
      );

      notes +=
        `Qwen error: ${error.message}\n`;
    }
  }


  /* -----------------------------------------
     SAVE RESULT
  ----------------------------------------- */

  mergeResult({
    productName,
    model,
    serials,
    imageId: item.id,
    confidence,
    notes
  });


  item.status =
    serials.length
      ? `${serials.length} serial${
          serials.length === 1
            ? ""
            : "s"
        } found`
      : "No serial found";

  item.statusClass =
    serials.length
      ? "ok"
      : "error";


  /*
    Store everything so we can inspect
    it under Advanced Details.
  */

  item.details = {
    barcodeCandidates,
    ocrText,
    localSerials: serials,
    productName,
    model,
    confidence,
    notes
  };


  renderImages();
  renderResults();
  renderAdvanced();

  console.groupEnd();
}


/* =========================================================
   SCAN ALL
========================================================= */

async function scanAll() {

  if (state.scanning) {
    return;
  }

  if (!state.images.length) {

    alert(
      "Please add at least one image."
    );

    return;
  }

  state.scanning = true;

  state.results = [];

  progressBar.style.width =
    "0%";

  progressText.textContent =
    "Starting...";

  scanSummary.textContent =
    "Processing images...";

  renderResults();


  try {

    const total =
      state.images.length;

    for (
      let i = 0;
      i < total;
      i++
    ) {

      await processImage(
        state.images[i],
        i,
        total
      );

      const percentage =
        Math.round(
          ((i + 1) / total) * 100
        );

      progressBar.style.width =
        `${percentage}%`;

      progressText.textContent =
        `${i + 1}/${total} images processed`;
    }


    const totalSerials =
      state.results.reduce(
        (sum, group) =>
          sum + group.serials.length,
        0
      );


    scanSummary.textContent =
      `Finished: ${totalSerials} unique serial${
        totalSerials === 1
          ? ""
          : "s"
      } found across ${
        total
      } image${
        total === 1
          ? ""
          : "s"
      }.`;

    progressText.textContent =
      "Done";

    saveState();

  } catch (error) {

    console.error(
      "SCAN ALL ERROR:",
      error
    );

    scanSummary.textContent =
      `Scan error: ${error.message}`;

  } finally {

    state.scanning = false;
  }
}


$("scanAllBtn")
  .addEventListener(
    "click",
    scanAll
  );


/* =========================================================
   RESULTS UI
========================================================= */

function renderResults() {

  groupList.innerHTML =
    "";

  let total =
    0;

  for (
    const group of
      state.results
  ) {

    total +=
      group.serials.length;


    const box =
      document.createElement(
        "article"
      );

    box.className =
      "group";


    const head =
      document.createElement(
        "div"
      );

    head.className =
      "group-head";


    const titleWrap =
      document.createElement(
        "div"
      );


    const title =
      document.createElement(
        "div"
      );

    title.className =
      "group-title";

    title.textContent =
      group.productName ||
      "Unknown product";


    const model =
      document.createElement(
        "div"
      );

    model.className =
      "group-model";

    model.textContent =
      group.model
        ? `Model: ${group.model}`
        : "Model: not detected";


    titleWrap.append(
      title,
      model
    );


    const badge =
      document.createElement(
        "span"
      );

    badge.className =
      "count";

    badge.textContent =
      `${group.serials.length} serial${
        group.serials.length === 1
          ? ""
          : "s"
      }`;


    head.append(
      titleWrap,
      badge
    );

    box.appendChild(head);


    const list =
      document.createElement(
        "div"
      );

    list.className =
      "serial-list";


    group.serials.forEach(
      (serial, index) => {

        const row =
          document.createElement(
            "div"
          );

        row.className =
          "serial-row";


        const number =
          document.createElement(
            "span"
          );

        number.textContent =
          String(index + 1);


        const input =
          document.createElement(
            "input"
          );

        input.value =
          serial;


        input.addEventListener(
          "input",
          () => {

            group.serials[index] =
              input.value;

            updateTallyOutput();

            saveState();
          }
        );


        const remove =
          document.createElement(
            "button"
          );

        remove.className =
          "remove-serial";

        remove.type =
          "button";

        remove.textContent =
          "×";

        remove.addEventListener(
          "click",
          () => {

            group.serials.splice(
              index,
              1
            );

            renderResults();

            saveState();
          }
        );


        row.append(
          number,
          input,
          remove
        );

        list.appendChild(row);
      }
    );


    const add =
      document.createElement(
        "button"
      );

    add.className =
      "add-serial";

    add.type =
      "button";

    add.textContent =
      "+ Add serial";


    add.addEventListener(
      "click",
      () => {

        group.serials.push("");

        renderResults();

        saveState();
      }
    );


    box.append(
      list,
      add
    );

    groupList.appendChild(box);
  }


  serialCount.textContent =
    `${total} serial${
      total === 1
        ? ""
        : "s"
    }`;


  noResults.classList.toggle(
    "hidden",
    state.results.length > 0
  );


  updateTallyOutput();
}


/* =========================================================
   TALLY OUTPUT
========================================================= */

function allSerials() {

  const output = [];

  for (
    const group of
      state.results
  ) {

    for (
      const serial of
        group.serials
    ) {

      const value =
        normalizeSerial(
          serial
        );

      if (value) {
        output.push(value);
      }
    }
  }


  /*
    Remove duplicates one final time
    before sending to Tally.
  */

  const seen =
    new Set();

  return output.filter(
    (serial) => {

      const key =
        serialKey(serial);

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}


function updateTallyOutput() {

  const serials =
    allSerials();

  const lines = [];


  for (
    let i = 0;
    i < serials.length;
    i += state.perLine
  ) {

    lines.push(
      serials
        .slice(
          i,
          i + state.perLine
        )
        .join("\t")
    );
  }


  tallyOutput.value =
    lines.join("\n");
}


/* =========================================================
   SERIALS PER LINE
========================================================= */

document
  .querySelectorAll(
    'input[name="perLine"]'
  )
  .forEach(
    (radio) => {

      radio.checked =
        Number(radio.value) ===
        state.perLine;


      radio.addEventListener(
        "change",
        () => {

          state.perLine =
            Number(
              radio.value
            );

          localStorage.setItem(
            "pss_perLine",
            String(
              state.perLine
            )
          );

          updateTallyOutput();
        }
      );
    }
  );


/* =========================================================
   COPY
========================================================= */

$("copyBtn")
  .addEventListener(
    "click",
    async () => {

      if (!tallyOutput.value) {

        $("copyStatus")
          .textContent =
          "Nothing to copy.";

        return;
      }


      try {

        await navigator
          .clipboard
          .writeText(
            tallyOutput.value
          );

        $("copyStatus")
          .textContent =
          "Copied ✓";

      } catch {

        tallyOutput.select();

        document.execCommand(
          "copy"
        );

        $("copyStatus")
          .textContent =
          "Copied ✓";
      }
    }
  );


/* =========================================================
   CLEAR
========================================================= */

$("clearBtn")
  .addEventListener(
    "click",
    () => {

      if (
        !confirm(
          "Clear all photos and results?"
        )
      ) {
        return;
      }


      state.images.forEach(
        (item) => {

          URL.revokeObjectURL(
            item.previewUrl
          );
        }
      );


      state.images = [];

      state.results = [];


      localStorage.removeItem(
        STORAGE_KEY
      );


      renderImages();

      renderResults();

      renderAdvanced();


      progressBar.style.width =
        "0%";

      progressText.textContent =
        "";

      scanSummary.textContent =
        "Ready.";

      tallyOutput.value =
        "";
    }
  );


/* =========================================================
   ADVANCED DEBUG DETAILS
========================================================= */

function renderAdvanced() {

  advancedDetails.innerHTML =
    "";


  if (!state.images.length) {

    advancedDetails.innerHTML =
      "<p>No image details yet.</p>";

    return;
  }


  for (
    const item of
      state.images
  ) {

    const block =
      document.createElement(
        "div"
      );

    block.className =
      "detail-block";


    const title =
      document.createElement(
        "strong"
      );

    title.textContent =
      item.name;


    const pre =
      document.createElement(
        "pre"
      );


    if (!item.details) {

      pre.textContent =
        "Not scanned yet.";

    } else {

      pre.textContent =
`STATUS:
${item.status}

PRODUCT:
${item.details.productName || "(not detected)"}

MODEL:
${item.details.model || "(not detected)"}

SERIAL CANDIDATES:
${JSON.stringify(
  item.details.localSerials || [],
  null,
  2
)}

BARCODES:
${JSON.stringify(
  item.details.barcodeCandidates || [],
  null,
  2
)}

CONFIDENCE:
${item.details.confidence || "-"}

NOTES:
${item.details.notes || "(none)"}

==============================
RAW OCR TEXT
==============================

${item.details.ocrText || "(OCR returned nothing)"}`;
    }


    block.append(
      title,
      pre
    );

    advancedDetails.appendChild(
      block
    );
  }
}


/* =========================================================
   LOAD SAVED RESULTS
========================================================= */

function saveState() {

  const data = {

    results:
      state.results,

    perLine:
      state.perLine,

    savedAt:
      Date.now()
  };


  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(data)
  );
}


function loadState() {

  try {

    const data =
      JSON.parse(
        localStorage.getItem(
          STORAGE_KEY
        ) || "null"
      );


    if (
      data?.results
    ) {

      state.results =
        data.results;
    }


    if (
      data?.perLine
    ) {

      state.perLine =
        Number(
          data.perLine
        );
    }

  } catch (error) {

    console.warn(
      "Could not restore saved state:",
      error
    );
  }
}


/* =========================================================
   SERVER / AI STATUS
========================================================= */

async function checkServer() {

  try {

    const response =
      await fetch(
        "/api/health"
      );

    const health =
      await response.json();


    state.aiEnabled =
      Boolean(
        health.aiEnabled
      );


    if (
      health.aiEnabled
    ) {

      aiBadge.textContent =
        `Qwen AI: ${
          health.model
        }`;

      aiBadge.classList.add(
        "on"
      );

    } else {

      aiBadge.textContent =
        "Qwen AI: not configured";

      aiBadge.classList.add(
        "off"
      );
    }


    console.log(
      "SERVER HEALTH:",
      health
    );

  } catch (error) {

    console.error(
      "Server health error:",
      error
    );

    aiBadge.textContent =
      "Server unavailable";

    aiBadge.classList.add(
      "off"
    );
  }
}


/* =========================================================
   INITIALIZE
========================================================= */

async function init() {

  console.log(
    "================================="
  );

  console.log(
    "PRODUCT SERIAL SCANNER STARTED"
  );

  console.log(
    "================================="
  );


  loadState();

  await checkServer();

  renderImages();

  renderResults();

  renderAdvanced();
}


window.addEventListener(
  "beforeunload",
  stopCamera
);


init();