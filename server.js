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
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: true, legacyHeaders: false }));

function isThreadsHost(hostname) {
  return ['threads.net', 'threads.com'].includes(hostname.toLowerCase().replace(/^www\./, ''));
}
function isSupportedPostPath(pathname) {
  return /^\/@[^/]+\/post\/[A-Za-z0-9_-]+\/?$/.test(pathname)
    || /^\/t\/[A-Za-z0-9_-]+\/?$/.test(pathname);
}
function validateThreadsUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { throw new Error('Masukkan tautan Threads yang valid.'); }
  if (!isThreadsHost(u.hostname)) throw new Error('Hanya tautan threads.net atau threads.com yang diterima.');
  if (u.protocol !== 'https:') throw new Error('Tautan harus menggunakan HTTPS.');
  const isShareLink = /^\/share\/[A-Za-z0-9_-]+\/?$/.test(u.pathname);
  if (!isSupportedPostPath(u.pathname) && !isShareLink) throw new Error('Format tautan tidak dikenali. Gunakan tautan postingan Threads atau tautan Bagikan (/share/).');
  return u.toString();
}
async function resolveShareUrl(rawUrl) {
  const original = new URL(rawUrl);
  if (!/^\/share\//.test(original.pathname)) return rawUrl;
  try {
    const response = await fetch(rawUrl, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36' }, signal: AbortSignal.timeout(12000) });
    const finalUrl = new URL(response.url);
    if (isThreadsHost(finalUrl.hostname) && isSupportedPostPath(finalUrl.pathname)) return finalUrl.toString();
    const html = await response.text();
    const candidates = [html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1], html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1]].filter(Boolean);
    for (const candidate of candidates) {
      try { const u = new URL(candidate, finalUrl); if (u.protocol === 'https:' && isThreadsHost(u.hostname) && isSupportedPostPath(u.pathname)) return u.toString(); } catch {}
    }
  } catch (err) { console.warn('Tidak dapat mengubah tautan share menjadi tautan postingan:', err.message); }
  return rawUrl;
}
function runYtDlpJson(url) {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', ['-m','yt_dlp','--dump-single-json','--skip-download','--no-warnings','--no-playlist','--socket-timeout','20','--retries','1',url], { stdio:['ignore','pipe','pipe'], env:{...process.env,PYTHONUNBUFFERED:'1'} });
    let stdout='',stderr='';
    const timer=setTimeout(()=>child.kill('SIGKILL'),60000);
    child.stdout.on('data',d=>{stdout+=d.toString();if(stdout.length>5*1024*1024)child.kill('SIGKILL');});
    child.stderr.on('data',d=>stderr+=d.toString());
    child.on('error',()=>{clearTimeout(timer);reject(new Error('Mesin preview belum tersedia.'));});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error(stderr.split('\n').filter(Boolean).slice(-2).join(' ')||'Informasi video tidak dapat dibaca. Pastikan postingan publik dan didukung extractor.'));try{resolve(JSON.parse(stdout));}catch{reject(new Error('Data preview video tidak valid.'));}});
  });
}
function formatForQuality(quality) {
  if (quality === '720') return 'best[height<=720][ext=mp4]/best[height<=720]/best[ext=mp4]/best';
  if (quality === '480') return 'best[height<=480][ext=mp4]/best[height<=480]/best[ext=mp4]/best';
  return 'best[ext=mp4]/best';
}
function runYtDlp(url, outDir, quality) {
  return new Promise((resolve, reject) => {
    const args=['-m','yt_dlp','--no-warnings','--no-playlist','--no-part','--socket-timeout','20','--retries','1','--max-filesize',String(MAX_BYTES),'-f',formatForQuality(quality),'-o',path.join(outDir,'%(id)s.%(ext)s'),'--print','after_move:filepath',url];
    const child=spawn('python3',args,{stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONUNBUFFERED:'1'}});
    let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGKILL'),180000);
    child.stdout.on('data',d=>stdout+=d.toString());child.stderr.on('data',d=>stderr+=d.toString());
    child.on('error',()=>{clearTimeout(timer);reject(new Error('Mesin downloader belum terpasang.'));});
    child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error(stderr.split('\n').filter(Boolean).slice(-3).join(' ')||'Video tidak dapat diekstrak.'));const file=stdout.split('\n').map(s=>s.trim()).filter(Boolean).pop();if(!file||!path.resolve(file).startsWith(path.resolve(outDir)+path.sep)||!fs.existsSync(file))return reject(new Error('Video tidak ditemukan setelah proses ekstraksi.'));if(fs.statSync(file).size>MAX_BYTES)return reject(new Error('Ukuran video melebihi batas 200 MB.'));resolve(file);});
  });
}
app.get('/api/health',(_req,res)=>res.json({ok:true,extractor:'yt-dlp',shareLinks:true,qualityOptions:['best','720','480'],preview:true,downloadProgress:true}));
app.post('/api/preview',async(req,res)=>{
 let url;try{url=validateThreadsUrl(req.body?.url);}catch(e){return res.status(400).json({error:e.message});}
 try{
  const info=await runYtDlpJson(await resolveShareUrl(url));
  const heights=[...new Set((info.formats||[]).map(f=>f.height).filter(h=>Number.isFinite(h)))].sort((a,b)=>b-a);
  res.json({ok:true,title:info.title||'Video Threads',thumbnail:info.thumbnail||info.thumbnails?.slice(-1)[0]?.url||null,duration:info.duration||null,uploader:info.uploader||info.channel||null,availableHeights:heights.slice(0,8),webpageUrl:info.webpage_url||url});
 }catch(e){res.status(422).json({error:e.message||'Preview tidak tersedia.'});}
});
app.post('/api/download',async(req,res)=>{
 let url;try{url=validateThreadsUrl(req.body?.url);}catch(e){return res.status(400).json({error:e.message});}
 const quality=['best','720','480'].includes(req.body?.quality)?req.body.quality:'best';
 const workDir=path.join(os.tmpdir(),`threads-dl-${crypto.randomUUID()}`);fs.mkdirSync(workDir,{recursive:true,mode:0o700});
 try{
  const file=await runYtDlp(await resolveShareUrl(url),workDir,quality);
  const name=`threads-${path.basename(file).replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  res.download(file,name,err=>{fs.rm(workDir,{recursive:true,force:true},()=>{});if(err&&!res.headersSent)res.status(500).json({error:'Gagal mengirim file hasil unduhan.'});});
 }catch(e){fs.rm(workDir,{recursive:true,force:true},()=>{});res.status(422).json({error:e.message||'Download gagal.'});}
});
app.listen(PORT,'0.0.0.0',()=>console.log(`Threads Downloader berjalan di port ${PORT}`));
