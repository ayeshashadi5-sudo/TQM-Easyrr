#!/usr/bin/env node
'use strict';
/* يولّد supabase/functions/qmt/index.ts من core/core.mjs (نفس المنطق المختبَر) */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'core', 'core.mjs'), 'utf8').replace(/^export /gm, '');
const out = `// @ts-nocheck
// TQM easy · دالة Supabase Edge: دخول + صلاحيات + قراءة/كتابة جدول qmt_docs.
// ملف مُولَّد تلقائيًا من core/core.mjs (node tools/build-edge.js). الصقيه كما هو في Supabase.
${core}
const store = pgStore({ url: Deno.env.get('SUPABASE_URL'), key: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') });
Deno.serve(makeApp(store));
`;
const dst = path.join(root, 'supabase', 'functions', 'qmt', 'index.ts');
fs.writeFileSync(dst, out); console.log('written', dst, out.length);
