# LocalPrint 🖨️ — Wireless Printing Server via QR Code (Local Network)

**LocalPrint** adalah platform web server pencetakan nirkabel (*wireless printing*) berbasis **Node.js (Express)**. Aplikasi ini memungkinkan perangkat mobile (HP/Tablet) yang terhubung di jaringan Wi-Fi lokal yang sama untuk mencetak dokumen (`.pdf`, `.docx`, `.jpg`, `.png`) langsung ke printer yang terhubung ke laptop/desktop host **tanpa perlu menginstal aplikasi tambahan di HP**.

---

## ✨ Fitur Utama

- 📱 **QR Code Access & Auto-Detect UI**: Cukup scan QR Code dari HP untuk langsung membuka halaman cetak. URL otomatis menyesuaikan tampilan Mobile Client untuk HP dan Host Dashboard untuk Laptop.
- 🖼️ **Photo Studio Engine**: Fitur pasfoto & studio interaktif! Pilih rasio foto (3:4, 2:3, 4:6, 1:1, 4:3), *pan* (geser atas-bawah-kiri-kanan), *zoom*, dan atur jumlah foto per lembar A4 (1, 2, 4, 6, 8, 9, 12 foto).
- 📄 **Visual PDF Preview (PDF.js Integration)**: Tampilan visual halaman pertama PDF yang tajam (High-DPI scaling) lengkap dengan rotasi orientasi lanskap/potret dan filter pratinjau Hitam-Putih.
- ⚙️ **Pengaturan Cetak Lengkap**: Pilihan orientasi, mode warna/grayscale, ukuran kertas (A4/Letter), rentang halaman (*All Pages*, *Only This Page*, *Custom Range* `eg. 1-4, 3`), dan jumlah salinan (copies).
- ⚡ **Pencetakan Silent & Stabil di Windows (SumatraPDF CLI Integration)**: Menggunakan SumatraPDF Portable CLI untuk pengiriman data dokumen secara langsung (*vector printing*) ke spooler printer tanpa pop-up browser atau jendela aplikasi.
- 🔔 **Notifikasi Host Dashboard Real-Time**: Animasi *slide-in toast card* di pojok kanan atas layar laptop host disertai efek suara *chime* saat ada job cetak baru dari HP.
- 🔒 **Proteksi PIN & Pembersihan File Otomatis**: Fitur PIN opsional untuk keamanan Wi-Fi publik, serta pembersihan file otomatis dari folder `uploads/` setelah job selesai untuk menjaga privasi.

---

## 🛠️ Persyaratan Sistem

1. **Laptop/Desktop Host**:
   - **Node.js** v16.0.0 atau lebih baru ([Download Node.js](https://nodejs.org/)).
   - **Printer** (misal: EPSON L3210 Series / Canon / HP / Brother) yang sudah terhubung via USB / Wi-Fi dan terdaftar sebagai printer di Windows / macOS / Linux.
   - Laptop dan Perangkat Mobile (HP) terhubung pada **jaringan Wi-Fi yang sama**.
2. **Mesin Cetak Windows (Wajib untuk Windows)**:
   - **SumatraPDF Portable** (disarankan untuk pencetakan PDF silent yang 100% stabil).

---

## 🚀 Panduan Instalasi & Cara Setting

### Langkah 1: Clone Repository
```bash
git clone https://github.com/Fikkanel/wireless-print-server.git
cd wireless-print-server
```

### Langkah 2: Install Dependensi
```bash
npm install
```

### Langkah 3: Setting SumatraPDF di Windows (Wajib untuk Cetak PDF di Windows)
Untuk memastikan pencetakan PDF di Windows berjalan secara *silent*, cepat, dan stabil tanpa membuka jendela aplikasi:
1. Unduh **SumatraPDF Portable 64-bit** dari situs resminya:  
   👉 [https://www.sumatrapdfreader.org/download-free-pdf-viewer](https://www.sumatrapdfreader.org/download-free-pdf-viewer)
2. Ekstrak file yang diunduh dan ganti nama filenya menjadi `SumatraPDF.exe`.
3. Tempatkan file `SumatraPDF.exe` langsung di **folder utama project** (sejajar dengan file `server.js`).

> *Catatan: Jika file `SumatraPDF.exe` ditaruh di folder luar, Anda dapat menambahkan Environment Variable `SUMATRA_PATH` yang mengarah ke file executable tersebut.*

### Langkah 4: Jalankan Server
```bash
npm start
```

Setelah server aktif, terminal akan menampilkan URL akses lokal Anda:
```text
==============================================
  🚀 LocalPrint Server Aktif!
  🌐 Akses URL (Auto-Detect Laptop/HP): http://192.168.1.3:3000/
==============================================
```

---

## 📱 Panduan Penggunaan

1. **Host Dashboard (Laptop)**:
   - Buka browser laptop ke `http://192.168.1.3:3000/` (atau IP yang tertera di terminal).
   - Halaman akan menampilkan **QR Code**, status printer target aktif, dan tabel riwayat job secara real-time.
2. **Mobile Client (HP)**:
   - Buka kamera HP dan scan QR Code di layar laptop.
   - Browser HP akan membuka halaman upload dokumen.
   - Pilih file (PDF/Gambar/Pasfoto), atur opsi cetak, lalu tekan **🖨️ Print Sekarang**.
3. Dokumen akan langsung terkirim dan tercetak secara fisik pada printer host!

---

## ⚙️ Konfigurasi (`config.json`)

Anda dapat menyesuaikan pengaturan server pada file `config.json`:

```json
{
  "port": 3000,
  "maxFileSizeMB": 20,
  "allowedExtensions": [".pdf", ".jpg", ".jpeg", ".png", ".docx"],
  "autoDeleteMinutes": 10,
  "pin": {
    "enabled": false,
    "code": "1234"
  }
}
```

---

## 📄 Lisensi & Kontribusi

Project ini berlisensi MIT. Kontribusi dan masukan untuk pengembangan fitur lebih lanjut sangat disambut!
