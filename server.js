const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_BYTES = 200 * 1024 * 1024;
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false }));

function validateThreadsUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('Masukkan tautan Threads yang valid.'); }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (!['threads.net', 'threads.com'].includes(host)) throw new Error('Hanya tautan threads.net atau threads.com yang diterima.');
  if (u.protocol !== 'https:') throw new Error('Tautan harus menggunakan HTTPS.');
  if (!/^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/?$/.test(u.pathname) && !/^\/t\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)) {
    throw new Error('Format tautan postingan tidak dikenali. Salin tautan langsung dari postingan Threads.');
  }
  return u.toString();
}

function runYtDlp(url, outDir) {
  return new Promise((resolve, reject) => {
    const args = [
      '-m', 'yt_dlp', '--no-warnings', '--no-playlist', '--no-part',
      '--socket-timeout', '20', '--retries', '1', '--max-filesize', String(MAX_BYTES),
      '-f', 'best[ext=mp4]/best',
      '-o', path.join(outDir, '%(id)s.%(ext)s'),
      '--print', 'after_move:filepath', url
    ];
    const child = spawn('python3', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 180_000);
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', err => { clearTimeout(timer); reject(new Error('Mesin downloader belum terpasang. Periksa panduan instalasi.')); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        const msg = stderr.split('\n').filter(Boolean).slice(-3).join(' ');
        return reject(new Error(msg || 'Video tidak dapat diekstrak. Pastikan postingan publik dan extractor Threads mendukungnya.'));
      }
      const file = stdout.split('\n').map(s => s.trim()).filter(Boolean).pop();
      if (!file || !path.resolve(file).startsWith(path.resolve(outDir) + path.sep) || !fs.existsSync(file)) return reject(new Error('Video tidak ditemukan setelah proses ekstraksi.'));
      const stat = fs.statSync(file);
      if (stat.size > MAX_BYTES) return reject(new Error('Ukuran video melebihi batas 200 MB.'));
      resolve(file);
    });
  });
}

app.get('/api/health', (_req, res) => res.json({ ok: true, extractor: 'yt-dlp + optional Threads plugin' }));
app.post('/api/download', async (req, res) => {
  let url;
  try { url = validateThreadsUrl(req.body?.url); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  const workDir = path.join(os.tmpdir(), `threads-dl-${crypto.randomUUID()}`);
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  try {
    const file = await runYtDlp(url, workDir);
    const name = `threads-${path.basename(file).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    res.download(file, name, err => {
      fs.rm(workDir, { recursive: true, force: true }, () => {});
      if (err && !res.headersSent) res.status(500).json({ error: 'Gagal mengirim file hasil unduhan.' });
    });
  } catch (e) {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
    res.status(422).json({ error: e.message || 'Download gagal.' });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Threads Downloader berjalan di port ${PORT}`));
