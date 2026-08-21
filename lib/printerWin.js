const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

const LOG_FILE = path.join(__dirname, '..', 'localprint-debug.log');

function writeDebugLog(section, details) {
  if (!process.env.DEBUG) return;
  const timestamp = new Date().toISOString();
  const text = typeof details === 'object' ? JSON.stringify(details) : details;
  const logLine = `[${timestamp}] [${section}] ${text}\n`;
  try {
    fs.appendFileSync(LOG_FILE, logLine);
  } catch (e) {}
  console.log(`[DEBUG] [${section}]`, text);
}

function runPowerShell(script) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Sta', '-Command', script],
      { timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, stdout: stdout || '', stderr: stderr || err.message });
        } else {
          resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
        }
      }
    );
  });
}

/**
 * Get all installed Windows printer names
 */
async function getInstalledPrinters() {
  const result = await runPowerShell(
    "Get-CimInstance -ClassName Win32_Printer | Select-Object -ExpandProperty Name"
  );
  if (!result.ok || !result.stdout) return [];
  return result.stdout.split('\r\n').map(s => s.trim()).filter(Boolean);
}

/**
 * Ambil status printer default via WMI/PowerShell.
 */
async function getStatus() {
  const result = await runPowerShell(
    "Get-CimInstance -ClassName Win32_Printer | Where-Object {$_.Default -eq $true} | Select-Object -ExpandProperty Name"
  );
  const printerName = result.ok ? result.stdout.trim() : null;
  return {
    available: !!printerName,
    printerName: printerName || null,
    state: printerName ? 'siap' : 'unknown',
    raw: result.stdout || result.stderr,
  };
}

/**
 * Kapabilitas generik Windows
 */
async function getCapabilities() {
  return { duplex: false, paperSizes: ['A4', 'Letter'], colorSupported: true, limitedControl: true };
}

/**
 * Cetak Gambar via Native Windows .NET System.Drawing Engine
 */
async function printImageWithNet(absPath, targetPrinter, options = {}) {
  const escapedPath = absPath.replace(/'/g, "''");
  const pName = (targetPrinter || '').replace(/'/g, "''");
  const copies = Math.max(1, parseInt(options.copies, 10) || 1);
  const isGrayscale = options.color === false ? '$true' : '$false';
  const isLandscape = options.orientation === 'landscape' ? '$true' : '$false';

  writeDebugLog('PRINT_IMAGE_START', { absPath, targetPrinter, copies, isGrayscale, isLandscape });

  const script = `
    Add-Type -AssemblyName System.Drawing;
    $doc = New-Object System.Drawing.Printing.PrintDocument;
    if ('${pName}' -and '${pName}' -notlike '*Default*' -and '${pName}' -notlike '*Virtual*') {
      $doc.PrinterSettings.PrinterName = '${pName}';
    }
    if (${copies} -gt 1) {
      $doc.PrinterSettings.Copies = ${copies};
    }
    if (${isLandscape}) {
      $doc.DefaultPageSettings.Landscape = $true;
    }

    $global:printError = $null;
    $img = [System.Drawing.Image]::FromFile('${escapedPath}');

    if ($img.Width -le 0 -or $img.Height -le 0) {
      throw "Image dimensions invalid: $($img.Width)x$($img.Height)";
    }

    $doc.add_PrintPage({
      param($s, $ev)
      try {
        $pb = $ev.PageBounds;
        $ev.Graphics.FillRectangle([System.Drawing.Brushes]::White, $pb);

        if (${isGrayscale}) {
          $cm = New-Object System.Drawing.Imaging.ColorMatrix (
            @(@(0.3, 0.3, 0.3, 0, 0),
              @(0.59, 0.59, 0.59, 0, 0),
              @(0.11, 0.11, 0.11, 0, 0),
              @(0, 0, 0, 1, 0),
              @(0, 0, 0, 0, 1))
          );
          $ia = New-Object System.Drawing.Imaging.ImageAttributes;
          $ia.SetColorMatrix($cm);
          $ev.Graphics.DrawImage($img, (New-Object System.Drawing.Rectangle($pb.X, $pb.Y, $pb.Width, $pb.Height)), 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia);
          $ia.Dispose();
        } else {
          $ev.Graphics.DrawImage($img, $pb.X, $pb.Y, $pb.Width, $pb.Height);
        }
      } catch {
        $global:printError = $_.Exception.Message;
      }
    });

    $doc.Print();
    $img.Dispose();

    if ($global:printError) {
      throw "Gagal mencetak gambar: $($global:printError)";
    }
  `;

  const result = await runPowerShell(script);
  writeDebugLog('PRINT_IMAGE_RESULT', { ok: result.ok, stdout: result.stdout, stderr: result.stderr });

  if (!result.ok) {
    throw new Error(`Gagal mencetak gambar ke printer: ${result.stderr}`);
  }
  return 'Gambar berhasil dikirim ke antrian cetak printer.';
}

/**
 * Cetak PDF via Native Windows 10/11 WinRT PDF Engine (Pre-Render & Validate BEFORE Print)
 */
async function printPdfWithWinRT(absPath, targetPrinter, options = {}) {
  const escapedPath = absPath.replace(/'/g, "''");
  const pName = (targetPrinter || '').replace(/'/g, "''");
  const copies = Math.max(1, parseInt(options.copies, 10) || 1);
  const isGrayscale = options.color === false ? '$true' : '$false';
  const isLandscape = options.orientation === 'landscape' ? '$true' : '$false';

  writeDebugLog('PRINT_PDF_START', { absPath, targetPrinter, copies, isGrayscale, isLandscape });

  const script = `
    Add-Type -AssemblyName System.Drawing;
    [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null;
    [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null;

    $fileOp = [Windows.Storage.StorageFile]::GetFileFromPathAsync('${escapedPath}');
    while ($fileOp.Status -eq 'Started') { Start-Sleep -Milliseconds 20 }
    $file = $fileOp.GetResults();
    if ($null -eq $file) { throw "StorageFile object is null for '${escapedPath}'"; }

    $pdfOp = [Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file);
    while ($pdfOp.Status -eq 'Started') { Start-Sleep -Milliseconds 20 }
    $pdfDoc = $pdfOp.GetResults();
    if ($null -eq $pdfDoc) { throw "PdfDocument object is null for '${escapedPath}'"; }

    $pageCount = $pdfDoc.PageCount;
    if ($pageCount -le 0) { throw "PDF page count is 0 for '${escapedPath}'"; }

    # STEP 1: PRE-RENDER ALL PAGES TO RAM BITMAPS BEFORE CALLING $doc.Print()
    $renderedBitmaps = @();
    for ($i = 0; $i -lt $pageCount; $i++) {
      $pdfPage = $pdfDoc.GetPage($i);
      
      $memStream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream;
      $renderOptions = New-Object Windows.Data.Pdf.PdfPageRenderOptions;
      $renderOptions.BackgroundColor = [Windows.UI.Color]::FromArgb(255, 255, 255, 255); # Solid White Background
      
      # High DPI Target Bounds (A4 @ 300 DPI = 2480 x 3508 pixels)
      $renderOptions.DestinationWidth = [uint32]2480;
      $renderOptions.DestinationHeight = [uint32]3508;
      
      $renderOp = $pdfPage.RenderToStreamWithOptionsAsync($memStream, $renderOptions);
      while ($renderOp.Status -eq 'Started') { Start-Sleep -Milliseconds 20 }
      
      $memStream.Seek(0);
      
      $ms = New-Object System.IO.MemoryStream;
      $netStream = $memStream.AsStreamForRead();
      $netStream.CopyTo($ms);
      $ms.Position = 0;
      
      $bmp = [System.Drawing.Bitmap]::FromStream($ms);
      $copyBmp = New-Object System.Drawing.Bitmap($bmp);
      
      if ($copyBmp.Width -le 0 -or $copyBmp.Height -le 0) {
        throw "Failed rendering page \${i}: Bitmap size is $($copyBmp.Width)x$($copyBmp.Height)";
      }
      
      $renderedBitmaps += $copyBmp;
      
      $bmp.Dispose();
      $ms.Dispose();
      $netStream.Dispose();
      $memStream.Dispose();
      $pdfPage.Dispose();
    }

    # STEP 2: ALL PAGES PRE-RENDERED SUCCESSFULLY! NOW (AND ONLY NOW) PRINT:
    $doc = New-Object System.Drawing.Printing.PrintDocument;
    
    if ('${pName}' -and '${pName}' -notlike '*Default*' -and '${pName}' -notlike '*Virtual*') {
      $doc.PrinterSettings.PrinterName = '${pName}';
    }
    if (${copies} -gt 1) {
      $doc.PrinterSettings.Copies = ${copies};
    }
    if (${isLandscape}) {
      $doc.DefaultPageSettings.Landscape = $true;
    }

    $currentPageIndex = 0;
    $global:printError = $null;

    $doc.add_PrintPage({
      param($sender, $ev)
      try {
        if ($currentPageIndex -lt $renderedBitmaps.Count) {
          $img = $renderedBitmaps[$currentPageIndex];
          $pb = $ev.PageBounds;
          $ev.Graphics.FillRectangle([System.Drawing.Brushes]::White, $pb);

          if (${isGrayscale}) {
            $cm = New-Object System.Drawing.Imaging.ColorMatrix (
              @(@(0.3, 0.3, 0.3, 0, 0),
                @(0.59, 0.59, 0.59, 0, 0),
                @(0.11, 0.11, 0.11, 0, 0),
                @(0, 0, 0, 1, 0),
                @(0, 0, 0, 0, 1))
            );
            $ia = New-Object System.Drawing.Imaging.ImageAttributes;
            $ia.SetColorMatrix($cm);
            $ev.Graphics.DrawImage($img, (New-Object System.Drawing.Rectangle($pb.X, $pb.Y, $pb.Width, $pb.Height)), 0, 0, $img.Width, $img.Height, [System.Drawing.GraphicsUnit]::Pixel, $ia);
            $ia.Dispose();
          } else {
            $ev.Graphics.DrawImage($img, $pb.X, $pb.Y, $pb.Width, $pb.Height);
          }
          
          $currentPageIndex++;
          $ev.HasMorePages = ($currentPageIndex -lt $renderedBitmaps.Count);
        } else {
          $ev.HasMorePages = $false;
        }
      } catch {
        $global:printError = $_.Exception.Message;
        $ev.HasMorePages = $false;
      }
    });

    $doc.Print();

    foreach ($b in $renderedBitmaps) { $b.Dispose(); }

    if ($global:printError) {
      throw "Gagal mencetak PDF: $($global:printError)";
    }
  `;

  const result = await runPowerShell(script);
  writeDebugLog('PRINT_PDF_RESULT', { ok: result.ok, stdout: result.stdout, stderr: result.stderr });

  if (result.ok) {
    return 'Dokumen PDF berhasil dikirim langsung ke antrian cetak printer EPSON.';
  }

  // Fallback: Edge Silent CLI
  console.warn('[LocalPrint WinRT Fallback]:', result.stderr);
  return await printPdfWithEdgeFallback(absPath, targetPrinter);
}

/**
 * Fallback Edge Silent CLI
 */
function printPdfWithEdgeFallback(absPath, targetPrinter) {
  return new Promise((resolve, reject) => {
    const edgePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    const edgeExe = edgePaths.find(p => fs.existsSync(p));

    if (!edgeExe) {
      return reject(new Error('Printer driver tidak dapat dijangkau.'));
    }

    // FIX: kalau Edge sudah punya proses/window terbuka, --print-to-default
    // dan flag CLI lain diabaikan sepenuhnya oleh Chromium (hanya proses PERTAMA
    // yang membaca flag, instance berikutnya cuma IPC "buka tab baru" ke window
    // yang sudah ada). Log kemarin membuktikan ini: "Opening in existing browser
    // session" -> PDF cuma kebuka jadi tab, TIDAK PERNAH benar-benar dicetak,
    // tapi sebelumnya kode ini tetap melaporkan sukses.
    // Solusi: paksa instance Edge baru yang terisolasi lewat --user-data-dir
    // temporer, supaya flag print selalu dibaca terlepas dari Edge yang sudah
    // terbuka di background.
    const tmpProfileDir = path.join(os.tmpdir(), `localprint-edge-${crypto.randomUUID()}`);
    const args = [
      `--user-data-dir=${tmpProfileDir}`,
      '--no-first-run',
      '--print-to-default',
      absPath
    ];
    writeDebugLog('EDGE_FALLBACK_START', { edgeExe, args });

    execFile(edgeExe, args, { timeout: 30000 }, (err, stdout, stderr) => {
      writeDebugLog('EDGE_FALLBACK_RESULT', { err: err ? err.message : null, stdout, stderr });

      // FIX: jangan percaya begitu saja pada exit code Edge. Kalau output
      // menyebutkan "existing browser session", itu tanda flag diabaikan
      // dan PDF tidak benar-benar dicetak -> laporkan sebagai gagal, bukan sukses.
      if (/existing browser session/i.test(stdout || '') || /existing browser session/i.test(stderr || '')) {
        return reject(new Error(
          'Edge fallback gagal: PDF hanya terbuka di tab browser yang sudah ada, ' +
          'tidak benar-benar terkirim ke printer. Tutup semua jendela Edge lalu coba lagi, ' +
          'atau install SumatraPDF supaya tidak bergantung ke fallback ini.'
        ));
      }
      if (err && !err.killed && err.code !== 0) {
        return reject(new Error('Gagal mencetak PDF via Edge: ' + err.message));
      }
      if (err && err.killed) {
        return reject(new Error('Edge fallback timeout/macet (30 detik) — proses di-kill paksa, PDF TIDAK tercetak.'));
      }
      resolve('Dokumen PDF dikirim ke printer via Edge (instance terisolasi).');
    });
  });
}

/**
 * Main Print Dispatcher
 */
async function printFile(filePath, options = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const absPath = path.resolve(filePath);

  writeDebugLog('PRINT_FILE_DISPATCH', { filePath, absPath, options });

  if (!fs.existsSync(absPath)) {
    throw new Error(`File dokumen tidak ditemukan di server: ${path.basename(absPath)}`);
  }

  const stat = fs.statSync(absPath);
  if (stat.size === 0) {
    throw new Error(`File dokumen 0 byte (kosong): ${path.basename(absPath)}`);
  }

  const installedPrinters = await getInstalledPrinters();
  writeDebugLog('INSTALLED_PRINTERS', { installed: installedPrinters, target: options.printerName });

  // Resolve exact printer name if available
  if (options.printerName) {
    const match = installedPrinters.find(p => p.toLowerCase() === options.printerName.toLowerCase());
    if (match) {
      options.printerName = match;
    }
  }

  // 1. Virtual Mock Printer / Test Mode
  if (options.printerName && /mock|test/i.test(options.printerName)) {
    await new Promise(r => setTimeout(r, 1200));
    return `[Virtual Mock Printer] Sukses mensimulasikan pencetakan ${path.basename(absPath)}.`;
  }

  // 2. SumatraPDF Integration (if configured or present in project root)
  let sumatraPath = process.env.SUMATRA_PATH;
  if (!sumatraPath) {
    const p1 = path.join(__dirname, '..', 'SumatraPDF.exe');
    const p2 = path.join(__dirname, '..', 'SumatraPDF-3.5.2-64.exe');
    if (fs.existsSync(p1)) sumatraPath = p1;
    else if (fs.existsSync(p2)) sumatraPath = p2;
  }
  if (sumatraPath && fs.existsSync(sumatraPath)) {
    const args = [];
    if (options.printerName && !options.printerName.includes('Default')) {
      args.push('-print-to', options.printerName);
    } else {
      args.push('-print-to-default');
    }
    const settings = [];
    settings.push(options.duplex ? 'duplex' : 'simplex');
    settings.push(options.color === false ? 'monochrome' : 'color');
    settings.push(options.orientation === 'landscape' ? 'landscape' : 'portrait');
    if (options.copies) settings.push(`${options.copies}x`);
    if (options.pageRange && options.pageRange !== 'all') settings.push(options.pageRange);
    args.push('-print-settings', settings.join(','));
    args.push(absPath);

    writeDebugLog('SUMATRA_START', { sumatraPath, args });

    return new Promise((resolve, reject) => {
      execFile(sumatraPath, args, { timeout: 30000 }, (err, stdout, stderr) => {
        writeDebugLog('SUMATRA_RESULT', { err: err ? err.message : null, stdout, stderr });
        if (err) reject(new Error(stderr || err.message));
        else resolve('Dikirim ke printer via SumatraPDF');
      });
    });
  }

  // 3. Image Printing via Native .NET System.Drawing Engine
  if (['.png', '.jpg', '.jpeg'].includes(ext)) {
    return await printImageWithNet(absPath, options.printerName, options);
  }

  // 4. PDF: WinRT native engine TERBUKTI TIDAK RELIABLE di lingkungan ini
  // (Windows.Storage.StorageFile::GetFileFromPathAsync() mengembalikan raw COM
  // object yang method .GetResults()-nya tidak terekspos ke PowerShell tanpa
  // helper Await khusus -> selalu gagal). Edge fallback juga terbukti tidak
  // reliable (sering hang/timeout 30 detik dan cuma buka tab, tidak print).
  // Solusi permanen: WAJIBKAN SumatraPDF untuk file PDF, dengan pesan jelas
  // kalau belum terpasang, alih-alih diam-diam gagal lewat 2 fallback yang
  // sudah terbukti rusak.
  if (ext === '.pdf') {
    throw new Error(
      'Mencetak PDF butuh SumatraPDF terpasang di laptop ini (engine native Windows ' +
      'untuk PDF tidak reliable). Download SumatraPDF portable dari ' +
      'sumatrapdfreader.org, lalu set environment variable SUMATRA_PATH ke lokasi ' +
      'SumatraPDF.exe (atau taruh SumatraPDF.exe di folder project ini), lalu jalankan ' +
      'ulang "npm start".'
    );
  }

  throw new Error(`Format file ${ext} belum didukung untuk pencetakan langsung.`);
}

module.exports = { getStatus, getCapabilities, printFile, writeDebugLog };
