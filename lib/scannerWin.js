const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function runPowerShell(script) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Sta', '-Command', script],
      { timeout: 120000 }, // 2 minute timeout for scanning
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
 * Get all connected WIA Scanner devices
 */
async function getInstalledScanners() {
  const script = `
    $dm = New-Object -ComObject WIA.DeviceManager;
    $scanners = @();
    for ($i = 1; $i -le $dm.DeviceInfos.Count; $i++) {
      $d = $dm.DeviceInfos.Item($i);
      if ($d.Type -eq 1) { # 1 = ScannerDeviceType
        $name = "";
        foreach ($p in $d.Properties) {
          if ($p.Name -eq "Name") { $name = $p.Value }
        }
        if (-not $name) { $name = "Scanner Device #$i" }
        $scanners += @{ index = $i; name = $name; id = $d.DeviceId };
      }
    }
    $scanners | ConvertTo-Json -Compress;
  `;

  const result = await runPowerShell(script);
  if (!result.ok || !result.stdout) return [];
  try {
    const parsed = JSON.parse(result.stdout.trim());
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    return [];
  }
}

/**
 * Perform WIA document scan
 * @param {Object} options { resolution: 150|300|600, colorMode: 'color'|'grayscale'|'bw', format: 'png'|'jpg', deviceIndex: 1 }
 * @param {string} outputDir Directory to save scanned image
 */
async function scanDocument(options = {}, outputDir) {
  const resolution = parseInt(options.resolution, 10) || 150;
  const colorMode = options.colorMode === 'grayscale' ? 2 : (options.colorMode === 'bw' ? 4 : 1); // 1: Color, 2: Gray, 4: BW
  const formatExt = (options.format || 'png').toLowerCase() === 'jpg' ? 'jpg' : 'png';
  const formatGuid = formatExt === 'jpg' ? '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}' : '{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}';
  const deviceIndex = parseInt(options.deviceIndex, 10) || 1;

  const fileName = `scan_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${formatExt}`;
  const absPath = path.resolve(path.join(outputDir, fileName));
  const escapedPath = absPath.replace(/'/g, "''");

  const script = `
    $dm = New-Object -ComObject WIA.DeviceManager;
    $scannerInfo = $null;
    
    # Find matching scanner device
    $scanners = @();
    for ($i = 1; $i -le $dm.DeviceInfos.Count; $i++) {
      $d = $dm.DeviceInfos.Item($i);
      if ($d.Type -eq 1) { $scanners += $d }
    }

    if ($scanners.Count -eq 0) {
      throw "Tidak ada perangkat scanner (WIA) yang terhubung di laptop server.";
    }

    $idx = ${deviceIndex} - 1;
    if ($idx -lt 0 -or $idx -ge $scanners.Count) { $idx = 0; }
    $device = $scanners[$idx].Connect();
    $item = $device.Items.Item(1);

    # Property WIA IDs:
    # 6146: Color Mode (1: Color, 2: Grayscale, 4: Black & White)
    # 6147: Horizontal Resolution (DPI)
    # 6148: Vertical Resolution (DPI)
    
    try { $item.Properties.Item("6146").Value = ${colorMode} } catch {}
    try { $item.Properties.Item("6147").Value = ${resolution} } catch {}
    try { $item.Properties.Item("6148").Value = ${resolution} } catch {}

    # Perform Scan Transfer
    $image = $item.Transfer("${formatGuid}");
    if ($null -eq $image) { throw "Gagal mengambil gambar dari scanner."; }

    if (Test-Path '${escapedPath}') { Remove-Item '${escapedPath}' -Force }
    $image.SaveFile('${escapedPath}');
    Write-Output "SUCCESS:${fileName}";
  `;

  const result = await runPowerShell(script);
  if (!result.ok || !result.stdout.includes('SUCCESS:')) {
    throw new Error(`Gagal melakukan scan: ${result.stderr || result.stdout || 'Periksa koneksi scanner.'}`);
  }

  return {
    fileName,
    filePath: absPath,
    format: formatExt,
    resolution,
    colorMode: options.colorMode || 'color'
  };
}

module.exports = { getInstalledScanners, scanDocument };
