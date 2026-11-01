'use strict';
/* يختبر محول Supabase (pgStore) والمنطق المشترك مقابل خادم PostgREST وهمي */
const assert = require('assert'), http = require('http');
(async () => {
  const { makeApp, pgStore, COLS } = await import('./core/core.mjs');
  const fx = require('./test/fixture.json');
  const T = new Map(); // "coll\u0000id" -> data
  for (const [c, m] of Object.entries({ users: fx.users, programs: fx.programs, entries: Object.fromEntries(fx.entries.map(e => [e.id, e])) })) for (const [id, d] of Object.entries(m)) T.set(c + '\0' + id, d);
  for (let i = 0; i < 2300; i++) T.set('history\0h' + i, { at: i, f: 'x', pid: 'apar' }); // اختبار التقسيم لصفحات
  let calls = 0;
  const srv = http.createServer((req, res) => {
    calls++;
    const u = new URL(req.url, 'http://x'); let body = ''; req.on('data', c => body += c); req.on('end', () => {
      const q = u.searchParams, flt = k => { const v = q.get(k); if (!v) return null; const [op, ...r] = v.split('.'); const val = r.join('.'); return op === 'in' ? new Set(val.slice(1, -1).split(',')) : new Set([val]); };
      if (req.headers.apikey !== 'KEY') { res.writeHead(401); return res.end('{}'); }
      if (req.method === 'GET') {
        const fc = flt('coll'), fi = flt('id'); let rows = [...T].map(([k, data]) => { const [coll, id] = k.split('\0'); return { coll, id, data }; }).filter(r => (!fc || fc.has(r.coll)) && (!fi || fi.has(r.id)));
        const [a, b] = (req.headers.range || '0-99999').split('-').map(Number); rows = rows.slice(a, b + 1);
        res.writeHead(rows.length ? 206 : 200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(rows));
      }
      if (req.method === 'POST') { for (const r of JSON.parse(body)) T.set(r.coll + '\0' + r.id, r.data); res.writeHead(201); return res.end(); }
      if (req.method === 'DELETE') { T.delete(q.get('coll').slice(3) + '\0' + q.get('id').slice(3)); res.writeHead(204); return res.end(); }
      res.writeHead(405); res.end();
    });
  });
  await new Promise(r => srv.listen(0, r)); const url = 'http://127.0.0.1:' + srv.address().port;
  const store = pgStore({ url, key: 'KEY' }), app = makeApp(store);
  const call = async (tok, m, p, b) => { const r = await app(new Request('https://f.example/functions/v1/qmt' + p, { method: m, headers: { 'content-type': 'application/json', 'x-requested-with': 'qmt', ...(tok ? { 'x-qmt-token': tok } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) })); return { s: r.status, j: await r.json().catch(() => ({})) }; };
  const pin = n => Object.values(fx.users).find(u => u.name === n).pin, uid = n => Object.entries(fx.users).find(([k, u]) => u.name === n)[0];
  const login = async n => { const r = await call(null, 'POST', '/api/login', { name: n, pin: pin(n) }); assert.equal(r.s, 200); assert(r.j.token); return r.j.token; };
  let ok = 0; const t = n => { ok++; console.log('✓', n); };
  assert.equal((await call(null, 'GET', '/api/me')).j.id, undefined); t('بدون جلسة');
  assert.equal((await call(null, 'POST', '/api/login', { name: 'عائشة', pin: '0000' })).s, 401); t('كلمة سر خاطئة');
  const A = await login('عائشة'), DEV = await login('عصام'), TST = await login('حامد');
  assert.equal((await call(A, 'GET', '/api/me')).j.name, 'عائشة'); t('الجلسة محفوظة في القاعدة');
  const all = (await call(A, 'GET', '/api/all?c=users,entries,history')).j; assert.equal(all.entries.length, fx.entries.length); assert.equal(all.history.length, 2300); t('تحميل دفعة واحدة وتقسيم الصفحات (2300 صف)');
  assert(all.users.every(x => x.data.pin)); assert((await call(DEV, 'GET', '/api/c/users')).j.every(x => !('pin' in x.data))); t('كلمات السر للأدمن فقط');
  const body = { pid: 'apar', menu: 'اذن قبض', screen: 'قبض خزينة', desc: 'من Supabase', sev: 'وسط', type: 'وظيفي', req: true };
  assert.equal((await call(DEV, 'POST', '/api/c/entries', body)).s, 403); t('المطور لا يضيف');
  const r1 = await call(TST, 'POST', '/api/c/entries', body); assert.equal(r1.s, 200); assert(T.has('entries\0' + r1.j.id)); t('المختبر يضيف ويُخزَّن في القاعدة');
  assert.equal((await call(A, 'PATCH', '/api/c/users/' + uid('حامد'), { as: true })).s, 200);
  assert.equal((await call(TST, 'PATCH', '/api/c/entries/' + r1.j.id, { dev: uid('عصام'), orig: uid('عصام'), status: 'مسند' })).s, 200);
  assert.equal((await call(DEV, 'PATCH', '/api/c/entries/' + r1.j.id, { status: 'مغلق' })).s, 403); t('قواعد الحالة تعمل');
  assert.equal(T.get('entries\0' + r1.j.id).status, 'مسند'); t('الرفض لا يغيّر القاعدة');
  const v = (await call(A, 'GET', '/api/v')).j; assert(v.entries > 0 && v.users > 0); t('عدّاد الإصدارات للتحديث التلقائي');
  for (let i = 0; i < 6; i++) await call(null, 'POST', '/api/login', { name: 'وليد', pin: '0000' });
  assert.equal((await call(null, 'POST', '/api/login', { name: 'وليد', pin: pin('وليد') })).s, 429); t('تقييد المحاولات محفوظ في القاعدة');
  const pre = await app(new Request('https://f.example/functions/v1/qmt/api/login', { method: 'OPTIONS' })); assert.equal(pre.status, 204); assert(pre.headers.get('access-control-allow-origin')); t('CORS preflight');
  assert.equal((await call(A, 'POST', '/api/logout')).s, 200); assert.equal((await call(A, 'GET', '/api/c/users')).s, 401); t('تسجيل الخروج يحذف الجلسة');
  console.log('\nكل اختبارات Supabase نجحت:', ok, '| طلبات القاعدة:', calls); srv.close(); process.exit(0);
})().catch(e => { console.error('✗ فشل:', e.message, e.stack.split('\n')[1]); process.exit(1); });
