'use strict';
/* يختبر شيم الواجهة (وضع GitHub Pages + Supabase) مقابل نفس المنطق، بدون متصفح */
const assert = require('assert'), http = require('http'), vm = require('vm'), fs = require('fs');
(async () => {
  const { makeApp } = await import('./core/core.mjs');
  const fx = require('./test/fixture.json');
  const D = { users: fx.users, programs: fx.programs, entries: Object.fromEntries(fx.entries.map(e => [e.id, e])), sessions: {}, attempts: {} };
  for (const c of ['history', 'ready', 'scrstat', 'releases', 'retests', 'assigns', 'settings']) D[c] = {};
  const ver = {};
  const store = { async loadAll() { return D; }, async loadColl(c) { return D[c] || {}; }, async get(c, i) { return (D[c] || {})[i]; }, async put(c, i, d) { (D[c] = D[c] || {})[i] = d; }, async del(c, i) { delete (D[c] || {})[i]; }, async bump(c) { ver[c] = (ver[c] || 0) + 1; }, async getVer() { return ver; } };
  const app = makeApp(store);
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    if (req.url.startsWith('/rest/v1/rpc/qmt_ver')) { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); return res.end(JSON.stringify(ver)); }
    const h = new Headers(); for (const [k, v] of Object.entries(req.headers)) h.set(k, v);
    const r = await app(new Request('http://x/functions/v1/qmt' + req.url.replace('/functions/v1/qmt', ''), { method: req.method, headers: h, body: chunks.length ? Buffer.concat(chunks) : undefined }));
    const o = {}; r.headers.forEach((v, k) => o[k] = v); res.writeHead(r.status, o); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise(r => srv.listen(0, r)); const base = 'http://127.0.0.1:' + srv.address().port;
  const html = fs.readFileSync('index.html', 'utf8'); const shim = html.match(/<script>(\n\(\(\)=>\{const C=[\s\S]*?)<\/script>/)[1];
  const store0 = {}; const win = { QMT: { api: base + '/functions/v1/qmt', url: base, anon: 'sb_publishable_x' }, addEventListener() { }, dispatchEvent() { } };
  win.dispatchEvent = e => { win.last = e.type; };
  const ctx = vm.createContext({ window: win, document: { hidden: false, addEventListener() { } }, localStorage: { getItem: k => store0[k] || null, setItem: (k, v) => store0[k] = v, removeItem: k => delete store0[k] }, fetch, Event: class { constructor(t) { this.type = t; } }, setInterval, clearInterval, setTimeout, JSON, Promise, encodeURIComponent, URL });
  vm.runInContext(shim, ctx); const DB = win.DB;
  const uid = n => Object.entries(fx.users).find(([k, u]) => u.name === n)[0], pin = n => Object.values(fx.users).find(u => u.name === n).pin;
  let ok = 0; const t = n => { ok++; console.log('✓', n); };
  assert.deepEqual(await DB.me(), {}); t('me بدون توكن');
  await assert.rejects(() => DB.login('عائشة', '0000'), /غير صحيحة/); t('رسالة خطأ الدخول تصل للواجهة');
  const j = await DB.login('عائشة', pin('عائشة')); assert(j.token && store0.qmt_tok === j.token); t('تسجيل الدخول وحفظ التوكن');
  assert.equal((await DB.me()).name, 'عائشة'); t('me بعد الدخول');
  const us = await DB.collection('users').get(); assert(us.docs.length > 5 && us.docs[0].data().pin); t('قراءة المستخدمين');
  let snaps = [], n = 0; DB.collection('entries').onSnapshot(s => { snaps.push(s.docs.length); n++; });
  await new Promise(r => setTimeout(r, 400)); assert.equal(snaps[0], fx.entries.length); t('onSnapshot يملأ البيانات');
  const body = { pid: 'apar', menu: 'اذن قبض', screen: 'قبض خزينة', desc: 'عبر الشيم', sev: 'وسط', type: 'وظيفي', req: true };
  const add = await DB.collection('entries').add(body); assert(add.id); t('إضافة ملاحظة');
  await new Promise(r => setTimeout(r, 6600)); assert(snaps[snaps.length - 1] === fx.entries.length + 1); t('التحديث التلقائي عبر qmt_ver (استطلاع)');
  await DB.doc('entries/' + add.id).update({ status: 'جاري العمل' }); assert.equal((await DB.doc('entries/' + add.id).get()).data().status, 'جاري العمل'); t('تحديث مستند');
  await DB.logout(); await DB.login('عصام', pin('عصام'));
  await assert.rejects(() => DB.doc('users/' + uid('عصام')).update({ role: 'admin' }), /للأدمن فقط/); t('الكتابة المرفوضة تظهر كخطأ للمستخدم');
  await DB.logout(); assert(!store0.qmt_tok); assert.deepEqual(await DB.me(), {}); t('تسجيل الخروج يمسح التوكن');
  DB.closeStream(); console.log('\nكل اختبارات الواجهة نجحت:', ok); srv.close(); process.exit(0);
})().catch(e => { console.error('✗ فشل:', e.message, e.stack.split('\n')[1]); process.exit(1); });
