# Threads Video Downloader (Web)

Web app sederhana untuk mengunduh video dari postingan Threads publik **jika extractor yang terpasang dapat mengakses postingan tersebut**. Ini bukan layanan resmi Meta dan tidak menjamin semua tautan akan berhasil.

## Menjalankan dengan Docker (disarankan)

Persyaratan: Docker Desktop atau Docker Engine.

```bash
docker build -t threads-video-downloader .
docker run --rm -p 3000:3000 --name threads-downloader threads-video-downloader
```

Buka `http://localhost:3000` di browser. Untuk akses dari HP pada jaringan Wi-Fi yang sama, buka `http://IP-KOMPUTER:3000`.

## Menjalankan tanpa Docker

Persyaratan: Node.js 20+, Python 3.10+, pip, FFmpeg, dan Git.

```bash
npm install
python -m pip install -U yt-dlp
python -m pip install 'git+https://github.com/tribixbite/yt-dlp-threads'
npm start
```

Buka `http://localhost:3000`.

## Deploy ke hosting

Deploy sebagai aplikasi Docker/container yang mendukung proses Python, FFmpeg, dan penyimpanan sementara. Set port ke `3000` atau gunakan environment variable `PORT` yang diberikan platform. Jangan deploy sebagai static hosting saja karena proses ekstraksi berjalan di backend.

## Batasan dan keamanan

- Hanya menerima URL `threads.com` atau `threads.net` dengan pola tautan postingan.
- Tidak mendukung akun privat, login/cookie pengguna, atau bypass pembatasan akses.
- Extractor Threads pihak ketiga bersifat eksperimental dan dapat rusak ketika Threads mengubah situsnya.
- Maksimum ukuran file 200 MB dan waktu proses 3 menit per permintaan.
- Endpoint dibatasi 5 permintaan per menit per alamat IP; hasil disimpan sementara lalu dihapus setelah dikirim.
- Gunakan hanya untuk video yang Anda miliki atau yang izinnya Anda peroleh, dan patuhi ketentuan layanan serta hak cipta.

## Troubleshooting

1. `Unsupported URL`: extractor Threads tidak mengenali tautan/versi situs saat ini.
2. `Login required` atau `no media found`: konten tidak dapat diakses secara publik oleh extractor.
3. `yt-dlp` tidak ditemukan: jalankan instalasi Python di atas dan pastikan `python3 -m yt_dlp --version` berhasil.
4. Perbarui extractor: `python -m pip install -U yt-dlp` lalu pasang ulang plugin Threads.
