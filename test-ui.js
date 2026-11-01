/* اختبار المتصفح (اختياري): npm i -D playwright && npx playwright install chromium && node test-ui.js */
let pw; try { pw = require('playwright'); } catch (e) { pw = require(process.env.PLAYWRIGHT_PATH || 'playwright'); }
const { chromium } = pw;
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-'));
const fx = require('./test/fixture.json');
fs.writeFileSync(path.join(process.env.DATA_DIR, 'data.json'), JSON.stringify({ users: fx.users, programs: fx.programs, entries: Object.fromEntries(fx.entries.map(e => [e.id, e])) }));
const { server } = require('./server.js');
const pin = n => Object.values(fx.users).find(u => u.name === n).pin, uid = n => Object.entries(fx.users).find(([k, u]) => u.name === n)[0];
const ok = []; const t = n => { ok.push(n); console.log('✓', n); };
async function login(pg, n) { await pg.goto('http://127.0.0.1:3922/'); await pg.fill('#ln', n); await pg.fill('#lp', pin(n)); await pg.click('[data-a=login]'); await pg.waitForSelector('aside'); }
async function toScreens(pg) { await pg.click('.pcard >> nth=0'); await pg.waitForTimeout(300); await pg.click('[data-a=tab][data-t=s]'); await pg.waitForTimeout(300); }
(async () => {
  await new Promise(r => server.listen(3922, r));
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await login(pg, 'عائشة');
  // ---- collapsible sidebar (desktop)
  const w0 = (await pg.$eval('aside', e => e.getBoundingClientRect().width)); assert(w0 > 200);
  await pg.click('[data-a=sb]'); await pg.waitForTimeout(500);
  const w1 = await pg.$eval('aside', e => e.getBoundingClientRect().width); assert(w1 < 100, 'collapsed width ' + w1);
  assert.equal(await pg.$eval('aside .nb .nl', e => getComputedStyle(e).display), 'none'); assert(await pg.$eval('aside .nb', e => e.title)); t(`طي القائمة الجانبية (${Math.round(w0)}px → ${Math.round(w1)}px) مع تلميحات`);
  await pg.click('.nb >> nth=0'); await pg.waitForTimeout(400); assert(await pg.$('.app.sbc')); t('الطي يبقى بعد التنقل والرسم من جديد');
  await pg.reload(); await pg.waitForSelector('aside'); assert(await pg.$('.app.sbc')); t('الطي يُحفظ بعد إعادة تحميل الصفحة');
  await pg.click('[data-a=sb]'); await pg.waitForTimeout(500); assert((await pg.$eval('aside', e => e.getBoundingClientRect().width)) > 200); t('إعادة الفتح');
  // ---- drafts survive navigation
  await toScreens(pg); await pg.click('.sc >> nth=0'); await pg.waitForSelector('#d');
  await pg.fill('#d', 'مسودة محفوظة'); await pg.selectOption('#ty', { index: 1 });
  await pg.click('h1'); await pg.waitForTimeout(500); assert.equal(await pg.inputValue('#d'), 'مسودة محفوظة'); t('الضغط خارج الحقل لا يمسح');
  await pg.click('[data-a=back]'); await pg.waitForTimeout(300); await pg.click('.sc >> nth=1'); await pg.waitForSelector('#d'); assert.equal(await pg.inputValue('#d'), ''); t('شاشة أخرى بمسودة منفصلة (لا تنتقل النصوص بين الشاشات)');
  await pg.click('[data-a=back]'); await pg.waitForTimeout(300); await pg.click('.sc >> nth=0'); await pg.waitForSelector('#d');
  assert.equal(await pg.inputValue('#d'), 'مسودة محفوظة'); assert((await pg.inputValue('#ty')) !== ''); t('العودة للشاشة تعيد المسودة كاملة');
  await pg.reload(); await pg.waitForSelector('aside'); await toScreens(pg); await pg.click('.sc >> nth=0'); await pg.waitForSelector('#d'); assert.equal(await pg.inputValue('#d'), 'مسودة محفوظة'); t('المسودة تبقى حتى بعد إعادة تحميل الصفحة');
  await pg.click('[data-a=dclr]'); await pg.waitForTimeout(400); assert.equal(await pg.inputValue('#d'), ''); t('زر مسح الحقول');
  await pg.fill('#d', 'للإضافة'); await pg.selectOption('#ty', { index: 1 }); await pg.click('[data-a=ins]'); await pg.waitForTimeout(1200); assert.equal(await pg.inputValue('#d'), ''); t('الإضافة تفرّغ الحقول');
  await pg.click('[data-a=back]'); await pg.click('.sc >> nth=0'); await pg.waitForSelector('#d'); assert.equal(await pg.inputValue('#d'), ''); t('لا مسودة قديمة بعد الإضافة');
  // ---- screen visibility per person (program settings)
  await pg.click('[data-a=back]'); await pg.click('[data-a=tab][data-t=c]'); await pg.waitForTimeout(400);
  const btn = `[data-a=slm][data-u="${uid('عصام')}"]`; assert(await pg.$(btn), 'access card row'); t('قسم «الأفراد وظهور الشاشات» في إعدادات البرنامج');
  await pg.click(btn); await pg.waitForSelector('[data-sk]'); const nAll = await pg.$$eval('[data-sk]', e => e.length); await pg.check('[data-sk] >> nth=0'); await pg.click('[data-sx=ok]'); await pg.waitForTimeout(800);
  assert((await pg.textContent('#root')).includes(`1 من`)); t(`تحديد شاشة واحدة من ${nAll} لعصام`);
  const p2 = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); await login(p2, 'عصام'); await toScreens(p2);
  const tiles = await p2.$$eval('.sc', e => e.length); assert.equal(tiles, 1, 'tiles ' + tiles); t('عصام يرى شاشة واحدة فقط بعد الحصر');
  const ents = await p2.evaluate(async () => (await (await fetch('/api/c/entries', { headers: { 'X-Requested-With': 'qmt' } })).json()).filter(e => e.data.pid === 'apar').map(e => e.data.screen)); assert(new Set(ents).size === 1); t('والخادم لا يرسل ملاحظات الشاشات الأخرى أصلًا');
  // ---- mobile drawer
  const m = await (await b.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true })).newPage(); await login(m, 'عائشة');
  const x0 = await m.$eval('aside', e => e.getBoundingClientRect().left); assert(x0 >= 380 || x0 < -200 || x0 > 300, 'drawer hidden x=' + x0); t('الجوال: القائمة مخفية افتراضيًا');
  await m.click('[data-a=sb]'); await m.waitForTimeout(500); const r1 = await m.$eval('aside', e => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }); assert(r1[1] <= 391 && r1[0] >= 0, 'open ' + r1); t('الجوال: فتح القائمة كدرج جانبي');
  await m.click('aside .nb >> nth=1'); await m.waitForTimeout(500); const r2 = await m.$eval('aside', e => e.getBoundingClientRect().left); assert(r2 > 300, 'closed after nav ' + r2); t('الجوال: تُغلق تلقائيًا بعد الانتقال');
  await m.click('[data-a=sb]'); await m.waitForTimeout(400); await m.click('.scrim', { position: { x: 20, y: 400 } }); await m.waitForTimeout(400); assert((await m.$eval('aside', e => e.getBoundingClientRect().left)) > 300); t('الجوال: الضغط على الخلفية يغلقها');
  await m.screenshot({ path: '/tmp/ui/mobile.png' }); await pg.screenshot({ path: '/tmp/ui/desktop.png' });
  assert.deepEqual(errs, []); console.log('\nكل اختبارات المتصفح نجحت:', ok.length); await b.close(); server.close(); process.exit(0);
})().catch(e => { console.error('✗ FAIL', e.message.split('\n')[0]); process.exit(1); });
