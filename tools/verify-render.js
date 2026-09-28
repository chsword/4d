#!/usr/bin/env node
/* tools/verify-render.js —— 真机渲染回归
 *
 * 在真实的 Chromium 里加载 index.html，逐个页签检查：
 *   - 着色器编译 / 链接是否失败（直接查 COMPILE_STATUS / LINK_STATUS，
 *     不依赖应用自己的错误处理，否则失败会变成静默黑屏）
 *   - 有无运行时错误（onerror / unhandledrejection / console.error）
 *   - 枚举全部画布；物体 ROI 与只留背景/文字的负对照不同
 *   - 实际射线的材料/距离、动态 shape/size/floor 与独立解析值一致
 *
 * Node 替身不执行 GPU；这里补充真实编译、像素和语义验证。
 *
 * 用法：node tools/verify-render.js [--require-browser]
 * 找不到浏览器时默认跳过并退出 0；加 --require-browser 则视为失败。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REQUIRE_BROWSER = process.argv.includes('--require-browser');
const ONLY = (process.argv.find((s) => s.startsWith('--only=')) || '').slice(7);
if (ONLY && !['F10', 'F19'].includes(ONLY)) throw new Error('Unknown GPU check: ' + ONLY);

/* swiftshader 软件渲染下 ray marching 很慢，而 --virtual-time-budget 只管
   虚拟时间、不限制真实时间。所以窗口要小（像素数少一个数量级），
   预算也只够每个页签取三四帧。 */
const WINDOW = '420,340';
const BUDGET = 12000;
const FLAGS = [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--disable-gpu-shader-disk-cache', `--window-size=${WINDOW}`,
  `--virtual-time-budget=${BUDGET}`, '--dump-dom'
];

function findBrowser() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(cache)) {
    for (const dir of fs.readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      const p = path.join(cache, dir, 'chrome-linux64', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  for (const name of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch (e) { /* 继续找 */ }
  }
  return null;
}

function decode(s) {
  return s.replace(/&gt;/g, '>').replace(/&lt;/g, '<')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

const browser = findBrowser();
if (!browser) {
  const msg = '找不到 Chromium。装一个（npx playwright install chromium）或设 CHROME_PATH。';
  if (REQUIRE_BROWSER) { console.error('FAIL ' + msg); process.exit(1); }
  console.log('SKIP 渲染回归未运行 —— ' + msg);
  console.log('     注意：其余测试都不覆盖 GPU 路径，着色器错误不会被发现。');
  process.exit(0);
}
console.log('浏览器: ' + browser);

/* 生成的页面必须和 index.html 同目录，相对的 js/ 路径才解析得到 */
const page = path.join(ROOT, '.render-probe-' + process.pid + '.html');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const first = '<script src="js/m4.js"></script>';
if (html.indexOf(first) < 0) { console.error('FAIL index.html 里找不到注入点 ' + first); process.exit(1); }
fs.writeFileSync(page, html.replace(first, '<script src="tools/render-probe.js"></script>' + first));

let report;
try {
  const dom = execFileSync(browser, FLAGS.concat(['file://' + page + (ONLY ? '?only=' + ONLY : '')]),
    { encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  const m = dom.match(/<title>([\s\S]*?)<\/title>/);
  if (!m) throw new Error('页面没有产出 title');
  const raw = decode(m[1]);
  if (raw.indexOf('REPORT>>') < 0) throw new Error('探针未完成，title 为: ' + raw.slice(0, 120));
  report = JSON.parse(raw.replace(/^REPORT>>/, '').replace(/<<END$/, ''));
} finally {
  fs.unlinkSync(page);
}

const fails = [];
if (report.shaderFails.length) fails.push('着色器失败: ' + JSON.stringify(report.shaderFails));
if (report.errors.length) fails.push('运行时错误: ' + JSON.stringify(report.errors));

const expected = (html.match(/class="tab[^"]*" data-view="/g) || []).length;
if (!ONLY && report.tabCount !== expected) fails.push(`页签数 ${report.tabCount}，index.html 里是 ${expected}`);
if (!report.checks || !report.checks.length) fails.push('No semantic GPU checks ran');
const checkCounts = ONLY === 'F10' ? { F10: 18 } : ONLY === 'F19' ? { F19: 10 } : { F10: 18, F15: 1, F19: 10 };
for (const [id, count] of Object.entries(checkCounts)) {
  if ((report.checks || []).filter((c) => c.name.startsWith(id + ' ')).length !== count) fails.push('Missing semantic checks: ' + id);
}
for (const check of report.checks || []) {
  if (!check.ok) fails.push(check.name + ': ' + check.detail);
}

const pad = (s, n) => String(s).padEnd(n);
console.log('\n' + pad('页签', 13) + pad('画布', 22) + pad('绘制调用', 11) +
  pad('颜色数', 8) + pad('亮度均值', 11) + '亮度标准差');
const canvases = { analogy: ['cv-analogy'], projection: ['cv-projection'], slice: ['cv-slice'],
  physics: ['cv-physics'], linked: ['cv-linked', 'cv-linked-slice'], chirality: ['cv-chirality'], rings: ['cv-rings'] };
if (!ONLY && JSON.stringify(Object.keys(report.tabs).sort()) !== JSON.stringify(Object.keys(canvases).sort())) {
  fails.push('F15 missing tab reports');
}
for (const [name, values] of Object.entries(report.tabs)) {
  if (JSON.stringify(values.map((v) => v.id)) !== JSON.stringify(canvases[name])) fails.push('F15 missing canvas: ' + name);
  for (const v of values) {
  console.log(pad(name, 13) + pad(v.canvas, 22) + pad(v.drawCalls, 11) +
    pad(v.colors === undefined ? '-' : v.colors, 8) +
    pad(v.mean === undefined ? '-' : v.mean, 11) +
    (v.std === undefined ? (v.sampleError || '-') : v.std));
  if (v.canvas === 'NONE') fails.push(`${name}: 没有 active 画布`);
  else if (v.sampleError) fails.push(`${name}: 采样失败 ${v.sampleError}`);
  else if (!v.drawCalls) fails.push(`${name}: 零绘制调用`);
  // 纯色画面标准差为 0；给一个宽松但能抓住黑屏的下限
  else if (v.std < 3) fails.push(`${name}: 画面近乎纯色（标准差 ${v.std}），疑似黑屏`);
  else if (v.colors < 20) fails.push(`${name}: 颜色数仅 ${v.colors}，疑似未正常渲染`);
  if (!['cv-slice', 'cv-physics', 'cv-linked-slice'].includes(v.id)) {
    const regions = name === 'analogy' ? 4 : name === 'chirality' || name === 'rings' ? 2 : 1;
    if (!v.geometryPixels || v.geometryPixels.length !== regions) fails.push('F15 missing object ROIs: ' + name);
  }
  if (v.geometryPixels) {
    console.log('  object ROI pixels vs ' + (name === 'linked' ? 'helpers-only' : 'background/text') +
      ' negative control: ' + v.geometryPixels.map((x) => x.toFixed(1)).join(', '));
    if (v.geometryPixels.some((n) => !Number.isFinite(n) || n < 40)) fails.push('F15 missing object geometry: ' + name + ' ' + v.geometryPixels);
  }
  if (name === 'slice' && (!v.tutorialPixel || v.tutorialPixel[0] < v.tutorialPixel[1] * 1.3 ||
      v.tutorialPixel[0] < v.tutorialPixel[2] * 1.3)) fails.push('红球教程准星处没有真正渲染出红球');
  }
}

console.log();
if (fails.length) { fails.forEach((f) => console.error('FAIL ' + f)); process.exit(1); }
console.log('PASS ' + report.checks.length + ' semantic GPU checks (F10/F15/F19)');
if (ONLY || process.argv.includes('--probe-only')) process.exit(0);
async function verifyLayouts() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), '4d-layout-'));
  const proc = spawn(browser, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const exited = new Promise((resolve) => proc.once('exit', resolve));
  let socket;
  try {
    const address = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chromium DevTools startup timeout')), 30000);
      let text = '';
      proc.once('error', (error) => { clearTimeout(timer); reject(error); });
      proc.stderr.on('data', (chunk) => {
        text += chunk;
        const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    socket = new WebSocket(address);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let sequence = 0;
    const pending = new Map(), events = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p.timer);
        if (message.error) p.reject(new Error(JSON.stringify(message.error))); else p.resolve(message.result);
      } else if (events.has(message.method)) {
        events.get(message.method)(message.params); events.delete(message.method);
      }
    });
    function send(method, params, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timeout')); }, 30000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
      });
    }
    const target = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      window.layoutProbe = {};
      const proto = CanvasRenderingContext2D.prototype;
      for (const name of ['fillText', 'rect']) {
        const original = proto[name];
        proto[name] = function(...args) {
          const cv = this.canvas, id = cv.id;
          if (id === 'cv-analogy' || id === 'cv-projection') {
            const r = cv.getBoundingClientRect(), t = this.getTransform();
            const record = layoutProbe[id] || (layoutProbe[id] = { fonts: [], panels: [] });
            if (name === 'fillText') record.fonts.push(parseFloat(this.font.match(/([\\d.]+)px/)[1]) * t.d * r.height / cv.height);
            else record.panels.push([args[2] * t.a * r.width / cv.width, args[3] * t.d * r.height / cv.height]);
          }
          return original.apply(this, args);
        };
      }
    })();` }, sessionId);
    for (const [width, height, dpr] of [[320, 844, 1], [320, 844, 3], [390, 844, 3], [1280, 800, 2]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: width < 700 }, sessionId);
      const loaded = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Layout page load timeout')), 30000);
        events.set('Page.loadEventFired', () => { clearTimeout(timer); resolve(); });
      });
      await send('Page.navigate', { url: 'file://' + path.join(ROOT, 'index.html') }, sessionId);
      await loaded;
      const result = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
        const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await frame();
        const a = document.getElementById('cv-analogy');
        const r = a.getBoundingClientRect();
        const analogy = { width: r.width, height: r.height, bufferWidth: a.width,
          touch: getComputedStyle(a).touchAction, ...layoutProbe[a.id] };
        document.querySelector('.tab[data-view="projection"]').click();
        await frame();
        return { analogy, projection: layoutProbe['cv-projection'], viewport: innerWidth,
          overflow: document.documentElement.scrollWidth > innerWidth };
      })()` }, sessionId);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      const value = result.result.value, a = value.analogy, p = value.projection;
      if (value.viewport !== width || value.overflow) throw new Error('Wrong/overflowing viewport: ' + JSON.stringify(value));
      if (!a.fonts.length || !p.fonts.length || Math.min(...a.fonts, ...p.fonts) < 12 - 1e-9) {
        throw new Error('Unreadable CSS text at ' + width + '/DPR' + dpr);
      }
      if (!a.panels.length || a.panels.some(([w, h]) => w < 298 || h < 298) || a.touch !== 'pan-y') {
        throw new Error('Insufficient panel space or disabled touch scrolling: ' + JSON.stringify(a));
      }
      console.log(`PASS 布局 ${width}×${height} DPR=${dpr}: 最小字号 ${Math.min(...a.fonts, ...p.fonts).toFixed(2)} CSS px，单格至少 300×300 CSS px`);
    }
  } finally {
    if (socket) socket.close();
    if (proc.exitCode === null) proc.kill('SIGTERM');
    await exited;
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

verifyLayouts().then(() => {
  console.log(`PASS ${report.tabCount} 个页签全部真机渲染通过：` +
    '着色器零失败、零运行时错误、红球实际可见、高 DPR / 小屏布局可读。');
}).catch((error) => { console.error('FAIL ' + error.stack); process.exitCode = 1; });
