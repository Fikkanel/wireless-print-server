// LocalPrint Client Application Logic

// Application State
let selectedFile = null;
let currentCopies = 1;
let currentOrientation = 'portrait';
let currentColorMode = 'color';
let activeJobId = null;
let currentPrintMode = 'standard'; // 'standard' | 'photo'

let serverSettings = {
  activePrinter: '',
  pinProtection: false
};

// Photo Studio Crop & Layout State
let loadedImageObj = null;
let cropState = {
  zoom: 1.0,
  panX: 0,
  panY: 0,
  isDragging: false,
  startX: 0,
  startY: 0,
  aspectRatio: '3x4',
  gridCount: 'auto'
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  detectView();
  fetchInitialStatus();
  setupRealtimeConnection();
  setupDragAndDrop();
  setupCropDragListeners();
});

// Detect view automatically (Laptop/Desktop vs HP/Mobile)
function detectView() {
  const urlParams = new URLSearchParams(window.location.search);
  const forcedView = urlParams.get('view');
  if (forcedView === 'host') {
    switchView('host');
    return;
  } else if (forcedView === 'mobile') {
    switchView('mobile');
    return;
  }

  const ua = (navigator.userAgent || navigator.vendor || window.opera || '').toLowerCase();
  const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
  const isSmallScreen = window.innerWidth <= 768;

  if (isMobileUA || isSmallScreen) {
    switchView('mobile');
  } else {
    switchView('host');
  }
}

function switchView(viewName) {
  const hostView = document.getElementById('hostView');
  const mobileView = document.getElementById('mobileView');
  const tabMobileBtn = document.getElementById('tabMobileBtn');
  const tabHostBtn = document.getElementById('tabHostBtn');

  if (viewName === 'host') {
    hostView.style.display = 'grid';
    mobileView.style.display = 'none';
    tabHostBtn.classList.add('active');
    tabMobileBtn.classList.remove('active');
  } else {
    hostView.style.display = 'none';
    mobileView.style.display = 'block';
    tabMobileBtn.classList.add('active');
    tabHostBtn.classList.remove('active');
  }
}

// Fetch Initial Status from Express API
async function fetchInitialStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    updateUIWithStatus(data);

    // If QR code missing, fetch explicitly from /api/qrcode
    const qrImg = document.getElementById('qrImage');
    if (!qrImg || !qrImg.src || qrImg.src.endsWith('.html') || !qrImg.src.startsWith('data:')) {
      const qrRes = await fetch('/api/qrcode');
      const qrData = await qrRes.json();
      if (qrData && qrData.dataUrl) {
        if (qrImg) qrImg.src = qrData.dataUrl;
        const hostUrl = document.getElementById('hostServerUrl');
        if (hostUrl) hostUrl.textContent = qrData.url;
      }
    }
  } catch (err) {
    console.error('Error fetching server status:', err);
    document.getElementById('navStatusText').textContent = 'Koneksi Terputus';
  }
}

// Setup Real-time Connection (WebSocket with SSE fallback)
function setupRealtimeConnection() {
  try {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'job-update' && data.job) {
          if (data.job.id === activeJobId) {
            updateProgressModal(data.job.status, data.job.message);
          } else if (!knownJobIds.has(data.job.id)) {
            knownJobIds.add(data.job.id);
            showHostToastNotification(data.job);
          }
          fetchJobsHistory();
        }
      } catch (e) {}
    };

    ws.onerror = () => setupSSEFallback();
  } catch (e) {
    setupSSEFallback();
  }
}

function setupSSEFallback() {
  try {
    const evtSource = new EventSource('/api/events');
    evtSource.addEventListener('status_update', (e) => {
      try { updateUIWithStatus(JSON.parse(e.data)); } catch (err) {}
    });
    evtSource.addEventListener('jobs_update', (e) => {
      try { renderJobTable(JSON.parse(e.data)); } catch (err) {}
    });
    evtSource.addEventListener('job_added', (e) => {
      try {
        const job = JSON.parse(e.data);
        if (job && job.id && !knownJobIds.has(job.id)) {
          knownJobIds.add(job.id);
          showHostToastNotification(job);
        }
        fetchJobsHistory();
      } catch (err) { fetchJobsHistory(); }
    });
    evtSource.addEventListener('job_updated', (e) => {
      try { fetchJobsHistory(); } catch (err) {}
    });
  } catch (e) {}
}

// Update UI with Server Status
function updateUIWithStatus(data) {
  if (!data) return;

  const ip = data.ip || (data.network ? data.network.ip : '');
  const port = data.port || (data.network ? data.network.port : '');
  const serverUrl = data.serverUrl || (data.network ? data.network.url : `http://${ip}:${port}/`);

  if (ip && port) {
    document.getElementById('navIpAddress').textContent = `${ip}:${port}`;
  }
  document.getElementById('navStatusText').textContent = 'Server Aktif';

  // Host QR Hero
  const qrImg = document.getElementById('qrImage');
  if (data.qrDataUrl && qrImg) {
    qrImg.src = data.qrDataUrl;
  }
  if (serverUrl) {
    document.getElementById('hostServerUrl').textContent = serverUrl;
  }

  // Printer information
  if (data.printer && data.printer.printerName) {
    const activePName = data.printer.printerName;
    document.getElementById('mobileConnectedPrinter').textContent = activePName;

    const printerSelect = document.getElementById('printerSelect');
    if (printerSelect && printerSelect.options.length <= 1) {
      printerSelect.replaceChildren();
      const opt = document.createElement('option');
      opt.value = activePName;
      opt.textContent = `${activePName} (Default OS)`;
      opt.selected = true;
      printerSelect.appendChild(opt);

      const mockOpt = document.createElement('option');
      mockOpt.value = 'Virtual Mock Printer (LocalPrint Test)';
      mockOpt.textContent = 'Virtual Mock Printer (LocalPrint Test)';
      printerSelect.appendChild(mockOpt);
    }
  } else if (data.printers) {
    populatePrintersSelect(data.printers, data.settings ? data.settings.activePrinter : '');
  }

  // Mobile Connected Printer
  if (data.settings && data.settings.activePrinter) {
    serverSettings = data.settings;
    document.getElementById('mobileConnectedPrinter').textContent = data.settings.activePrinter;
    
    const pinWrap = document.getElementById('mobilePinWrapper');
    if (pinWrap) {
      pinWrap.style.display = data.settings.pinProtection ? 'block' : 'none';
    }
  }
}

// Safely Populate Printers Select
function populatePrintersSelect(printers, selectedPrinterName) {
  const select = document.getElementById('printerSelect');
  select.replaceChildren();

  printers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = `${p.name} ${p.isDefault ? '(Default OS)' : ''}`;
    if (p.name === selectedPrinterName) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

// Toggle Host PIN Protection
function togglePinProtection() {
  const checkbox = document.getElementById('pinProtectionToggle');
  const pinInputWrapper = document.getElementById('pinInputWrapper');
  pinInputWrapper.style.display = checkbox.checked ? 'block' : 'none';
  updateHostSettings();
}

// Update Host Settings via API
async function updateHostSettings() {
  const activePrinter = document.getElementById('printerSelect').value;
  const pinProtection = document.getElementById('pinProtectionToggle').checked;
  const pinCode = document.getElementById('hostPinCode').value;

  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activePrinter, pinProtection, pinCode })
    });
  } catch (err) {
    console.error('Failed to update host settings:', err);
  }
}

// Fetch Job History
async function fetchJobsHistory() {
  try {
    const res = await fetch('/api/jobs');
    const data = await res.json();
    if (data.success && data.jobs) {
      renderJobTable(data.jobs);
    } else if (Array.isArray(data)) {
      renderJobTable(data);
    }
  } catch (err) {}
}

let knownJobIds = new Set();
let isJobsInitialized = false;

// Render Job Table
function renderJobTable(jobs) {
  const tbody = document.getElementById('jobTableBody');
  tbody.replaceChildren();

  document.getElementById('jobCountText').textContent = `${jobs.length} Job`;

  if (jobs.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.style.textAlign = 'center';
    td.style.color = 'var(--text-dim)';
    td.style.padding = '2rem';
    td.textContent = 'Belum ada job masuk. Scan QR di samping dari HP untuk mencoba.';
    tr.appendChild(td);
    tbody.appendChild(tr);
    isJobsInitialized = true;
    return;
  }

  jobs.forEach(job => {
    // Detect new incoming print job for real-time notification toast
    if (job.id && !knownJobIds.has(job.id)) {
      if (isJobsInitialized) {
        showHostToastNotification(job);
      }
      knownJobIds.add(job.id);
    }

    const tr = document.createElement('tr');

    const tdTime = document.createElement('td');
    const dateObj = new Date(job.createdAt || job.timestamp || Date.now());
    tdTime.textContent = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    tdTime.style.color = 'var(--text-muted)';
    tr.appendChild(tdTime);

    const tdSender = document.createElement('td');
    tdSender.textContent = job.sender || job.deviceName || 'HP Guest';
    tdSender.style.fontWeight = '600';
    tr.appendChild(tdSender);

    const tdDoc = document.createElement('td');
    tdDoc.textContent = job.filename || job.fileName || 'document.pdf';
    tr.appendChild(tdDoc);

    const tdOpt = document.createElement('td');
    const opts = job.options || {};
    tdOpt.textContent = `${opts.copies || 1}x | ${opts.paperSize || 'A4'} | ${opts.color === false ? 'B&W' : 'Warna'}`;
    tdOpt.style.color = 'var(--text-muted)';
    tdOpt.style.fontSize = '0.8rem';
    tr.appendChild(tdOpt);

    const tdStatus = document.createElement('td');
    const spanPill = document.createElement('span');
    spanPill.className = `status-pill ${job.status}`;
    spanPill.textContent = getStatusLabel(job.status);
    tdStatus.appendChild(spanPill);
    tr.appendChild(tdStatus);

    tbody.appendChild(tr);
  });
}

function getStatusLabel(status) {
  switch (status) {
    case 'uploading': return 'Uploading';
    case 'processing': return 'Memproses';
    case 'printing': return 'Mencetak';
    case 'completed':
    case 'done': return 'Selesai ✅';
    case 'failed':
    case 'error': return 'Gagal ❌';
    default: return status;
  }
}

// Drag & Drop Setup
function setupDragAndDrop() {
  const dropzone = document.getElementById('dropzone');

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => dropzone.classList.add('dragover'), false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, () => dropzone.classList.remove('dragover'), false);
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      processSelectedFile(files[0]);
    }
  });
}

// Handle File Selection
function handleFileSelect(event) {
  const files = event.target.files;
  if (files && files.length > 0) {
    processSelectedFile(files[0]);
  }
}

// PDF.js worker setup
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

function processSelectedFile(file) {
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.docx'];

  if (!allowed.includes(ext)) {
    alert(`Tipe file "${ext}" tidak didukung. Harap pilih PDF, Gambar (JPG/PNG), atau DOCX.`);
    return;
  }

  if (file.size > 20 * 1024 * 1024) {
    alert('Ukuran file terlalu besar! Batas maksimal adalah 20MB.');
    return;
  }

  selectedFile = file;

  // Show Step 2 / Print Form
  document.getElementById('uploadStep').style.display = 'none';
  document.getElementById('printForm').style.display = 'block';

  // Render Visual Document Preview (PDF canvas, Image thumbnail, or DOCX badge)
  renderVisualFilePreview(file);

  const isImage = ['.png', '.jpg', '.jpeg'].includes(ext);

  // Show or hide Image Mode selector
  const modeSelector = document.getElementById('imageModeSelector');
  if (isImage) {
    modeSelector.style.display = 'block';
    // Load image object for crop canvas
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        loadedImageObj = img;
        resetCropPosition();
        if (currentPrintMode === 'photo') {
          renderCropCanvas();
          renderSheetPreview();
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  } else {
    modeSelector.style.display = 'none';
    setPrintMode('standard');
    loadedImageObj = null;
  }
}

async function renderVisualFilePreview(file) {
  const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
  const pdfCanvas = document.getElementById('pdfCanvasPreview');
  const imgPreview = document.getElementById('imgThumbnailPreview');
  const docxPlaceholder = document.getElementById('docxPreviewPlaceholder');
  const fileMeta = document.getElementById('previewFileMeta');

  document.getElementById('previewFilename').textContent = file.name;

  if (['.png', '.jpg', '.jpeg'].includes(ext)) {
    pdfCanvas.style.display = 'none';
    docxPlaceholder.style.display = 'none';
    imgPreview.style.display = 'block';
    imgPreview.src = URL.createObjectURL(file);
    fileMeta.textContent = `${formatBytes(file.size)} • Gambar (${ext.toUpperCase().replace('.', '')})`;
  } else if (ext === '.pdf') {
    imgPreview.style.display = 'none';
    docxPlaceholder.style.display = 'none';
    pdfCanvas.style.display = 'block';
    fileMeta.textContent = `${formatBytes(file.size)} • Memuat preview PDF...`;

    try {
      const arrayBuffer = await file.arrayBuffer();
      if (!window.pdfjsLib) throw new Error('PDF.js not loaded');
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;

      fileMeta.textContent = `${formatBytes(file.size)} • ${pdf.numPages} Halaman (PDF)`;

      const page = await pdf.getPage(1);
      const unscaledViewport = page.getViewport({ scale: 1.0 });

      const frame = document.getElementById('previewFrame');
      const displayW = Math.min(320, (frame ? frame.clientWidth : 280) - 24);
      const displayH = (displayW / unscaledViewport.width) * unscaledViewport.height;

      // Use High-DPI Scaling for Razor-Sharp Vector Text on Mobile screens
      const dpr = Math.max(2.5, window.devicePixelRatio || 1);
      const scale = (displayW / unscaledViewport.width) * dpr;
      const renderViewport = page.getViewport({ scale });

      pdfCanvas.width = renderViewport.width;
      pdfCanvas.height = renderViewport.height;

      pdfCanvas.style.width = `${displayW}px`;
      pdfCanvas.style.height = `${displayH}px`;

      const ctx = pdfCanvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
    } catch (err) {
      console.warn('PDF Preview render fallback:', err);
      pdfCanvas.style.display = 'none';
      docxPlaceholder.style.display = 'block';
      const divs = docxPlaceholder.querySelectorAll('div');
      if (divs.length >= 3) {
        divs[0].textContent = '📄';
        divs[1].textContent = 'Dokumen PDF';
        divs[2].textContent = 'Siap dicetak';
      }
      fileMeta.textContent = `${formatBytes(file.size)} • PDF Document`;
    }
  } else if (ext === '.docx') {
    pdfCanvas.style.display = 'none';
    imgPreview.style.display = 'none';
    docxPlaceholder.style.display = 'block';
    const divs = docxPlaceholder.querySelectorAll('div');
    if (divs.length >= 3) {
      divs[0].textContent = '📝';
      divs[1].textContent = 'Dokumen Word (.docx)';
      divs[2].textContent = 'Siap dikonversi & dicetak';
    }
    fileMeta.textContent = `${formatBytes(file.size)} • Dokumen Word (.docx)`;
  }

  applyPreviewFiltersAndOrientation();
}

function resetFileSelection() {
  selectedFile = null;
  loadedImageObj = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('uploadStep').style.display = 'block';
  document.getElementById('printForm').style.display = 'none';
  document.getElementById('photoStudioSection').style.display = 'none';
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Print Mode Switching (Standard vs Photo Studio)
function setPrintMode(mode) {
  currentPrintMode = mode;
  document.getElementById('modeStandardBtn').classList.toggle('active', mode === 'standard');
  document.getElementById('modePhotoBtn').classList.toggle('active', mode === 'photo');

  const photoStudioSection = document.getElementById('photoStudioSection');
  const pageRangeWrapper = document.getElementById('pageRangeWrapper');

  if (mode === 'photo') {
    photoStudioSection.style.display = 'block';
    if (pageRangeWrapper) pageRangeWrapper.style.display = 'none';
    if (loadedImageObj) {
      renderCropCanvas();
      renderSheetPreview();
    }
  } else {
    photoStudioSection.style.display = 'none';
    if (pageRangeWrapper) pageRangeWrapper.style.display = 'block';
  }
}

// Setup Drag & Pan Listeners for Photo Crop Box
function setupCropDragListeners() {
  const container = document.getElementById('cropContainer');
  if (!container) return;

  const getPointerPos = (e) => {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  };

  const startDrag = (e) => {
    cropState.isDragging = true;
    const pos = getPointerPos(e);
    cropState.startX = pos.x - cropState.panX;
    cropState.startY = pos.y - cropState.panY;
  };

  const moveDrag = (e) => {
    if (!cropState.isDragging) return;
    const pos = getPointerPos(e);
    cropState.panX = pos.x - cropState.startX;
    cropState.panY = pos.y - cropState.startY;
    renderCropCanvas();
    renderSheetPreview();
  };

  const endDrag = () => {
    cropState.isDragging = false;
  };

  container.addEventListener('mousedown', startDrag);
  window.addEventListener('mousemove', moveDrag);
  window.addEventListener('mouseup', endDrag);

  container.addEventListener('touchstart', startDrag, { passive: true });
  window.addEventListener('touchmove', moveDrag, { passive: true });
  window.addEventListener('touchend', endDrag);
}

function resetCropPosition() {
  cropState.zoom = 1.0;
  cropState.panX = 0;
  cropState.panY = 0;
  document.getElementById('zoomRange').value = '1.0';
  if (loadedImageObj) {
    renderCropCanvas();
    renderSheetPreview();
  }
}

function onZoomChange(event) {
  cropState.zoom = parseFloat(event.target.value) || 1.0;
  renderCropCanvas();
  renderSheetPreview();
}

function onPhotoOptionChange() {
  cropState.aspectRatio = document.getElementById('photoSizeSelect').value;
  cropState.gridCount = document.getElementById('photoCountSelect').value;
  renderCropCanvas();
  renderSheetPreview();
}

// Get Aspect Ratio Float
function getTargetRatio(ratioKey) {
  switch (ratioKey) {
    case '3x4': return 3 / 4;
    case '2x3': return 2 / 3;
    case '4x6': return 4 / 6;
    case '1:1': return 1 / 1;
    case '4:3': return 4 / 3;
    case 'full': return 0;
    default: return 3 / 4;
  }
}

// Render Interactive Crop Box Canvas
function renderCropCanvas() {
  const canvas = document.getElementById('cropCanvas');
  if (!canvas || !loadedImageObj) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, width, height);

  // Background
  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, width, height);

  // Compute Crop Frame Box
  const ratio = getTargetRatio(cropState.aspectRatio);
  let frameWidth = width * 0.75;
  let frameHeight = height * 0.75;

  if (ratio > 0) {
    if (frameWidth / frameHeight > ratio) {
      frameWidth = frameHeight * ratio;
    } else {
      frameHeight = frameWidth / ratio;
    }
  }

  const frameX = (width - frameWidth) / 2;
  const frameY = (height - frameHeight) / 2;

  // Draw Image centered with pan & zoom
  ctx.save();
  // Clip image inside crop frame for crisp visual
  ctx.beginPath();
  ctx.rect(frameX, frameY, frameWidth, frameHeight);
  ctx.clip();

  const imgRatio = loadedImageObj.width / loadedImageObj.height;
  let drawW = frameWidth;
  let drawH = frameHeight;

  if (imgRatio > (frameWidth / frameHeight)) {
    drawW = frameHeight * imgRatio;
  } else {
    drawH = frameWidth / imgRatio;
  }

  drawW *= cropState.zoom;
  drawH *= cropState.zoom;

  const drawX = frameX + (frameWidth - drawW) / 2 + cropState.panX;
  const drawY = frameY + (frameHeight - drawH) / 2 + cropState.panY;

  ctx.drawImage(loadedImageObj, drawX, drawY, drawW, drawH);
  ctx.restore();

  // Dark overlay outside crop box
  ctx.fillStyle = 'rgba(9, 13, 22, 0.65)';
  ctx.fillRect(0, 0, width, frameY);
  ctx.fillRect(0, frameY + frameHeight, width, height - (frameY + frameHeight));
  ctx.fillRect(0, frameY, frameX, frameHeight);
  ctx.fillRect(frameX + frameWidth, frameY, width - (frameX + frameWidth), frameHeight);

  // Border & Grid overlay on crop frame
  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 2;
  ctx.strokeRect(frameX, frameY, frameWidth, frameHeight);

  // Rule of thirds grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(frameX + frameWidth / 3, frameY);
  ctx.lineTo(frameX + frameWidth / 3, frameY + frameHeight);
  ctx.moveTo(frameX + (frameWidth * 2) / 3, frameY);
  ctx.lineTo(frameX + (frameWidth * 2) / 3, frameY + frameHeight);
  ctx.moveTo(frameX, frameY + frameHeight / 3);
  ctx.lineTo(frameX + frameWidth, frameY + frameHeight / 3);
  ctx.moveTo(frameX, frameY + (frameHeight * 2) / 3);
  ctx.lineTo(frameX + frameWidth, frameY + (frameHeight * 2) / 3);
  ctx.stroke();
}

// Render Sheet Preview (A4 Paper Layout Grid)
function renderSheetPreview() {
  const canvas = document.getElementById('sheetCanvas');
  if (!canvas || !loadedImageObj) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width; // 300
  const h = canvas.height; // 424 (A4 aspect ratio)

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Border & watermark
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, w, h);

  // Determine grid count & photo dimensions
  const ratio = getTargetRatio(cropState.aspectRatio) || (3 / 4);
  let count = cropState.gridCount === 'auto' ? 9 : parseInt(cropState.gridCount, 10);

  let cols = 3;
  let rows = Math.ceil(count / 3);
  if (count <= 1) { cols = 1; rows = 1; }
  else if (count === 2) { cols = 2; rows = 1; }
  else if (count === 4) { cols = 2; rows = 2; }
  else if (count === 6) { cols = 2; rows = 3; }
  else if (count === 8) { cols = 2; rows = 4; }

  const margin = 12;
  const availW = w - margin * 2;
  const availH = h - margin * 2;

  let photoW = (availW - (cols - 1) * 8) / cols;
  let photoH = photoW / ratio;

  if (photoH * rows > availH) {
    photoH = (availH - (rows - 1) * 8) / rows;
    photoW = photoH * ratio;
  }

  const startX = margin + (availW - (cols * photoW + (cols - 1) * 8)) / 2;
  const startY = margin + (availH - (rows * photoH + (rows - 1) * 8)) / 2;

  let rendered = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rendered >= count) break;
      const px = startX + c * (photoW + 8);
      const py = startY + r * (photoH + 8);

      // Render photo instance
      ctx.save();
      ctx.beginPath();
      ctx.rect(px, py, photoW, photoH);
      ctx.clip();

      const imgRatio = loadedImageObj.width / loadedImageObj.height;
      let drawW = photoW;
      let drawH = photoH;

      if (imgRatio > (photoW / photoH)) {
        drawW = photoH * imgRatio;
      } else {
        drawH = photoW / imgRatio;
      }

      drawW *= cropState.zoom;
      drawH *= cropState.zoom;

      const drawX = px + (photoW - drawW) / 2 + (cropState.panX * photoW) / 200;
      const drawY = py + (photoH - drawH) / 2 + (cropState.panY * photoH) / 200;

      ctx.drawImage(loadedImageObj, drawX, drawY, drawW, drawH);
      ctx.restore();

      // Thin cut border
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.strokeRect(px, py, photoW, photoH);

      rendered++;
    }
  }
}

// Generate High-Res Composite A4 Photo Sheet Canvas Blob
function generateCompositePhotoBlob() {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1240;  // A4 at ~150 DPI
    canvas.height = 1754;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const ratio = getTargetRatio(cropState.aspectRatio) || (3 / 4);
    let count = cropState.gridCount === 'auto' ? 9 : parseInt(cropState.gridCount, 10);

    let cols = 3;
    let rows = Math.ceil(count / 3);
    if (count <= 1) { cols = 1; rows = 1; }
    else if (count === 2) { cols = 2; rows = 1; }
    else if (count === 4) { cols = 2; rows = 2; }
    else if (count === 6) { cols = 2; rows = 3; }
    else if (count === 8) { cols = 2; rows = 4; }

    const margin = 50;
    const availW = canvas.width - margin * 2;
    const availH = canvas.height - margin * 2;

    let photoW = (availW - (cols - 1) * 20) / cols;
    let photoH = photoW / ratio;

    if (photoH * rows > availH) {
      photoH = (availH - (rows - 1) * 20) / rows;
      photoW = photoH * ratio;
    }

    const startX = margin + (availW - (cols * photoW + (cols - 1) * 20)) / 2;
    const startY = margin + (availH - (rows * photoH + (rows - 1) * 20)) / 2;

    let rendered = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rendered >= count) break;
        const px = startX + c * (photoW + 20);
        const py = startY + r * (photoH + 20);

        ctx.save();
        ctx.beginPath();
        ctx.rect(px, py, photoW, photoH);
        ctx.clip();

        const imgRatio = loadedImageObj.width / loadedImageObj.height;
        let drawW = photoW;
        let drawH = photoH;

        if (imgRatio > (photoW / photoH)) {
          drawW = photoH * imgRatio;
        } else {
          drawH = photoW / imgRatio;
        }

        drawW *= cropState.zoom;
        drawH *= cropState.zoom;

        const drawX = px + (photoW - drawW) / 2 + (cropState.panX * photoW) / 200;
        const drawY = py + (photoH - drawH) / 2 + (cropState.panY * photoH) / 200;

        ctx.drawImage(loadedImageObj, drawX, drawY, drawW, drawH);
        ctx.restore();

        // Cut line border
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 2;
        ctx.strokeRect(px, py, photoW, photoH);

        rendered++;
      }
    }

    canvas.toBlob((blob) => {
      resolve(blob);
    }, 'image/png');
  });
}

// Form Option Controls
function adjustCopies(delta) {
  currentCopies = Math.max(1, Math.min(99, currentCopies + delta));
  document.getElementById('copiesVal').textContent = currentCopies;
}

function applyPreviewFiltersAndOrientation() {
  const frame = document.getElementById('previewFrame');
  if (!frame) return;

  // 1. Apply Grayscale vs Color Filter Live Preview
  if (currentColorMode === 'grayscale') {
    frame.style.filter = 'grayscale(100%)';
  } else {
    frame.style.filter = 'none';
  }

  // 2. Apply Portrait vs Landscape Rotation Live Preview
  if (currentOrientation === 'landscape') {
    frame.classList.add('landscape-preview');
  } else {
    frame.classList.remove('landscape-preview');
  }
}

function setColorMode(mode) {
  currentColorMode = mode;
  document.getElementById('colorModeColor').classList.toggle('active', mode === 'color');
  document.getElementById('colorModeGray').classList.toggle('active', mode === 'grayscale');
  applyPreviewFiltersAndOrientation();
}

function setOrientation(orient) {
  currentOrientation = orient;
  document.getElementById('orientPortrait').classList.toggle('active', orient === 'portrait');
  document.getElementById('orientLandscape').classList.toggle('active', orient === 'landscape');
  applyPreviewFiltersAndOrientation();
}

function onPageRangeModeChange() {
  const mode = document.getElementById('pageRangeMode').value;
  const wrapper = document.getElementById('customPageInputWrapper');
  if (wrapper) {
    wrapper.style.display = (mode === 'custom') ? 'block' : 'none';
  }
}

// Submit Print Job to Express Server
async function submitPrintJob(event) {
  event.preventDefault();

  if (!selectedFile) {
    alert('Pilih file dokumen terlebih dahulu.');
    return;
  }

  const senderName = document.getElementById('senderName').value.trim() || 'HP Guest';
  const paperSize = document.getElementById('paperSize').value;
  
  const rangeMode = document.getElementById('pageRangeMode') ? document.getElementById('pageRangeMode').value : 'all';
  let pageRange = 'all';
  if (rangeMode === 'current') {
    pageRange = '1';
  } else if (rangeMode === 'custom') {
    const customVal = document.getElementById('customPageRange') ? document.getElementById('customPageRange').value.trim() : '';
    pageRange = customVal || 'all';
  }

  const pin = document.getElementById('mobilePin').value.trim();

  // Construct FormData
  const formData = new FormData();

  // If in Photo Studio mode, generate composite grid canvas blob!
  if (currentPrintMode === 'photo' && loadedImageObj) {
    openStatusModal('Membuat Lembar Foto...', 'Menyusun pasfoto ke tata letak A4...');
    const compositeBlob = await generateCompositePhotoBlob();
    formData.append('file', compositeBlob, 'pasfoto_print.png');
  } else {
    formData.append('file', selectedFile);
  }

  formData.append('senderName', senderName);
  formData.append('deviceName', senderName);
  formData.append('copies', currentCopies);
  formData.append('colorMode', currentColorMode);
  formData.append('color', currentColorMode === 'color');
  formData.append('orientation', currentOrientation);
  formData.append('paperSize', paperSize);
  formData.append('pageRange', pageRange);
  if (pin) {
    formData.append('pin', pin);
  }

  // Open Modal Progress Overlay
  openStatusModal('Uploading...', 'Mengunggah file ke printer server lokal...');

  try {
    const res = await fetch('/api/print', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (!res.ok || (data.success === false && !data.jobId)) {
      showErrorModal(data.error || 'Gagal mengirim job print.');
      return;
    }

    activeJobId = data.jobId;
    updateProgressModal('processing', 'File terupload. Memproses di printer server...');

  } catch (err) {
    console.error('Submit print job error:', err);
    showErrorModal('Gagal terhubung ke server lokal. Pastikan HP terhubung ke Wi-Fi yang sama.');
  }
}

// Modal Helper Functions
function openStatusModal(title, message) {
  const modal = document.getElementById('statusModal');
  document.getElementById('modalSpinner').style.display = 'block';
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalMessage').textContent = message;
  document.getElementById('modalCloseBtn').style.display = 'none';
  modal.classList.add('active');
}

function formatUserFriendlyError(rawMsg) {
  if (!rawMsg) return 'Gagal mengirim dokumen ke printer. Silakan coba lagi.';
  const msg = String(rawMsg).toLowerCase();

  if (msg.includes('no application is associated') || msg.includes('start-process') || msg.includes('argumentlist') || msg.includes('cannot validate argument')) {
    return 'Gagal memproses dokumen di Windows. Pastikan printer EPSON Anda dalam keadaan aktif dan terhubung.';
  }
  if (msg.includes('eaddrinuse')) {
    return 'Port printer server sedang digunakan oleh aplikasi lain.';
  }
  if (msg.includes('pin')) {
    return 'Kode PIN keamanan salah. Silakan periksa kembali PIN Anda.';
  }
  if (msg.includes('file terlalu besar') || msg.includes('limit')) {
    return 'Ukuran file terlalu besar. Batas maksimal adalah 20MB.';
  }
  if (msg.includes('tidak ditemukan') || msg.includes('enoent')) {
    return 'File dokumen tidak ditemukan atau rusak.';
  }
  if (msg.includes('timeout') || msg.includes('fetch') || msg.includes('network') || msg.includes('failed to fetch')) {
    return 'Koneksi ke printer server terputus. Pastikan HP terhubung ke Wi-Fi yang sama.';
  }

  // Sanitize any raw technical stack traces into friendly 1-sentence explanation
  if (rawMsg.length > 70 || rawMsg.includes('CategoryInfo') || rawMsg.includes('FullyQualifiedErrorId') || rawMsg.includes('PowerShell')) {
    return 'Terjadi kendala saat mengirim dokumen ke printer. Pastikan printer dalam keadaan ON dan siap mencetak.';
  }

  return rawMsg;
}

function updateProgressModal(status, message) {
  const titleEl = document.getElementById('modalTitle');
  const msgEl = document.getElementById('modalMessage');
  const spinner = document.getElementById('modalSpinner');
  const closeBtn = document.getElementById('modalCloseBtn');

  if (status === 'failed' || status === 'error') {
    msgEl.textContent = formatUserFriendlyError(message);
    titleEl.textContent = 'Pencetakan Gagal ❌';
    spinner.style.display = 'none';
    closeBtn.style.display = 'block';
    return;
  }

  msgEl.textContent = message || '';

  if (status === 'uploading') {
    titleEl.textContent = 'Mengunggah Dokumen...';
    spinner.style.display = 'block';
    closeBtn.style.display = 'none';
  } else if (status === 'processing') {
    titleEl.textContent = 'Memproses Dokumen...';
    spinner.style.display = 'block';
    closeBtn.style.display = 'none';
  } else if (status === 'printing') {
    titleEl.textContent = 'Mengirim ke Printer...';
    spinner.style.display = 'block';
    closeBtn.style.display = 'none';
  } else if (status === 'completed' || status === 'done') {
    titleEl.textContent = 'Selesai! 🎉';
    spinner.style.display = 'none';
    closeBtn.style.display = 'block';
  }
}

function showErrorModal(errorMsg) {
  const modal = document.getElementById('statusModal');
  document.getElementById('modalSpinner').style.display = 'none';
  document.getElementById('modalTitle').textContent = 'Pencetakan Gagal ❌';
  document.getElementById('modalMessage').textContent = formatUserFriendlyError(errorMsg);
  document.getElementById('modalCloseBtn').style.display = 'block';
  modal.classList.add('active');
}

function closeStatusModal() {
  const modal = document.getElementById('statusModal');
  modal.classList.remove('active');
  activeJobId = null;
  resetFileSelection();
}

// Real-time Host Notification Toast (Top Right Slide-In, Host View Only)
function showHostToastNotification(job) {
  // Do NOT show notification on HP / Mobile Client View! Only show on Laptop Host Dashboard!
  const tabHostBtn = document.getElementById('tabHostBtn');
  const isHostViewActive = tabHostBtn && tabHostBtn.classList.contains('active');
  if (!isHostViewActive) return;

  // Do NOT show toast for job initiated by this device
  if (job.id && job.id === activeJobId) return;

  const container = document.getElementById('toastContainer');
  if (!container) return;

  playNotificationChime();

  const toast = document.createElement('div');
  toast.className = 'toast-card';

  const sender = job.sender || job.deviceName || 'HP Guest';
  const fileName = job.filename || job.fileName || 'dokumen.pdf';
  const copies = (job.options && job.options.copies) ? job.options.copies : 1;
  const paper = (job.options && job.options.paperSize) ? job.options.paperSize : 'A4';

  toast.innerHTML = `
    <div class="toast-header">
      <div class="toast-title">📥 Job Print Baru Masuk!</div>
      <button type="button" onclick="this.parentElement.parentElement.remove()" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:1rem;">✕</button>
    </div>
    <div class="toast-body">
      <div>Pengirim: <span class="toast-sender">${escapeHtml(sender)}</span></div>
      <div class="toast-file">📄 ${escapeHtml(fileName)}</div>
      <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.2rem;">${copies} Lembar • ${paper}</div>
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 400);
  }, 4500);
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function playNotificationChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {}
}
