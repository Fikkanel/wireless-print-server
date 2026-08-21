# PRD: LocalPrint — Platform Print via QR Code (Local Network)

## 1. Ringkasan Produk
LocalPrint adalah aplikasi web lokal (self-hosted) yang berjalan di laptop yang terhubung langsung ke printer via kabel (USB), dan laptop tersebut juga terhubung ke jaringan WiFi rumah. Aplikasi menampilkan QR code di layar laptop. Pengguna lain di jaringan WiFi yang sama dapat memindai QR code tersebut dari HP untuk membuka halaman upload file, mengatur opsi cetak (orientasi, warna, margin, rentang halaman, dll), lalu mengirim perintah print — tanpa perlu install driver printer di HP atau transfer file manual (email/USB/AirDrop).

**Value proposition:** Print tanpa kabel dari HP siapa pun yang terhubung ke WiFi rumah/kantor, cukup scan QR — tidak perlu install app, tidak perlu akun.

---

## 2. Latar Belakang & Masalah
- Printer di rumah/kantor kecil biasanya hanya terhubung ke satu laptop via kabel USB.
- Anggota keluarga/tim lain yang ingin mencetak dari HP harus: kirim file ke laptop pemilik dulu (chat/email), lalu pemilik baru mencetak manual — proses lambat dan tidak praktis.
- Solusi seperti Google Cloud Print sudah dihentikan; AirPrint terbatas ekosistem Apple & printer yang mendukung; setup driver network printer di banyak device merepotkan.
- Dibutuhkan solusi ringan, tanpa instalasi tambahan di sisi HP, cukup browser + kamera.

---

## 3. Tujuan (Goals)
1. Pengguna dapat mengirim file dari HP ke printer yang terhubung ke laptop, hanya dengan scan QR code.
2. Tidak perlu instalasi aplikasi tambahan di HP (cukup browser).
3. Mendukung pengaturan cetak dasar: orientasi, warna/hitam-putih, margin, rentang halaman, jumlah salinan.
4. Berjalan sepenuhnya di jaringan lokal (LAN/WiFi), tanpa perlu internet/cloud, untuk privasi dan kecepatan.
5. Antarmuka sederhana dan cepat dipahami tanpa training.

### Non-Goals (Out of Scope untuk v1)
- Tidak mendukung printer yang tidak terdeteksi/terinstall di OS laptop (driver tetap tanggung jawab OS).
- Tidak mendukung akses dari luar jaringan lokal (via internet) di versi awal.
- Tidak ada sistem antrian multi-user kompleks (multi-print-job queue dengan prioritas) di v1 — cukup FIFO sederhana.
- Tidak ada fitur scan/fax.

---

## 4. Target Pengguna
- Pemilik rumah/kos/kantor kecil yang punya 1 printer kabel dan ingin dipakai bersama oleh anggota keluarga/tim via WiFi.
- Non-teknis, sehingga UI harus sangat sederhana (mirip alur "scan QR untuk bayar/parkir").

---

## 5. User Flow Utama

1. **Di Laptop (Host/Server):**
   - Menjalankan aplikasi server lokal (via shortcut/aplikasi desktop, atau auto-start).
   - Aplikasi mendeteksi IP lokal laptop di jaringan WiFi (mis. `192.168.1.10:3000`).
   - Menampilkan halaman utama berisi **QR code** yang meng-encode URL tersebut, plus status printer (nama printer, status: siap/error/kertas habis, dll).

2. **Di HP (Client/User):**
   - Buka kamera HP → scan QR → browser terbuka otomatis ke URL lokal laptop.
   - Muncul halaman **Upload File** (drag & drop / pilih dari galeri/file manager/kamera langsung foto dokumen).
   - Setelah file dipilih, muncul **preview** file (jika format didukung: PDF, gambar, docx dikonversi preview).
   - Muncul **panel pengaturan cetak**:
     - Orientasi: Potrait / Landscape
     - Warna: Berwarna / Hitam-Putih (Grayscale)
     - Ukuran kertas: A4 / Letter / F4 / dll (ambil dari kapabilitas printer)
     - Margin: Default / Sempit / Lebar / Custom (mm)
     - Rentang halaman: All Pages / Custom Range (mis. 1-3,5) / Current Page
     - Jumlah salinan (copies)
     - Scale/fit to page (opsional)
     - Duplex (bolak-balik) — jika printer mendukung
   - Tombol **Print** → file diupload ke server laptop → server memproses & mengirim job ke printer via sistem cetak OS (CUPS di Linux/Mac, atau Print Spooler di Windows).
   - HP menampilkan status: "Uploading… → Processing… → Sent to printer → Selesai/Gagal".

3. **Di Laptop:**
   - Menampilkan log/antrian print job yang masuk (nama file, pengirim/device, waktu, status).
   - Opsional: notifikasi desktop saat job baru masuk.

---

## 6. Fitur & Requirement Fungsional

| ID | Fitur | Deskripsi | Prioritas |
|----|-------|-----------|-----------|
| F1 | Generate QR Code | Server generate QR berisi URL lokal (IP:port) saat start | Must Have |
| F2 | Deteksi IP Lokal Otomatis | Auto-detect IP WiFi laptop, regenerate QR jika IP berubah | Must Have |
| F3 | Halaman Upload (mobile-friendly) | Upload dari galeri, file manager, atau kamera (foto dokumen) | Must Have |
| F4 | Preview File | Preview PDF/gambar sebelum print | Should Have |
| F5 | Pengaturan Cetak | Orientasi, warna, margin, ukuran kertas, rentang halaman, copies | Must Have |
| F6 | Deteksi Kapabilitas Printer | Ambil opsi yang benar-benar didukung printer (misal duplex hanya jika ada) | Should Have |
| F7 | Kirim Job ke Printer | Eksekusi print via OS print system | Must Have |
| F8 | Status Real-time | Update status job (uploading/printing/done/error) ke HP | Must Have |
| F9 | Riwayat/Antrian di Laptop | Dashboard di laptop menampilkan job masuk & histori | Should Have |
| F10 | Multi-device Support | Beberapa HP bisa akses bersamaan, job masuk antrian FIFO | Should Have |
| F11 | Format File Didukung | PDF, JPG/PNG, DOCX (convert ke PDF dulu) | Must Have |
| F12 | Batas Ukuran File | Validasi ukuran file max (mis. 20MB) | Must Have |
| F13 | Keamanan Akses Lokal | Hanya bisa diakses dalam jaringan yang sama (tidak expose ke internet) | Must Have |
| F14 | Notifikasi Laptop | Notifikasi desktop saat ada job masuk (opsional toggle) | Nice to Have |
| F15 | Nama Perangkat Pengirim | Minta user isi nama singkat (mis. "HP Budi") agar mudah dikenali di histori | Nice to Have |

---

## 7. Requirement Non-Fungsional
- **Performa:** Upload & mulai proses print < 5 detik untuk file < 10MB di jaringan lokal.
- **Kompatibilitas Browser HP:** Chrome, Safari (iOS), Samsung Internet — tanpa perlu app tambahan.
- **Kompatibilitas OS Laptop:** Windows 10/11, macOS, Linux (minimal salah satu untuk v1, direkomendasikan cross-platform).
- **Keamanan:**
  - Server hanya bind ke local network interface, bukan `0.0.0.0` yang expose ke luar jika ada NAT/port forwarding tak sengaja.
  - Opsional PIN/kode akses sederhana agar tidak sembarang orang di WiFi yang sama bisa print (mis. tetangga yang numpang WiFi).
  - File yang diupload dihapus otomatis dari server setelah print selesai (atau after X menit) untuk privasi.
- **Reliability:** Jika printer offline/error, HP harus mendapat pesan error yang jelas (bukan hang/loading terus).
- **Usability:** Tidak perlu instruksi manual — QR → upload → print dalam ≤ 4 langkah.

---

## 8. Arsitektur Teknis (Usulan)

```
[ HP Browser ]  <--- WiFi (HTTP/WebSocket) --->  [ Laptop: Local Web Server ]
                                                          |
                                                          | (Print Command)
                                                          v
                                                   [ OS Print System ]
                                                   (CUPS / Windows Spooler)
                                                          |
                                                          v
                                                   [ Printer via USB ]
```

**Stack yang disarankan:**
- **Backend/Server:** Node.js (Express/Fastify) — mudah cross-platform, bisa dibundling jadi aplikasi desktop dengan Electron/Tauri agar user awam tinggal double-click.
- **Frontend Mobile Upload Page:** Web app responsif (React/Vue/Svelte, atau HTML+JS ringan agar loading cepat di HP).
- **QR Code Generator:** Library `qrcode` (Node.js) — generate berdasarkan `http://<local-ip>:<port>`.
- **Print Execution:**
  - Windows: gunakan library seperti `pdf-to-printer` atau panggil `PowerShell`/`SumatraPDF` command-line untuk print silent dengan parameter (orientasi, dsb).
  - macOS/Linux: gunakan `lp`/`lpr` (CUPS) yang mendukung banyak parameter cetak (`-o media=A4`, `-o orientation-requested`, `-o ColorModel=Gray`, dll).
- **File Conversion:** Untuk DOCX → PDF gunakan LibreOffice headless (`soffice --headless --convert-to pdf`) agar hasil cetak konsisten.
- **Realtime Status:** WebSocket atau polling sederhana untuk update status ke HP.
- **Local Network Detection:** Baca IP address interface WiFi aktif (`os.networkInterfaces()` di Node.js).

---

## 9. Wireframe (Deskripsi Layar)

**Layar Laptop (Host):**
- Header: "LocalPrint — [Nama Printer] [Status: ● Siap]"
- QR Code besar di tengah
- Teks kecil: "Scan dengan kamera HP untuk mulai print"
- Bawah: tabel riwayat job (Nama file | Pengirim | Waktu | Status)

**Layar HP — Step 1 (Upload):**
- Tombol besar "Pilih File" / "Ambil Foto" / drag-drop area
- Preview thumbnail setelah file dipilih

**Layar HP — Step 2 (Pengaturan):**
- Toggle: Potrait / Landscape
- Toggle: Warna / Hitam-Putih
- Dropdown: Ukuran kertas
- Dropdown: Margin (Default/Sempit/Lebar/Custom)
- Radio: All Pages / Halaman ini saja / Custom range (input text "1-3,5")
- Stepper: Jumlah salinan
- Tombol besar "Print Sekarang"

**Layar HP — Step 3 (Status):**
- Progress bar / spinner: Uploading → Mengirim ke printer → Selesai ✅ (atau Gagal ❌ + alasan)

---

## 10. Metrics / Success Criteria
- Waktu dari scan QR sampai file terkirim ke printer < 15 detik (untuk file umum 1-5 halaman).
- Tingkat keberhasilan print job (job selesai tanpa error) > 95%.
- Tidak ada instalasi tambahan diperlukan di HP (0% drop-off karena harus install app).

---

## 11. Risiko & Mitigasi

| Risiko | Mitigasi |
|--------|----------|
| Printer driver berbeda-beda antar OS/merek, parameter cetak tidak seragam | Gunakan CUPS (lebih standar di Linux/Mac); untuk Windows perlu testing per printer, sediakan fallback "print default settings" jika parameter custom gagal |
| Laptop tidur/sleep sehingga server mati | Tambahkan pengaturan agar laptop tidak sleep saat server aktif, atau jalankan sebagai background service |
| IP WiFi berubah-ubah (DHCP) | Auto-refresh QR code saat IP berubah; tampilkan warning di layar laptop |
| Orang luar (tetangga nebeng WiFi) ikut bisa akses & print | Tambahkan PIN akses opsional / matikan expose ke jaringan tamu (guest network) |
| Format file tidak didukung (mis. .pptx, .xlsx) | Batasi ke PDF/JPG/PNG/DOCX dulu di v1, tambahkan lainnya secara bertahap |

---

## 12. Roadmap Bertahap

**V1 (MVP):**
- QR generate, upload PDF/gambar, print dengan pengaturan dasar (orientasi, warna, copies, page range), status realtime.

**V2:**
- Support DOCX/PPTX via konversi otomatis, riwayat & dashboard laptop lebih lengkap, PIN akses, notifikasi desktop.

**V3:**
- Multi-printer support (pilih printer jika laptop terhubung ke lebih dari 1 printer), duplex printing, custom margin presisi (mm), akses remote via internet (opsional, dengan autentikasi kuat).

---

## 13. Pertanyaan Terbuka
- Apakah perlu dibuat sebagai aplikasi desktop (Electron/Tauri) agar auto-start & lebih mudah dipakai orang awam, atau cukup dijalankan via terminal/command untuk versi pertama?
- Printer yang dipakai apa mereknya? (untuk memastikan kompatibilitas driver/CUPS/parameter cetak yang tersedia)
- Apakah dibutuhkan proteksi PIN sejak v1, mengingat WiFi rumah biasanya dipakai banyak orang?
