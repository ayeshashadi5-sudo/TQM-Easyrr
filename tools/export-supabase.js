#!/usr/bin/env node
'use strict';
/* يولّد ملف SQL يحمّل بياناتك الحالية في جدول qmt_docs على Supabase
   node tools/export-supabase.js [مصدر JSON] [ملف الإخراج] */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const src = process.argv[2] || [path.join(root, 'data', 'data.json'), path.join(root, 'seed', 'current.json')].find(f => fs.existsSync(f));
const out = process.argv[3] || path.join(root, 'supabase', 'data.sql');
const D = JSON.parse(fs.readFileSync(src, 'utf8'));
if (Array.isArray(D.entries)) D.entries = Object.fromEntries(D.entries.map(e => [e.id, e]));
const COLS = ['users', 'programs', 'entries', 'history', 'ready', 'scrstat', 'releases', 'retests', 'assigns', 'settings'];
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const rows = [];
for (const c of COLS) for (const [id, d] of Object.entries(D[c] || {})) {
  const j = JSON.stringify(d); if (j.includes('$tqm$')) throw new Error('نص غير مدعوم في ' + c + '/' + id);
  rows.push(`(${q(c)}, ${q(id)}, $tqm$${j}$tqm$::jsonb)`);
}
const now = Date.now(); for (const c of COLS) rows.push(`('_ver', ${q(c)}, '{"v":${now}}'::jsonb)`);
const parts = ['-- بيانات TQM easy الحالية. شغّليه بعد setup.sql. يحوي كلمات سر، لا ترفعيه إلى GitHub.', 'begin;'];
for (let i = 0; i < rows.length; i += 40) parts.push('insert into public.qmt_docs (coll, id, data) values\n' + rows.slice(i, i + 40).join(',\n') + '\non conflict (coll, id) do update set data = excluded.data, updated_at = now();');
parts.push('commit;');
fs.writeFileSync(out, parts.join('\n') + '\n'); console.log('written', out, rows.length, 'docs', fs.statSync(out).size, 'bytes');
