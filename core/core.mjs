/* TQM easy: منطق الخادم المشترك (دخول، صلاحيات، قراءة وكتابة).
   يعمل كما هو في Node (server.js) وفي Supabase Edge Functions (Deno).
   لا تعدّل edge/index.ts مباشرة: يُولَّد من هذا الملف بـ  node tools/build-edge.js */
export const COLS = ['users', 'programs', 'entries', 'history', 'ready', 'scrstat', 'releases', 'retests', 'assigns', 'settings'];
const b64u = a => btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rnd = n => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
const nid = () => b64u(rnd(9)), newToken = () => b64u(rnd(24));
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const merge = (a, b) => { if (!isObj(a) || !isObj(b)) return b; const o = { ...a }; for (const k in b) o[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k]; return o; };
const norm = s => String(s || '').trim().replace(/^(م|د)(\/|\s)\s*/, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, '').toLowerCase();
const same = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

/* المنطق مرتبط بنسخة البيانات D الخاصة بكل طلب */
function makeLogic(D) {
/* ---------- الصلاحيات ---------- */
  const base = u => ((D.settings.main && D.settings.main.roles) || []).find(r => r.k === u.role)?.base || u.role;
  const isAdm = u => base(u) === 'admin', allp = u => isAdm(u) || base(u) === 'mgmt';
  const can = (u, k) => isAdm(u) || !!u[k] || (k === 'rt' && base(u) === 'tester');
  /* حصر الشاشات لكل مستخدم: u.sl = { programId: ['القائمة|الشاشة', ...] } (فارغ = الكل) */
  const okScr = (u, pid, m, x) => { if (allp(u)) return true; const l = u.sl && u.sl[pid]; return !l || !l.length || l.includes(m + '|' + x); };
  const scope = (u, pid) => {
    const p = D.programs[pid]; if (!p || (p.archived && !isAdm(u))) return null;
    if (allp(u) || (u.progs || []).includes(pid)) return 'full';
    if ((u.pv || []).includes(pid)) return 'stats';
    return Object.values(D.entries).some(e => e.pid === pid && e.dev === u.id) ? 'task' : null;
  };
  const prioNames = () => (D.settings.main && D.settings.main.prios || [{ n: 'خطير' }, { n: 'مرتفع' }, { n: 'وسط' }, { n: 'سريع' }, { n: 'بسيط' }]).map(x => x.n);
  
  function readColl(u, c) {
    const items = Object.entries(D[c]).map(([id, data]) => ({ id, data }));
    const sc = pid => scope(u, pid);
    switch (c) {
      case 'users': return items.map(x => ({ id: x.id, data: isAdm(u) ? x.data : (({ pin, ...r }) => r)(x.data) }));
      case 'settings': return items;
      case 'programs': return items.filter(x => sc(x.id)).map(x => sc(x.id) === 'full' ? x : { id: x.id, data: { ...x.data, login: undefined, menus: sc(x.id) === 'task' ? {} : x.data.menus } });
      case 'releases': return items.filter(x => sc(x.data.pid));
      case 'entries': return items.flatMap(x => {
        const s = sc(x.data.pid), e = x.data;
        if (s === 'full') return okScr(u, e.pid, e.menu, e.screen) ? [x] : [];
        if (s === 'stats') return okScr(u, e.pid, e.menu, e.screen) ? [{ id: x.id, data: { pid: e.pid, menu: e.menu, screen: e.screen, status: e.status, sev: e.sev, req: e.req, type: e.type, rel: e.rel, due: e.due, tgt: e.tgt, at: e.at, desc: '' } }] : [];
        if (s === 'task' && (e.dev === u.id || (e.orig === u.id && e.fup))) return [x];
        return [];
      });
      case 'ready': case 'scrstat': return items.filter(x => (sc(x.data.pid) === 'full' || sc(x.data.pid) === 'stats') && okScr(u, x.data.pid, x.data.menu, x.data.screen));
      case 'history': return items.filter(x => { if (!x.data.pid) return isAdm(u); if (sc(x.data.pid) !== 'full') return false; const e = x.data.eid && D.entries[x.data.eid]; return !e || okScr(u, e.pid, e.menu, e.screen); });
      case 'retests': case 'assigns': {
        return items.filter(x => { const e = D.entries[x.data.issue]; return e && ((sc(e.pid) === 'full' && okScr(u, e.pid, e.menu, e.screen)) || (sc(e.pid) === 'task' && (e.dev === u.id || e.orig === u.id))); });
      }
    }
    return [];
  }
  
  const ALL_ST = ['جديد', 'مسند', 'جاري العمل', 'جاهز لإعادة الاختبار', 'قيد إعادة الاختبار', 'مغلق', 'مؤجل'];
  function allowedStatuses(u, e) {
    if (isAdm(u)) return ALL_ST;
    const s = e.status, o = [s];
    if (e.dev === u.id) {
      if (['جديد', 'مسند', 'مؤجل'].includes(s)) o.push('جاري العمل');
      if (s === 'جاري العمل') o.push('جاهز لإعادة الاختبار', 'مؤجل');
      if (s === 'جاهز لإعادة الاختبار') o.push('جاري العمل');
    }
    if (can(u, 'rt') && (s === 'جاهز لإعادة الاختبار' || s === 'قيد إعادة الاختبار')) o.push('مغلق', 'جاري العمل', 'قيد إعادة الاختبار');
    if (s === 'مغلق' && can(u, 'ro')) o.push('جديد', 'جاري العمل');
    return [...new Set(o)];
  }
  const canOwn = (u, e) => isAdm(u) || can(u, 'as') || (e.dev === u.id && can(u, 'dl'));
  function entryUpdateError(u, old, nw) {
    if (isAdm(u)) return null;
    const sc = scope(u, old.pid); if (!sc) return 'غير مصرح';
    if (sc === 'full' && !okScr(u, old.pid, old.menu, old.screen)) return 'غير مصرح';
    const ch = [...new Set([...Object.keys(old), ...Object.keys(nw)])].filter(k => JSON.stringify(old[k]) !== JSON.stringify(nw[k]));
    if (sc !== 'full' && !(sc === 'task' && old.dev === u.id)) return 'غير مصرح';
    for (const k of ch) {
      if (['sev', 'due', 'tgt'].includes(k)) { if (!u.plan) return 'لا تملك صلاحية تحديد المواعيد والأولويات'; }
      else if (['dev', 'orig', 'fup'].includes(k)) { if (!canOwn(u, old)) return 'لا تملك صلاحية تغيير المسؤول'; }
      else if (k === 'status') {
        if (!allowedStatuses(u, old).includes(nw.status) && !(ch.includes('dev') && nw.status === 'مسند' && canOwn(u, old))) return 'انتقال الحالة غير مسموح لك';
      }
      else if (['rt', 'lt', 'lta'].includes(k)) { if (!can(u, 'rt')) return 'لا تملك صلاحية إعادة الاختبار'; }
      else if (k === 'rel') { if (!can(u, 'rl')) return 'غير مصرح'; }
      else return 'غير مصرح بتعديل ' + k;
    }
    return null;
  }
  function blocking(body) {
    return Object.values(D.entries).filter(e => e.pid === body.pid && e.menu === body.menu && e.screen === body.screen && (!body.rel || (e.rel || '') === body.rel) && e.req !== false && e.status !== 'مغلق');
  }
  
  /* يعيد رسالة خطأ أو يطبّق التعديل */
  function mutate(u, c, id, op, body) {
    const old = id ? D[c][id] : undefined;
    const E = m => ({ error: m });
    delete body.id;
    switch (c) {
      case 'users': {
        if (!isAdm(u)) return E('للأدمن فقط');
        if (op === 'delete') { if (id === u.id) return E('لا يمكنك حذف نفسك'); delete D.users[id]; return {}; }
        const nw = op === 'patch' ? merge(old || {}, body) : body;
        if (!nw.name || !/^\d{4}$/.test(String(nw.pin))) return E('الاسم وكلمة سر من 4 أرقام مطلوبان');
        nw.pin = String(nw.pin);
        if (Object.entries(D.users).some(([k, x]) => k !== id && norm(x.name) === norm(nw.name))) return E('الاسم موجود');
        if (old && old.role === 'admin' && (nw.role !== 'admin' || nw.off) && !Object.entries(D.users).some(([k, x]) => k !== id && x.role === 'admin' && !x.off)) return E('يجب بقاء أدمن واحد على الأقل');
        D.users[id] = nw; return {};
      }
      case 'programs': case 'settings': if (!isAdm(u)) return E('للأدمن فقط'); if (op === 'delete') return E('الحذف غير مسموح، استخدم الأرشفة'); D[c][id] = op === 'patch' ? merge(old || {}, body) : body; return {};
      case 'releases': {
        const nw = op === 'patch' ? merge(old || {}, body) : body;
        if (op === 'delete') return E('الحذف غير مسموح');
        if (!(isAdm(u) || (can(u, 'rl') && scope(u, nw.pid) === 'full'))) return E('لا تملك صلاحية إدارة الإصدارات');
        if (Object.entries(D.releases).some(([k, r]) => k !== id && r.pid === nw.pid && norm(r.name) === norm(nw.name))) return E('اسم الإصدار موجود في هذا البرنامج');
        D.releases[id] = nw; return {};
      }
      case 'entries': {
        if (op === 'delete') return E('الحذف غير مسموح');
        if (op === 'create') {
          const sc = scope(u, body.pid);
          if (!isAdm(u) && !(sc === 'full' && okScr(u, body.pid, body.menu, body.screen) && (base(u) === 'tester' || (body.of && can(u, 'ro'))))) return E('لا تملك صلاحية إضافة ملاحظات');
          if (!String(body.desc || '').trim() || !String(body.type || '').trim()) return E('الوصف والنوع إلزاميان');
          if (!prioNames().includes(body.sev)) return E('أولوية غير معروفة');
          if (body.dev && !can(u, 'as')) return E('لا تملك صلاحية الإسناد');
          body.by = u.id; body.at = Date.now(); body.status = body.dev ? 'مسند' : 'جديد'; body.desc = String(body.desc).slice(0, 4000);
          D.entries[id] = body; return {};
        }
        if (!old) return E('غير موجود');
        const nw = op === 'patch' ? merge(old, body) : body;
        const err = entryUpdateError(u, old, nw); if (err) return E(err);
        D.entries[id] = nw; return {};
      }
      case 'ready': {
        if (op === 'delete') return isAdm(u) ? (delete D.ready[id], {}) : E('للأدمن فقط');
        if (scope(u, body.pid) !== 'full' || !okScr(u, body.pid, body.menu, body.screen)) return E('غير مصرح');
        const d = body.decision;
        if (d === 'جاهزة') { if (!can(u, 'ap')) return E('لا تملك صلاحية الاعتماد'); if (blocking(body).length) return E('توجد ملاحظات إلزامية لم يعتمدها الاختبار'); }
        else if (d === 'باستثناء') { if (!can(u, 'ex')) return E('لا تملك صلاحية الاعتماد باستثناء'); if (!String(body.reason || '').trim()) return E('السبب إلزامي'); }
        else if (d === 'ملغاة') { if (!(can(u, 'ap') || can(u, 'ex') || can(u, 'rt') || base(u) === 'tester')) return E('غير مصرح'); }
        else return E('قرار غير معروف');
        body.by = u.id; body.at = Date.now(); D.ready[id] = body; return {};
      }
      case 'scrstat': {
        if (op === 'delete') return isAdm(u) ? (delete D.scrstat[id], {}) : E('للأدمن فقط');
        if (scope(u, body.pid) !== 'full' || !(isAdm(u) || base(u) === 'tester' || u.plan)) return E('غير مصرح');
        body.by = u.id; body.at = Date.now(); D.scrstat[id] = body; return {};
      }
      case 'retests': {
        const e = D.entries[body.issue]; if (op !== 'create' || !e) return E('غير مصرح');
        if (!can(u, 'rt') || !scope(u, e.pid)) return E('لا تملك صلاحية إعادة الاختبار');
        body.tester = u.id; body.at = Date.now(); body.pid = e.pid; D.retests[id] = body; return {};
      }
      case 'assigns': {
        const e = D.entries[body.issue]; if (op !== 'create' || !e) return E('غير مصرح');
        if (!(can(u, 'as') || can(u, 'dl')) || !scope(u, e.pid)) return E('لا تملك صلاحية الإسناد');
        body.by = u.id; body.at = Date.now(); body.pid = e.pid; D.assigns[id] = body; return {};
      }
      case 'history': {
        if (op !== 'create') return E('السجل لا يُعدّل');
        if (body.pid && !scope(u, body.pid)) return E('غير مصرح');
        body.by = u.id; body.at = Date.now(); D.history[id] = body;
        return {};
      }
    }
    return E('غير موجود');
  }
  
  
return { readColl, mutate };
}

const SESSION_MS = 30 * 864e5;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-requested-with, x-qmt-token', 'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-max-age': '86400' };

/* store: loadAll() loadColl(c) get(c,id) put(c,id,d) del(c,id) bump(c) getVer()
   opts.cookie(req, token, maxAgeSeconds) => نص Set-Cookie (للنسخة التي تعمل بالكوكي)  opts.onWrite(coll) */
export function makeApp(store, opts = {}) {
  const json = (code, obj, hdr = {}) => new Response(JSON.stringify(obj), { status: code, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS, ...hdr } });
  const cookieOf = req => Object.fromEntries((req.headers.get('cookie') || '').split(';').map(x => x.trim().split('=')).filter(x => x[0]).map(x => [x[0], x.slice(1).join('=')]));
  const tokOf = req => req.headers.get('x-qmt-token') || cookieOf(req).sid || '';
  async function sessUser(req) {
    const t = tokOf(req); if (!t) return null;
    const s = await store.get('sessions', t); if (!s || s.exp < Date.now()) return null;
    const x = await store.get('users', s.uid); if (!x || x.off) return null;
    return { id: s.uid, ...x };
  }
  return async function handle(req) {
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      const url = new URL(req.url), i = url.pathname.indexOf('/api/'), p = i < 0 ? '' : url.pathname.slice(i);
      if (p === '/api/health') return json(200, { ok: true });
      if (!p) return json(404, { error: 'غير موجود' });
      if (req.method !== 'GET' && req.headers.get('x-requested-with') !== 'qmt') return json(403, { error: 'طلب مرفوض' });
      if (p === '/api/login' && req.method === 'POST') {
        const b = await req.json().catch(() => ({})), key = norm(b.name) || '_';
        const t = (await store.get('attempts', key)) || { n: 0, until: 0 };
        if (Date.now() < t.until) return json(429, { error: 'محاولات كثيرة، حاول بعد 10 دقائق' });
        const users = await store.loadColl('users');
        const f = Object.entries(users).find(([k, x]) => norm(x.name) === norm(b.name) && !x.off);
        if (!f || !same(f[1].pin, b.pin)) {
          t.n++; if (t.n >= 5) { t.until = Date.now() + 6e5; t.n = 0; } await store.put('attempts', key, t);
          return json(401, { error: 'الاسم أو كلمة السر غير صحيحة، أو الحساب معطل' });
        }
        if (t.n || t.until) await store.del('attempts', key);
        const tok = newToken();
        await store.put('sessions', tok, { uid: f[0], exp: Date.now() + SESSION_MS });
        const hdr = opts.cookie ? { 'set-cookie': opts.cookie(req, tok, SESSION_MS / 1000) } : {};
        return json(200, { id: f[0], name: f[1].name, role: f[1].role, token: tok }, hdr);
      }
      if (p === '/api/logout' && req.method === 'POST') {
        const t = tokOf(req); if (t) await store.del('sessions', t);
        return json(200, { ok: true }, opts.cookie ? { 'set-cookie': opts.cookie(req, '', 0) } : {});
      }
      const u = await sessUser(req);
      if (p === '/api/me') return json(200, u ? { id: u.id, name: u.name, role: u.role } : {});
      if (!u) return json(401, { error: 'يلزم تسجيل الدخول' });
      if (p === '/api/v') return json(200, await store.getVer());
      if (p === '/api/all' && req.method === 'GET') {
        const want = (url.searchParams.get('c') || COLS.join(',')).split(',').filter(c => COLS.includes(c));
        const D = await store.loadAll(), L = makeLogic(D), out = {};
        for (const c of want) out[c] = L.readColl(u, c);
        return json(200, out);
      }
      const m = p.match(/^\/api\/c\/([a-z]+)(?:\/(.+))?$/);
      if (m && COLS.includes(m[1])) {
        const c = m[1], id = m[2] && decodeURIComponent(m[2]);
        const D = await store.loadAll(), L = makeLogic(D);
        if (req.method === 'GET' && !id) return json(200, L.readColl(u, c));
        if (req.method === 'GET') { const d = L.readColl(u, c).find(x => x.id === id); return d ? json(200, d.data) : json(404, { error: 'غير موجود' }); }
        const raw = await req.json().catch(() => ({})), body = isObj(raw) ? raw : {};
        const op = { POST: 'create', PUT: 'set', PATCH: 'patch', DELETE: 'delete' }[req.method];
        if (!op) return json(405, { error: 'غير مدعوم' });
        const nidv = op === 'create' ? nid() : id;
        if (!nidv) return json(400, { error: 'معرّف مطلوب' });
        const r = L.mutate(u, c, nidv, op, body);
        if (r.error) return json(403, { error: r.error });
        const d = D[c][nidv];
        if (d === undefined) await store.del(c, nidv); else await store.put(c, nidv, d);
        await store.bump(c); if (opts.onWrite) opts.onWrite(c);
        return json(200, { id: nidv });
      }
      return json(404, { error: 'غير موجود' });
    } catch (e) { return json(400, { error: e.message || 'خطأ' }); }
  };
}

/* تخزين Supabase (PostgREST) في جدول qmt_docs(coll,id,data) */
export function pgStore({ url, key, fetchFn }) {
  const f = fetchFn || fetch, H = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, T = url + '/rest/v1/qmt_docs';
  const fail = async (r, w) => { throw new Error(w + ' ' + r.status + ' ' + (await r.text()).slice(0, 200)); };
  async function page(q) {
    const out = [];
    for (let o = 0; ; o += 1000) {
      const r = await f(T + '?' + q, { headers: { ...H, 'Range-Unit': 'items', Range: o + '-' + (o + 999) } });
      if (!r.ok) await fail(r, 'db read');
      const a = await r.json(); out.push(...a); if (a.length < 1000) break;
    }
    return out;
  }
  const toMap = rows => { const m = {}; for (const r of rows) (m[r.coll] = m[r.coll] || {})[r.id] = r.data; return m; };
  const enc = encodeURIComponent;
  return {
    async loadAll() { const m = toMap(await page('select=coll,id,data&coll=in.(' + COLS.join(',') + ')')); for (const c of COLS) m[c] = m[c] || {}; return m; },
    async loadColl(c) { return toMap(await page('select=coll,id,data&coll=eq.' + c))[c] || {}; },
    async get(c, id) { const r = await f(T + '?select=data&coll=eq.' + c + '&id=eq.' + enc(id), { headers: H }); if (!r.ok) await fail(r, 'db get'); const a = await r.json(); return a[0] && a[0].data; },
    async put(c, id, d) { const r = await f(T + '?on_conflict=coll,id', { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ coll: c, id, data: d }]) }); if (!r.ok) await fail(r, 'db put'); },
    async del(c, id) { const r = await f(T + '?coll=eq.' + c + '&id=eq.' + enc(id), { method: 'DELETE', headers: H }); if (!r.ok) await fail(r, 'db del'); },
    async bump(c) { await this.put('_ver', c, { v: Date.now() }); },
    async getVer() { const m = await this.loadColl('_ver'); return Object.fromEntries(Object.entries(m).map(([k, x]) => [k, x.v])); }
  };
}
