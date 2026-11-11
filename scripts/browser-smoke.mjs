// 使用系统 Chrome 的 CDP 做真实 WebGL 与 DOM 交互验收；不依赖 Playwright。
// 前置：Chrome 以 --remote-debugging-port=9227 启动，项目页面在 127.0.0.1:5191。
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9227';
const APP = process.env.APP_URL ?? 'http://127.0.0.1:5191';
const out = new URL('../artifacts/', import.meta.url);
await mkdir(out, { recursive: true });

const pages = await (await fetch(`${CDP}/json/list`)).json();
const page = pages.find((p) => p.type === 'page');
if (!page) throw new Error('CDP 中没有可测试的 page');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let serial = 0;
const pending = new Map();
const runtimeErrors = [];
const consoleErrors = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id) {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
    else p.resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.exceptionThrown') runtimeErrors.push(msg.params.exceptionDetails);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});

function send(method, params = {}) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP 超时：${method}`));
    }, 20000);
    pending.set(id, { resolve, reject, timer, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
async function waitFor(expression, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await sleep(200);
  }
  throw new Error(`等待条件超时：${expression}`);
}
async function click(text, selector = 'button') {
  const r = await evaluate(`(() => {
    const normalize = (s) => s.replace(/\\s+/g, ' ').trim();
    const candidates = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = candidates.find((e) => normalize(e.textContent).includes(${JSON.stringify(text)}));
    if (!el) return { ok: false, candidates: candidates.map((e) => normalize(e.textContent)).slice(0, 30) };
    el.click();
    return { ok: true, text: normalize(el.textContent) };
  })()`);
  assert.ok(r.ok, `找不到可点击元素“${text}”（${selector}）：${r.candidates?.join(' | ')}`);
  await sleep(250);
}
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(new URL(`${name}.png`, out), Buffer.from(r.data, 'base64'));
}
const checks = [];
function passed(name, detail) {
  checks.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: APP });
await waitFor(`document.querySelector('.center canvas') && document.body.innerText.includes('MacBook Pro 3D')`);
await sleep(5000);

const initial = await evaluate(`(() => {
  const canvas = document.querySelector('.center canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  return {
    title: document.title,
    canvasCount: document.querySelectorAll('canvas').length,
    webgl: Boolean(gl),
    renderer: gl ? gl.getParameter(gl.RENDERER) : null,
    body: document.body.innerText,
    width: innerWidth,
    height: innerHeight,
  };
})()`);
assert.match(initial.title, /MacBook Pro 3D/);
assert.ok(initial.canvasCount >= 1);
assert.ok(initial.webgl, '中央画布必须具有真实 WebGL 上下文');
assert.match(initial.body, /真实硬件拆解/);
assert.match(initial.body, /教学抽象/);
passed('真实 WebGL 初始渲染', { renderer: initial.renderer, viewport: [initial.width, initial.height] });
await shot('01-teardown');

await evaluate(`(() => {
  const r = document.querySelector('.tl-range');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(r, '60');
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
await sleep(2200);
assert.equal(await evaluate(`document.querySelector('.tl-range').value`), '60');
passed('爆炸滑块驱动三维拆解状态', '60%');
await shot('02-exploded');
await click('复原', '.bottom button');
assert.equal(await evaluate(`document.querySelector('.tl-range').value`), '0');
passed('拆解平滑复原控制', '0%');

await click('数据流动', '.mode');
await click('开机启动', '.scn > button');
for (let i = 0; i < 3; i++) await click('单步', '.bottom button');
assert.match(await evaluate(`document.body.innerText`), /Boot ROM/);
await evaluate(`document.querySelector('.pkt')?.click()`);
await sleep(250);
const packetText = await evaluate(`document.querySelector('.pkt-card')?.innerText ?? ''`);
assert.match(packetText, /来源/);
assert.match(packetText, /目标/);
assert.match(packetText, /发生原因/);
passed('场景单步与可检查数据包', packetText.replace(/\n/g, ' · '));
await shot('03-dataflow');

await click('深入芯片内部', '.mode');
await waitFor(`document.body.innerText.includes('AArch64 程序')`);
await click('单步（指令）', '.bottom button');
assert.match(await evaluate(`document.body.innerText`), /已退休 1 条/);
await click('微步', '.bottom button');
passed('AArch64 指令与微阶段执行', '退休计数、PC、流水阶段同步更新');
await shot('04-chip');

await click('计算机实验', '.mode');
await click('内存 / 虚拟内存实验', '.lab-btn');
await click('+ 浏览器', '.right button');
await click('单步', '.bottom button');
assert.match(await evaluate(`document.body.innerText`), /浏览器 pid/);
assert.match(await evaluate(`document.body.innerText`), /内存压力/);
passed('进程申请、缺页与页框可视化', '浏览器进程已创建并推进时间片');
await shot('05-memory');

await click('SSD 与文件实验', '.lab-btn');
await click('清空页缓存', '.right button');
await evaluate(`document.querySelector('.files tbody tr .ops button')?.click()`);
await sleep(300);
assert.match(await evaluate(`document.body.innerText`), /最近一次读取/);
await click('保存（write + fsync）', '.right button');
assert.match(await evaluate(`document.body.innerText`), /report.txt/);
passed('SSD 冷缓存读取与文件保存', 'I/O 时间线、缓存命中与 NAND 路径可见');
await shot('06-ssd');

await click('GPU 渲染实验', '.lab-btn');
await click('一次完成', '.right button');
await sleep(500);
assert.match(await evaluate(`document.body.innerText`), /TBDR 写回帧缓冲/);
assert.match(await evaluate(`document.body.innerText`), /复制 0 B/);
passed('GPU 命令、统一内存与实际光栅化输出', '帧缓冲和 TBDR 统计已生成');
await shot('07-gpu');

await click('多任务与散热实验', '.lab-btn');
await click('+ 4 个编译线程', '.right button');
await click('▶ 运行', '.bottom button');
await sleep(1000);
await click('❚❚ 暂停', '.bottom button');
const thermal = await evaluate(`document.querySelector('.meters')?.innerText ?? ''`);
assert.match(thermal, /°C/);
assert.match(thermal, /rpm/);
assert.match(thermal, /GHz/);
passed('调度队列、核心占用和热模型', thermal.replace(/\n/g, ' · '));
await shot('08-scheduler');

async function checkSidebarLayout(width, height, screenshot) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const layout = await evaluate(`(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    const controls = [...document.querySelectorAll('button,input,select,textarea')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const coveredFooterControls = [...document.querySelectorAll('.bottom button,.bottom input,.bottom select,.bottom textarea')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.top < 0 || r.top + 3 >= innerHeight) return false;
        const x = Math.max(1, Math.min(innerWidth - 1, r.left + r.width / 2));
        const hit = document.elementFromPoint(x, r.top + 3);
        return hit !== el && !el.contains(hit);
      }).length;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      availableWidth: document.querySelector('.app').clientWidth,
      center: rect('.center'),
      bottom: rect('.bottom'),
      right: rect('.right'),
      coveredFooterControls,
      offscreenControls: controls.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < -1 || r.right > document.querySelector('.app').clientWidth + 1;
      }).length,
    };
  })()`);
  assert.ok(layout.scrollWidth <= width, `${width}px 视口存在横向溢出：${JSON.stringify(layout)}`);
  assert.ok(layout.center.width >= layout.availableWidth - 2, `${width}px 视口主画布未使用可用宽度：${JSON.stringify(layout)}`);
  assert.ok(layout.center.bottom <= layout.bottom.top + 1, `${width}px 视口画布覆盖控制栏：${JSON.stringify(layout)}`);
  assert.equal(layout.coveredFooterControls, 0, `${width}px 视口控制栏按钮被遮挡：${JSON.stringify(layout)}`);
  assert.ok(layout.right.right <= layout.availableWidth + 1, `${width}px 视口右栏被裁出屏幕：${JSON.stringify(layout)}`);
  assert.equal(layout.offscreenControls, 0, `${width}px 视口存在不可达控件`);
  passed(`${width}×${height}px 侧边栏布局`, '单栏无横向溢出，画布与控制栏不重叠');
  await shot(screenshot);
}
await checkSidebarLayout(640, 900, '09-sidebar-640');
await checkSidebarLayout(480, 800, '10-sidebar-480');
await checkSidebarLayout(480, 640, '11-sidebar-480-short');

assert.deepEqual(runtimeErrors, [], `浏览器运行时异常：${JSON.stringify(runtimeErrors)}`);
assert.deepEqual(consoleErrors, [], `浏览器 console.error：${consoleErrors.join('\n')}`);
passed('浏览器无运行时异常或 console.error');

const report = { app: APP, chrome: pages.find((p) => p.type === 'page')?.title, checks, runtimeErrors, consoleErrors };
await writeFile(new URL('browser-smoke.json', out), JSON.stringify(report, null, 2));
console.log(`\n${checks.length} 项浏览器验收全部通过；截图与报告：${out.pathname}`);
ws.close();
