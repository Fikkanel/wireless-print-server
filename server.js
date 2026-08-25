const express = require('express');
const multer = require('multer');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');

const config = require('./config.json');
const { getLocalIp } = require('./lib/network');
const printer = require('./lib/printer');
const scanner = require('./lib/scanner');
const { convertToPdf } = require('./lib/convert');
const jobStore = require('./lib/jobStore');

// Runtime state: active printer (persisted in memory, set from Host Dashboard)
let runtimeActivePrinter = null;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- F13: Keamanan akses lokal ----------
// Server sengaja bind ke IP lokal (bukan 0.0.0.0) supaya tidak ter-expose
// kalau ada NAT/port-forwarding yang tidak sengaja aktif di router.
const localIpInfo = getLocalIp();
const HOST_BIND = localIpInfo ? localIpInfo.address : '127.0.0.1';
const PORT = config.port || 3000;

// ---------- Optional PIN gate (F13 mitigation di PRD section 11) ----------
function checkPin(req, res, next) {
  if (!config.pin || !config.pin.enabled) return next();
  const supplied = req.headers['x-print-pin'] || req.query.pin;
  if (supplied && String(supplied) === String(config.pin.code)) return next();
  return res.status(401).json({ error: 'PIN salah atau belum diisi.' });
}

// ---------- Multer (F12: batas ukuran file) ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const unique = crypto.randomUUID();
      cb(null, `${unique}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: (config.maxFileSizeMB || 20) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!config.allowedExtensions.includes(ext)) {
      return cb(new Error(`Format file .${ext} tidak didukung.`));
    }
    cb(null, true);
  },
});

// ---------- API: konfigurasi publik untuk frontend ----------
app.get('/api/config', (req, res) => {
  res.json({
    pinRequired: !!(config.pin && config.pin.enabled),
    maxFileSizeMB: config.maxFileSizeMB,
    allowedExtensions: config.allowedExtensions,
  });
});

app.post('/api/pin/verify', (req, res) => {
  if (!config.pin || !config.pin.enabled) return res.json({ ok: true });
  const { pin } = req.body || {};
  if (String(pin) === String(config.pin.code)) return res.json({ ok: true });
  res.status(401).json({ ok: false, error: 'PIN salah.' });
});

// ---------- API: status printer + URL untuk QR (F1, F2, F6) ----------
app.get('/api/status', async (req, res) => {
  try {
    const status = await printer.getStatus();
    const caps = await printer.getCapabilities(status.printerName);
    const url = `http://${HOST_BIND}:${PORT}/`;
    const qrDataUrl = await QRCode.toDataURL(url, { width: 400, margin: 1 });

    // Daftar semua printer terinstall
    let installedPrinters = [];
    try {
      installedPrinters = await printer.getInstalledPrinters();
    } catch (e) {}

    const defaultPrinter = status.printerName || null;
    const activePrinter = runtimeActivePrinter || defaultPrinter || 'Default Printer';

    // Build printers array with isDefault flag
    const printers = installedPrinters.map(name => ({
      name,
      isDefault: name === defaultPrinter
    }));

    // Add Virtual Mock Printer for testing
    printers.push({ name: 'Virtual Mock Printer (LocalPrint Test)', isDefault: false });

    res.json({
      ip: HOST_BIND,
      port: PORT,
      serverUrl: url,
      qrDataUrl,
      printer: status,
      printers,
      capabilities: caps,
      settings: {
        activePrinter,
        pinProtection: !!(config.pin && config.pin.enabled)
      },
      network: { ip: HOST_BIND, port: PORT, url }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- API: daftar semua printer terinstall ----------
app.get('/api/printers', async (req, res) => {
  try {
    const status = await printer.getStatus();
    const installedPrinters = await printer.getInstalledPrinters();
    const defaultPrinter = status.printerName || null;

    const printers = installedPrinters.map(name => ({
      name,
      isDefault: name === defaultPrinter
    }));
    printers.push({ name: 'Virtual Mock Printer (LocalPrint Test)', isDefault: false });

    res.json({ printers, defaultPrinter, activePrinter: runtimeActivePrinter || defaultPrinter });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- API: simpan pengaturan host (printer aktif, PIN) ----------
app.post('/api/settings', express.json(), (req, res) => {
  const { activePrinter, pinProtection, pinCode } = req.body || {};
  if (activePrinter) {
    runtimeActivePrinter = activePrinter;
    console.log(`[Settings] Printer target aktif diubah ke: ${activePrinter}`);
  }
  if (typeof pinProtection === 'boolean') {
    config.pin = config.pin || {};
    config.pin.enabled = pinProtection;
    if (pinCode) config.pin.code = String(pinCode);
  }
  res.json({ ok: true, activePrinter: runtimeActivePrinter });
});

// ---------- API: daftar scanner terinstall ----------
app.get('/api/scanners', async (req, res) => {
  try {
    const list = await scanner.getInstalledScanners();
    res.json({ scanners: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- API: eksekusi scan nirkabel dari HP ----------
app.post('/api/scan', checkPin, async (req, res) => {
  try {
    const { resolution, colorMode, format, deviceIndex } = req.body || {};
    console.log(`[Scan Request] DPI:${resolution || 150}, Mode:${colorMode || 'color'}, Format:${format || 'png'}`);
    
    // Broadcast status scanning via WS
    wss.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'scan-status', message: 'Scanner sedang memindai dokumen...' }));
      }
    });

    const result = await scanner.scanDocument({ resolution, colorMode, format, deviceIndex }, UPLOAD_DIR);
    const fileUrl = `/api/scan/download/${result.fileName}`;

    // Auto schedule cleanup after 30 minutes for scanned files
    scheduleCleanupAfter(1800, result.filePath);

    res.json({
      success: true,
      message: 'Scan berhasil diselesaikan!',
      fileName: result.fileName,
      downloadUrl: fileUrl,
      previewUrl: fileUrl,
      details: result
    });
  } catch (err) {
    console.error('[Scan Error]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------- API: download / view hasil scan ----------
app.get('/api/scan/download/:filename', (req, res) => {
  const fileName = path.basename(req.params.filename);
  const filePath = path.join(UPLOAD_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File hasil scan tidak ditemukan atau sudah kadaluarsa.');
  }
  res.sendFile(filePath);
});

// ---------- API: QR code image (data URL) ----------
app.get('/api/qrcode', async (req, res) => {
  try {
    const url = `http://${HOST_BIND}:${PORT}/`;
    const dataUrl = await QRCode.toDataURL(url, { width: 400, margin: 1 });
    res.json({ dataUrl, url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- API: riwayat/antrian job (F9) ----------
app.get('/api/jobs', (req, res) => {
  res.json(jobStore.getAll());
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobStore.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job tidak ditemukan' });
  res.json(job);
});

// ---------- API: upload + print (F3, F5, F7, F8, F10, F15) ----------
app.post('/api/print', checkPin, (req, res) => {
  upload.any()(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    const uploadedFile = req.file || (req.files && req.files.length > 0 ? req.files[0] : null);
    if (!uploadedFile) {
      return res.status(400).json({ error: 'Tidak ada file yang diupload.' });
    }

    const deviceName = (req.body.deviceName || req.body.senderName || '').trim().slice(0, 60);
    const options = {
      orientation: req.body.orientation === 'landscape' ? 'landscape' : 'portrait',
      color: req.body.colorMode === 'grayscale' ? false : (req.body.color !== 'false' && req.body.color !== false),
      paperSize: req.body.paperSize || 'A4',
      duplex: req.body.duplex === 'true' || req.body.duplex === true,
      copies: Math.max(1, parseInt(req.body.copies, 10) || 1),
      pageRange: req.body.pageRange || 'all',
      printerName: req.body.activePrinter || runtimeActivePrinter || null
    };

    const job = jobStore.createJob({ fileName: uploadedFile.originalname, deviceName, options });
    res.json({ jobId: job.id });

    // Proses print secara async (client sudah dapat jobId, status dikirim via WS)
    processJob(job, uploadedFile, options).catch(() => {
      /* error sudah dicatat di dalam processJob */
    });
  });
});

async function processJob(job, file, options) {
  let filePath = file.path;
  try {
    const stat = fs.statSync(filePath);
    writeDebugLog('JOB_PROCESS_START', { jobId: job.id, file: file.originalname, size: stat.size, path: filePath });

    if (stat.size === 0) {
      throw new Error(`File yang diupload berukuran 0 byte (kosong).`);
    }

    jobStore.updateJob(job.id, { status: 'processing', message: 'Memproses file...' });

    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.docx') {
      filePath = await convertToPdf(filePath, UPLOAD_DIR);
    }

    // Validate PDF magic bytes if file is PDF
    const targetExt = path.extname(filePath).toLowerCase();
    if (targetExt === '.pdf') {
      const buffer = Buffer.alloc(10);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buffer, 0, 10, 0);
      fs.closeSync(fd);
      const header = buffer.toString('utf8');
      if (!header.startsWith('%PDF')) {
        throw new Error(`Dokumen PDF tidak valid / corrupt (Header: ${header.trim()}).`);
      }
    }

    jobStore.updateJob(job.id, { status: 'printing', message: 'Mengirim ke printer...' });
    const result = await printer.printFile(filePath, options);

    writeDebugLog('JOB_PROCESS_SUCCESS', { jobId: job.id, result });
    jobStore.updateJob(job.id, { status: 'done', message: result || 'Selesai dicetak.' });
  } catch (err) {
    writeDebugLog('JOB_PROCESS_ERROR', { jobId: job.id, error: err.message, stack: err.stack });
    jobStore.updateJob(job.id, { status: 'error', message: err.message });
  } finally {
    scheduleCleanupAfter(30, file.path, filePath);
  }
}

function writeDebugLog(section, details) {
  if (!process.env.DEBUG) return;
  const LOG_FILE = path.join(__dirname, 'localprint-debug.log');
  const timestamp = new Date().toISOString();
  const text = typeof details === 'object' ? JSON.stringify(details) : details;
  const logLine = `[${timestamp}] [SERVER:${section}] ${text}\n`;
  try {
    fs.appendFileSync(LOG_FILE, logLine);
  } catch (e) {}
  console.log(`[DEBUG] [SERVER:${section}]`, text);
}

function scheduleCleanupAfter(seconds, ...paths) {
  // Wait 30 seconds after printing completes so PowerShell/spooler reads the file completely before deletion
  setTimeout(() => {
    for (const p of new Set(paths)) {
      if (p && fs.existsSync(p)) {
        fs.unlink(p, () => {});
      }
    }
  }, seconds * 1000);
}

// Clean any leftover orphan files in uploads directory
function cleanOrphanUploads() {
  fs.readdir(UPLOAD_DIR, (err, files) => {
    if (err || !files) return;
    files.forEach(f => {
      const fullPath = path.join(UPLOAD_DIR, f);
      fs.unlink(fullPath, () => {});
    });
  });
}
cleanOrphanUploads();

// ---------- Halaman Single Page App (Auto-Detect Laptop vs HP) ----------
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- HTTP + WebSocket (F8: status real-time) ----------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(job) {
  const payload = JSON.stringify({ type: 'job-update', job });
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(payload);
  });
}
jobStore.on('update', broadcast);

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: Port ${PORT} di IP ${HOST_BIND} sedang digunakan oleh proses lain.`);
    console.error(`   Pastikan tidak ada instance LocalPrint lain yang sedang berjalan.\n`);
    process.exit(1);
  } else {
    throw err;
  }
});

server.listen(PORT, HOST_BIND, () => {
  console.log('==============================================');
  console.log('  🚀 LocalPrint Server Aktif!');
  console.log(`  🌐 Akses URL (Auto-Detect Laptop/HP): http://${HOST_BIND}:${PORT}/`);
  console.log('==============================================');

  if (config.openHostOnStart) {
    import('open')
      .then(({ default: open }) => open(`http://${HOST_BIND}:${PORT}/`))
      .catch(() => {});
  }
});

