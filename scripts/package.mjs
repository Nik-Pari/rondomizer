import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const single = process.argv.includes('--single');
const sourceDir = path.join(root, single ? 'dist-single' : 'dist');
const releaseDir = path.join(root, 'release');
const suffix = single ? 'single' : 'pwa';
const zipPath = path.join(releaseDir, `rondomizer-${suffix}-${pkg.version}.zip`);

if (!fs.existsSync(sourceDir)) {
  console.error(
    `Не найдена папка ${path.relative(root, sourceDir)}. Сначала выполните ${single ? 'npm run build:single' : 'npm run build'}.`,
  );
  process.exit(1);
}

await fsp.mkdir(releaseDir, { recursive: true });

await new Promise((resolve, reject) => {
  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  output.on('close', resolve);
  output.on('error', reject);
  archive.on('error', reject);
  archive.pipe(output);

  // Содержимое сборки лежит в корне архива: его можно распаковать
  // прямо в папку сайта, не создавая лишний уровень dist/.
  archive.directory(sourceDir, false);

  // Archiver не всегда включает dot-файлы через directory(); .nojekyll нужен
  // GitHub Pages, чтобы не включать обработку Jekyll.
  const nojekyll = path.join(sourceDir, '.nojekyll');
  if (fs.existsSync(nojekyll)) {
    archive.file(nojekyll, { name: '.nojekyll' });
  }

  void archive.finalize();
});

const size = fs.statSync(zipPath).size;
const sizeLabel = size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} КБ` : `${(size / (1024 * 1024)).toFixed(2)} МБ`;
console.log(`\n[package] ${path.relative(root, zipPath)} — ${sizeLabel}`);
console.log(`[package] исходная папка: ${path.relative(root, sourceDir)}`);
