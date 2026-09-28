#!/usr/bin/env node
/* tools/verify-render.js —— 真机渲染回归
 *
 * 在真实的 Chromium 里加载 index.html，逐个页签检查：
 *   - 着色器编译 / 链接是否失败（直接查 COMPILE_STATUS / LINK_STATUS，
 *     不依赖应用自己的错误处理，否则失败会变成静默黑屏）
 *   - 有无运行时错误（onerror / unhandledrejection / console.error）
 *   - 画布是否真的画出了东西（颜色数与亮度标准差；纯色画面标准差为 0）
 *
 * 其余测试都是纯 node 的数学与接线验证，没有一个像素被真正画出来过。
 * 这一条是唯一覆盖 GPU 路径的回归，所以 4D SDF ray marching 一旦写坏
 * （比如 GLSL 里混进非 ASCII、或对向量用了三目运算符），只有它能发现。
 *
 * 用法：node tools/verify-render.js [--require-browser]
 * 找不到浏览器时默认跳过并退出 0；加 --require-browser 则视为失败。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REQUIRE_BROWSER = process.argv.includes('--require-browser');

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
const page = path.join(ROOT, '.render-probe.html');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const first = '<script src="js/m4.js"></script>';
if (html.indexOf(first) < 0) { console.error('FAIL index.html 里找不到注入点 ' + first); process.exit(1); }
fs.writeFileSync(page, html.replace(first, '<script src="tools/render-probe.js"></script>' + first));

let report;
try {
  const dom = execFileSync(browser, FLAGS.concat(['file://' + page]),
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
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
if (report.tabCount !== expected) fails.push(`页签数 ${report.tabCount}，index.html 里是 ${expected}`);

const pad = (s, n) => String(s).padEnd(n);
console.log('\n' + pad('页签', 13) + pad('画布', 22) + pad('绘制调用', 11) +
  pad('颜色数', 8) + pad('亮度均值', 11) + '亮度标准差');
for (const [name, v] of Object.entries(report.tabs)) {
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
}

console.log();
if (fails.length) { fails.forEach((f) => console.error('FAIL ' + f)); process.exit(1); }
console.log(`PASS ${report.tabCount} 个页签全部真机渲染通过：` +
  '着色器零失败、零运行时错误、画布均有实际内容。');
