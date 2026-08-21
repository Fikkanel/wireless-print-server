const { execFile } = require('child_process');

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, stdout: stdout || '', stderr: stderr || err.message });
      } else {
        resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
}

/**
 * Ambil nama printer default via `lpstat -d`, dan status via `lpstat -p`.
 * Best-effort: kalau CUPS tidak ada / gagal, kembalikan status 'unknown'.
 */
async function getStatus() {
  const def = await run('lpstat', ['-d']);
  const list = await run('lpstat', ['-p']);

  if (!def.ok && !list.ok) {
    return { available: false, printerName: null, state: 'unknown', raw: def.stderr || list.stderr };
  }

  let printerName = null;
  const match = def.stdout.match(/system default destination:\s*(.+)/i);
  if (match) printerName = match[1].trim();

  let state = 'unknown';
  if (printerName && list.ok) {
    const lines = list.stdout.split('\n');
    const line = lines.find((l) => l.includes(printerName));
    if (line) {
      if (/idle/i.test(line)) state = 'siap';
      else if (/disabled/i.test(line)) state = 'error';
      else state = 'sibuk';
    }
  }

  return { available: !!printerName, printerName, state, raw: list.stdout };
}

/**
 * Ambil opsi yang didukung printer (duplex, ukuran kertas, dsb) via `lpoptions -l`.
 * Best-effort — dipakai untuk F6 (Deteksi Kapabilitas Printer).
 */
async function getCapabilities(printerName) {
  if (!printerName) return { duplex: false, paperSizes: ['A4'], colorSupported: true };

  const result = await run('lpoptions', ['-p', printerName, '-l']);
  if (!result.ok) {
    return { duplex: false, paperSizes: ['A4'], colorSupported: true };
  }

  const text = result.stdout;
  const duplex = /Duplex\//i.test(text);
  const colorSupported = /ColorModel\//i.test(text) || /PrintoutMode\//i.test(text);

  let paperSizes = ['A4'];
  const pageSizeLine = text.split('\n').find((l) => /^PageSize\//i.test(l));
  if (pageSizeLine) {
    const optionsPart = pageSizeLine.split(':')[1] || '';
    const parsed = optionsPart
      .trim()
      .split(/\s+/)
      .map((s) => s.replace('*', ''))
      .filter(Boolean);
    if (parsed.length) paperSizes = parsed;
  }

  return { duplex, paperSizes, colorSupported };
}

/**
 * Cetak file via `lp` dengan opsi CUPS standar.
 * options: { copies, orientation, color, paperSize, duplex, pageRange }
 */
async function printFile(filePath, options = {}) {
  const args = [];

  if (options.printerName && !options.printerName.includes('Default')) {
    args.push('-d', options.printerName);
  }

  if (options.copies) args.push('-n', String(options.copies));

  const cupsOptions = [];

  if (options.orientation === 'landscape') {
    cupsOptions.push('orientation-requested=4');
  } else {
    cupsOptions.push('orientation-requested=3');
  }

  if (options.color === false) {
    cupsOptions.push('ColorModel=Gray');
  }

  if (options.paperSize) {
    cupsOptions.push(`media=${options.paperSize}`);
  }

  if (options.duplex) {
    cupsOptions.push('sides=two-sided-long-edge');
  } else {
    cupsOptions.push('sides=one-sided');
  }

  if (options.pageRange && options.pageRange !== 'all') {
    cupsOptions.push(`page-ranges=${options.pageRange}`);
  }

  for (const opt of cupsOptions) {
    args.push('-o', opt);
  }

  args.push(filePath);

  const result = await run('lp', args);
  if (!result.ok) {
    throw new Error(result.stderr || 'Gagal mengirim job ke printer (lp gagal dijalankan).');
  }
  return result.stdout.trim();
}

module.exports = { getStatus, getCapabilities, printFile };
