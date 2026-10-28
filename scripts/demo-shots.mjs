// Снимки приложения в мобильном виде через CDP (headless Edge на :9223).
// Использование: node scripts/demo-shots.mjs
// Ожидает запущенный: msedge --headless=new --remote-debugging-port=9223 ...

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:4173/';
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'screens');
mkdirSync(OUT_DIR, { recursive: true });

const leaders = ['Артём', 'Владислав', 'Дмитрий', 'Максим', 'Николай', 'Сергей', 'Андрей', 'Кирилл'];
const followers = ['Анна', 'Мария', 'Ольга', 'Полина', 'Светлана', 'Дарья', 'Елена', 'Виктория'];
// последние двое «пришли» только к 4-му раунду — демо-подсветка опоздавших
const lateSet = new Set(['Елена', 'Виктория']);

const now = Date.now();
const participants = [];
leaders.forEach((name, i) =>
  participants.push({ id: `l${i + 1}`, name, role: 'leader', status: 'active', createdAt: now - 4 * 3600e3, joinedRound: 1 }),
);
followers.forEach((name, i) =>
  participants.push({
    id: `f${i + 1}`,
    name,
    role: 'follower',
    status: 'active',
    createdAt: lateSet.has(name) ? now - 20 * 60e3 : now - 4 * 3600e3,
    joinedRound: lateSet.has(name) ? 4 : 1,
  }),
);

// Круговая ротация: в раунде r лидер i танцует с фолловером (i + r) % n.
const n = followers.length;
function pairsForRound(r) {
  const pairs = [];
  for (let i = 0; i < n; i++) {
    pairs.push({ leaderId: `l${i + 1}`, followerId: `f${((i + r) % n) + 1}` });
  }
  return pairs;
}
const allIds = participants.map((p) => p.id);
const history = [1, 2, 3].map((r) => ({
  number: r,
  pairs: pairsForRound(r - 1),
  skipIds: [],
  activeIds: allIds,
  generatedAt: now - (4 - r) * 20 * 60e3,
  confirmedAt: now - (4 - r) * 20 * 60e3 + 5 * 60e3,
  warnings: [],
}));
const circles = {};
for (const p of participants) {
  const partners = [];
  for (const rd of history) {
    for (const pair of rd.pairs) {
      if (pair.leaderId === p.id) partners.push(pair.followerId);
      if (pair.followerId === p.id) partners.push(pair.leaderId);
    }
  }
  circles[p.id] = { partners, number: 1 };
}
const pending = {
  number: 4,
  pairs: pairsForRound(3),
  skipIds: [],
  activeIds: allIds,
  generatedAt: now,
  confirmedAt: null,
  warnings: [],
};
const demoState = {
  version: 2,
  participants,
  history,
  pending,
  circles,
  nextRoundNumber: 5,
  undo: null,
  eveningStartedAt: now - 3 * 3600e3,
  updatedAt: now,
};

// --- CDP клиент ---
const CDP_BASE = 'http://127.0.0.1:9223';
let msgId = 0;
const pending2 = new Map();
let ws;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending2.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function attach() {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const list = await (await fetch(`${CDP_BASE}/json`)).json();
      let page = list.find((t) => t.type === 'page');
      if (!page) {
        page = await (await fetch(`${CDP_BASE}/json/new?url=about:blank`, { method: 'PUT' })).json();
      }
      ws = new WebSocket(page.webSocketDebuggerUrl);
      await new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = rej;
      });
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && pending2.has(m.id)) {
          const { resolve, reject } = pending2.get(m.id);
          pending2.delete(m.id);
          if (m.error) reject(new Error(m.error.message));
          else resolve(m.result);
        }
      };
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error('CDP недоступен на :9223');
}

async function evalJs(expression, awaitPromise = false) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
  });
  if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval error');
  return res.result.value;
}

async function waitFor(expr, timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await evalJs(`!!(${expr})`)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timeout waiting for: ${expr}`);
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT_DIR, name);
  writeFileSync(file, Buffer.from(data, 'base64'));
  console.log('saved', file);
}

async function clickTab(label) {
  await evalJs(
    `(() => { const b = [...document.querySelectorAll('nav.tabbar button')].find(x => x.textContent.includes(${JSON.stringify(label)})); if (b) b.click(); return !!b; })()`,
  );
  await new Promise((r) => setTimeout(r, 400));
}

await attach();
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setUserAgentOverride', {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 Edg/130.0.0.0',
});

// 1. Пустой старт
await send('Page.navigate', { url: APP_URL });
await waitFor('document.body.innerText.length > 0');
await evalJs(`localStorage.removeItem('rondomizer.state.v2'); 1`);
await send('Page.navigate', { url: APP_URL });
await waitFor(`document.body.innerText.length > 0`);
await new Promise((r) => setTimeout(r, 800));
await shot('demo-01-start-empty.png');

// 2. Сеем демо-вечер
await evalJs(`localStorage.setItem('rondomizer.state.v2', ${JSON.stringify(JSON.stringify(demoState))})`);
await send('Page.navigate', { url: APP_URL });
await waitFor(`document.body.innerText.includes(${JSON.stringify('Подтвердить')}) || document.body.innerText.length > 100`);
await new Promise((r) => setTimeout(r, 800));
await shot('demo-02-round-draft.png');

// 3. Статистика
await clickTab('Статистика');
await shot('demo-03-stats.png');

// 4. Состав
await clickTab('Люди');
await shot('demo-04-roster.png');

// 5. Ещё
await clickTab('Ещё');
await shot('demo-05-more.png');

console.log('done');
ws.close();
process.exit(0);
