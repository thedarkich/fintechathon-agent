// What the phone and PC recorders share: a page in the headless Chrome at $CDP, a capture loop of timestamped JPEG
// screenshots per scene, and the customer's moves (taps with a ring where the finger lands, typing, scrolling, and
// waiting for the model, whose thinking time is noted so the edit can speed it up). The app is at $BASE.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.BASE || 'http://localhost:8000';
const CDP = process.env.CDP || 'http://localhost:9335';
const MODEL_GAP = 13.5; // seconds between model calls: the key allows 5 a minute
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now() / 1000;

// a green ring where the finger lands, so viewers see each tap
const RIPPLE = `addEventListener('pointerdown', (e) => {
  const d = document.createElement('div');
  Object.assign(d.style, { position: 'fixed', left: (e.clientX - 24) + 'px', top: (e.clientY - 24) + 'px', width: '48px', height: '48px',
    borderRadius: '50%', background: 'rgba(26,127,79,0.28)', border: '3px solid rgba(26,127,79,0.85)', pointerEvents: 'none',
    zIndex: '2147483647', transform: 'scale(0.55)', opacity: '1', transition: 'transform .5s ease-out, opacity .5s ease-out' });
  document.documentElement.appendChild(d);
  requestAnimationFrame(() => requestAnimationFrame(() => { d.style.transform = 'scale(1.5)'; d.style.opacity = '0'; }));
  setTimeout(() => d.remove(), 650);
}, true);`;

// on a desktop, a mouse pointer drawn on the page (headless screenshots have none), following the mouse
const POINTER = `addEventListener('mousemove', (e) => {
  let p = document.getElementById('__pointer');
  if (!p) {
    p = document.createElement('div');
    p.id = '__pointer';
    p.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26"><path d="M4 2 L4 21 L9 16.5 L12.5 24 L16 22.5 L12.6 15.2 L19.5 15.2 Z" fill="#111827" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(p.style, { position: 'fixed', width: '26px', height: '26px', margin: '-3px 0 0 -4px', pointerEvents: 'none',
      zIndex: '2147483647', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.25))' });
    document.documentElement.appendChild(p);
  }
  p.style.left = e.clientX + 'px';
  p.style.top = e.clientY + 'px';
}, true);`;

export let page;
let context, cdp, browser, pointer = null;
let rec = null;
let lastModelCall = 0;
let OUT;

/** A page of the given size; with pointer, a mouse pointer is drawn and glides to each click. */
export async function open(out, { viewport, deviceScaleFactor, mobile }) {
  OUT = out;
  fs.mkdirSync(OUT, { recursive: true });
  browser = await chromium.connectOverCDP(CDP);
  // the customer shares a location (central Futian, Shenzhen) when the places card asks
  context = await browser.newContext({ viewport, deviceScaleFactor, isMobile: mobile, hasTouch: mobile, locale: 'zh-CN',
    bypassCSP: true, geolocation: { latitude: 22.5431, longitude: 114.0579 }, permissions: ['geolocation'] });
  await context.addInitScript(mobile ? RIPPLE : RIPPLE + POINTER);
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  cdp = await context.newCDPSession(page);
  if (!mobile) pointer = { x: viewport.width * 0.6, y: viewport.height * 0.55 };
}

async function captureLoop(r) {
  while (rec === r) {
    if (r.paused) { await sleep(40); continue; }
    const t = now();
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 88, optimizeForSpeed: true });
      if (rec !== r || r.paused) continue;
      const name = `${String(r.frames.length).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(r.dir, name), Buffer.from(data, 'base64'));
      r.frames.push([name, t]);
    } catch { await sleep(30); }
  }
}

export async function start(name) {
  const dir = path.join(OUT, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  rec = { name, dir, frames: [], marks: [], cuts: [], paused: false, start: now() };
  rec.loop = captureLoop(rec);
  await sleep(400);
  console.log(`▶ ${name}`);
}

export async function end() {
  await sleep(700);
  const r = rec;
  rec = null;
  await r.loop;
  r.end = now();
  fs.writeFileSync(path.join(r.dir, 'scene.json'), JSON.stringify({ name: r.name, start: r.start, end: r.end, frames: r.frames,
    fast: r.marks, cuts: r.cuts }, null, 1));
  console.log(`■ ${r.name}: ${r.frames.length} frames, ${(r.end - r.start).toFixed(1)} s, ${r.marks.length} waits`);
}

// waiting for the model's rate limit is cut from the scene: capture pauses and the screen doesn't change
async function pace() {
  const wait = lastModelCall + MODEL_GAP - now();
  if (wait <= 0) return;
  if (rec) { rec.paused = true; rec.cuts.push(now()); }
  await sleep(wait * 1000);
  if (rec) rec.paused = false;
}

// the pointer eases over to (x, y), a frame or two at a time
async function glide(x, y) {
  const from = { ...pointer };
  for (let i = 1; i <= 14; i++) {
    const k = i / 14;
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    await page.mouse.move(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
    await sleep(16);
  }
  pointer = { x, y };
}

export async function tap(locator, pause = 450) {
  await locator.scrollIntoViewIfNeeded();
  await sleep(250);
  if (pointer) {
    const box = await locator.boundingBox();
    if (box) {
      await glide(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(120);
    }
  }
  await locator.click();
  await sleep(pause);
}

export async function scrollBy(dy, ms = 900) {
  await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), dy);
  await sleep(ms);
}

/** Scroll smoothly until the element's top reaches the top of the screen (less offset, for a fixed header). */
export async function scrollTo(locator, ms = 1400, offset = 70) {
  await locator.evaluate((el, off) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: 'smooth' }), offset);
  await sleep(ms);
}

/** A places card's list, once the maps have answered (its photos come in after it): every place has a 地图 link. */
export async function placesShown(scope) {
  await scope.getByText('正在地图上搜索…').last().waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {});
  await scope.getByRole('link', { name: '地图' }).last().waitFor({ timeout: 60000 });
  await sleep(1800);
}

export const main = () => page.locator('main');
export const button = (name, scope = page) => scope.getByRole('button', { name, exact: true }).last();

/** Something that asks the model (act), then waiting for its answer while busyText shows: the wait, from lead seconds
 * after asking, is noted as model time unless it was short (always: note it anyway). */
export async function modelTurn(act, { busyText = '正在处理…', lead = 0.9, appear = 4000, always = false } = {}) {
  await pace();
  await act();
  lastModelCall = now();
  const a = now();
  await page.getByText(busyText).first().waitFor({ state: 'visible', timeout: appear }).catch(() => {});
  await page.getByText(busyText).first().waitFor({ state: 'hidden', timeout: 90000 });
  const b = now();
  if (rec && (always || b - a > 1.6)) rec.marks.push([a + lead, b - 0.2]);
}

// type a message as a customer would and wait for the bank's answer
export async function say(text) {
  await modelTurn(async () => {
    const box = main().locator('textarea').first();
    await tap(box, 250);
    await box.pressSequentially(text, { delay: 90 });
    await sleep(350);
    await tap(button('发送', main()), 100);
  });
  await sleep(700);
}

export async function verifyInDialog() {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await sleep(700);
  await tap(button('填入', dialog), 500);
  await tap(button('发送验证码到我的手机', dialog), 1200);
  const code = (await dialog.innerText()).match(/验证码\s*(\d{6})/)[1];
  const input = dialog.locator('input:not([type=password])').first();
  await tap(input, 200);
  await input.pressSequentially(code, { delay: 110 });
  await sleep(500);
  await tap(button('验证并确认', dialog), 300);
  await dialog.waitFor({ state: 'hidden' });
}

/** The scenes in order, or only those named on the command line; a scene that fails leaves a screenshot. */
export async function run(scenes) {
  const only = process.argv.slice(3);
  for (const [name, scene] of Object.entries(scenes)) {
    if (only.length && !only.includes(name)) continue;
    try {
      await scene();
    } catch (error) {
      console.log(`✗ ${name}: ${error.message.split('\n')[0]}`);
      await page.screenshot({ path: path.join(OUT, `error-${name}.png`) }).catch(() => {});
      if (rec) await end();
    }
  }
  await context.close();
  await browser.close();
}
