'use strict';
/* TQM easy · خادم Node بلا اعتماديات (Node 18+). المنطق في core/core.mjs
   - تخزين: ملف JSON واحد في DATA_DIR مع نسخ احتياطية يومية
   - دخول: الاسم + كلمة سر من 4 أرقام، جلسة بكوكي HttpOnly */
const http = require('http'), fs = require('fs'), path = require('path');
const PORT = +process.env.PORT || 3000;
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'data.json'), PUB = path.join(__dirname, 'public');
const SECURE = process.env.COOKIE_SECURE === '1', TRUST = process.env.TRUST_PROXY === '1';
const COLS = ['users', 'programs', 'entries', 'history', 'ready', 'scrstat', 'releases', 'retests', 'assigns', 'settings'];

fs.mkdirSync(path.join(DIR, 'backups'), { recursive: true });
let D = {};
try { D = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { D = {}; }
for (const c of [...COLS, 'sessions', 'attempts']) D[c] = D[c] || {};
if (!Object.keys(D.users).length) {
  try {
    const cur = path.join(__dirname, 'seed', 'current.json');
    if (fs.existsSync(cur)) { const s = JSON.parse(fs.readFileSync(cur, 'utf8')); for (const c of COLS) D[c] = s[c] || {}; }
    else {
      const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'seed.json'), 'utf8'));
      D.users = s.users; D.programs = s.programs; D.entries = Object.fromEntries(s.entries.map(e => [e.id, e]));
    }
    console.log('تم تحميل البيانات الأولية');
  } catch (e) { console.error('لا توجد بيانات أولية:', e.message); }
}
let timer = null, lastBackup = '';
function flush() {
  clearTimeout(timer); timer = null;
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(D));
  if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak');
  fs.renameSync(tmp, FILE);
  const day = new Date().toISOString().slice(0, 10);
  if (day !== lastBackup) {
    lastBackup = day; fs.copyFileSync(FILE, path.join(DIR, 'backups', `data-${day}.json`));
    const f = fs.readdirSync(path.join(DIR, 'backups')).sort(); f.slice(0, -30).forEach(n => fs.unlinkSync(path.join(DIR, 'backups', n)));
  }
}
const save = () => { if (!timer) timer = setTimeout(flush, 250); };
flush();
['SIGINT', 'SIGTERM'].forEach(s => process.on(s, () => { flush(); process.exit(0); }));

const ver = {}, clients = new Set();
const broadcast = c => { const m = `data: ${JSON.stringify({ c })}\n\n`; clients.forEach(r => { try { r.write(m); } catch (e) { clients.delete(r); } }); };
const fileStore = {
  async loadAll() { return D; }, async loadColl(c) { return D[c] || {}; },
  async get(c, id) { return (D[c] || {})[id]; },
  async put(c, id, d) { (D[c] = D[c] || {})[id] = d; save(); },
  async del(c, id) { if (D[c]) delete D[c][id]; save(); },
  async bump(c) { ver[c] = (ver[c] || 0) + 1; }, async getVer() { return ver; }
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'" };

let app;
const ready = import('./core/core.mjs').then(m => {
  app = m.makeApp(fileStore, {
    onWrite: broadcast,
    cookie: (req, tok, age) => `sid=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${SECURE || (TRUST && req.headers.get('x-forwarded-proto') === 'https') ? '; Secure' : ''}`
  });
});
const ipOf = req => (TRUST && req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

const server = http.createServer(async (req, res) => {
  try {
    await ready;
    const url = new URL(req.url, 'http://x'), p = url.pathname;
    if (p === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{"ok":true}'); }
    if (p === '/api/stream') {
      const t = (req.headers.cookie || '').match(/sid=([^;]+)/);
      const s = t && D.sessions[t[1]];
      if (!s || s.exp < Date.now()) { res.writeHead(401); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n'); clients.add(res); const k = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(k); clients.delete(res); }); return;
    }
    if (p.startsWith('/api/')) {
      const chunks = []; if (!['GET', 'HEAD'].includes(req.method)) for await (const c of req) { chunks.push(c); if (Buffer.concat(chunks).length > 1e6) throw new Error('كبير'); }
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(',') : v);
      const r = await app(new Request('http://x' + req.url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
      const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
      res.writeHead(r.status, out); return res.end(Buffer.from(await r.arrayBuffer()));
    }
    let f = path.join(PUB, p === '/' ? 'index.html' : path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ...SEC });
    fs.createReadStream(f).pipe(res);
  } catch (e) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message || 'خطأ' })); }
});
if (require.main === module) server.listen(PORT, () => {
  const ips = Object.values(require('os').networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log('\nTQM easy يعمل الآن. اترك هذه النافذة مفتوحة.\n  على هذا الجهاز:        http://localhost:' + PORT);
  ips.forEach(ip => console.log('  لباقي أجهزة الشبكة:    http://' + ip + ':' + PORT));
  console.log('');
});
module.exports = { server };
