const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Konversi file (docx/pptx/xlsx, dll) menjadi PDF menggunakan LibreOffice headless.
 * Membutuhkan LibreOffice terinstall (`soffice` ada di PATH).
 * Mengembalikan path file PDF hasil konversi.
 */
function convertToPdf(inputPath, outDir) {
  return new Promise((resolve, reject) => {
    const binary = process.platform === 'darwin'
      ? '/Applications/LibreOffice.app/Contents/MacOS/soffice'
      : 'soffice';

    const args = ['--headless', '--convert-to', 'pdf', '--outdir', outDir, inputPath];

    execFile(binary, args, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        reject(
          new Error(
            'Konversi ke PDF gagal. Pastikan LibreOffice terinstall di laptop ini (dibutuhkan untuk mencetak file DOCX/PPTX). Detail: ' +
              (stderr || err.message)
          )
        );
        return;
      }
      const base = path.basename(inputPath, path.extname(inputPath));
      const outputPath = path.join(outDir, `${base}.pdf`);
      if (fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error('Konversi selesai tapi file PDF hasil tidak ditemukan.'));
      }
    });
  });
}

module.exports = { convertToPdf };
