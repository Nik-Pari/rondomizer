/* Генерация иконок PWA без внешних загрузок.
 * Запуск: npm run icons
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const CX = 256;
const CY = 256;
const CORAL = '#ff7a59';
const TEAL = '#3ddc97';
const BG = '#0b0f14';
const ARROW = '#5f7188';

const rad = (deg) => (deg * Math.PI) / 180;

function point(angle, radius) {
  return [CX + radius * Math.cos(rad(angle)), CY + radius * Math.sin(rad(angle))];
}

function arc(angleStart, angleEnd, color, radius, width, cap = 'round') {
  const [x0, y0] = point(angleStart, radius);
  const [x1, y1] = point(angleEnd, radius);
  const large = angleEnd - angleStart > 180 ? 1 : 0;
  return `<path d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="${cap}"/>`;
}

function arrowHead(angle, color, radius, size = 30) {
  const [x, y] = point(angle, radius);
  const tx = -Math.sin(rad(angle));
  const ty = Math.cos(rad(angle));
  const nx = -ty;
  const ny = tx;
  const back = size * 0.55;
  const half = size * 0.62;
  const baseX = x - tx * back;
  const baseY = y - ty * back;
  const tipX = x + tx * (size * 0.9);
  const tipY = y + ty * (size * 0.9);
  const p1 = `${(baseX + nx * half).toFixed(2)},${(baseY + ny * half).toFixed(2)}`;
  const p2 = `${(baseX - nx * half).toFixed(2)},${(baseY - ny * half).toFixed(2)}`;
  return `<path d="M ${tipX.toFixed(2)} ${tipY.toFixed(2)} L ${p1} L ${p2} Z" fill="${color}"/>`;
}

function ring(cx, color) {
  return `<circle cx="${cx}" cy="${CY}" r="62" fill="none" stroke="${color}" stroke-width="22"/>`;
}

function logoSvg({ maskable = false } = {}) {
  const content = `
    ${arc(300, 600, ARROW, 192, 11)}
    ${arrowHead(600, ARROW, 192, 30)}
    ${ring(222, CORAL)}
    ${ring(290, TEAL)}
  `;
  const background = maskable
    ? `<rect width="512" height="512" fill="${BG}"/>`
    : `<rect width="512" height="512" rx="112" fill="${BG}"/>`;
  const wrapped = maskable
    ? `<g transform="translate(256 256) scale(0.8) translate(-256 -256)">${content}</g>`
    : content;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${background}${wrapped}</svg>`;
}

const outDir = path.resolve('public/icons');
await fs.mkdir(outDir, { recursive: true });

const regular = logoSvg();
const maskable = logoSvg({ maskable: true });

await fs.writeFile(path.join(outDir, 'favicon.svg'), regular, 'utf8');
await fs.writeFile(path.join(outDir, 'icon.svg'), regular, 'utf8');

for (const [name, svg, size] of [
  ['icon-192.png', regular, 192],
  ['icon-512.png', regular, 512],
  ['icon-maskable-192.png', maskable, 192],
  ['icon-maskable-512.png', maskable, 512],
  ['apple-touch-icon.png', regular, 180],
]) {
  await sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(outDir, name));
  console.log(`icons/${name}`);
}

console.log('Готово.');
