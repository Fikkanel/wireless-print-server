const { execFile } = require('child_process');
const path = require('path');
const crypto = require('crypto');

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, stdout: stdout || '', stderr: stderr || err.message });
      } else {
        resolve({ ok: true, stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
}

async function getInstalledScanners() {
  const result = await run('scanimage', ['-L']);
  if (!result.ok || !result.stdout) return [];
  const lines = result.stdout.split('\n').filter(Boolean);
  return lines.map((line, idx) => {
    const match = line.match(/`(.+)' is a (.+)/);
    return {
      index: idx + 1,
      name: match ? match[2].trim() : line.trim(),
      id: match ? match[1].trim() : `device_${idx + 1}`
    };
  });
}

async function scanDocument(options = {}, outputDir) {
  const resolution = parseInt(options.resolution, 10) || 150;
  const mode = options.colorMode === 'grayscale' ? 'Gray' : (options.colorMode === 'bw' ? 'Lineart' : 'Color');
  const formatExt = (options.format || 'png').toLowerCase() === 'jpg' ? 'jpg' : 'png';
  const fileName = `scan_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${formatExt}`;
  const absPath = path.resolve(path.join(outputDir, fileName));

  const args = [
    `--format=${formatExt === 'jpg' ? 'jpeg' : 'png'}`,
    `--resolution=${resolution}`,
    `--mode=${mode}`,
    `--output-file=${absPath}`
  ];

  const result = await run('scanimage', args);
  if (!result.ok) {
    throw new Error(`Gagal melakukan scan di SANE: ${result.stderr}`);
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
