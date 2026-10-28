import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function walkFiles(dir: string, base: string = dir): string[] {
  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...walkFiles(full, base));
    } else if (entry.isFile()) {
      result.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return result;
}

/**
 * Генерирует service worker со списком всех файлов сборки.
 * Никаких абсолютных путей: и sw.js, и ассеты лежат относительно scope.
 */
function serviceWorkerPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'rondomizer-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (!fs.existsSync(outDir)) return;
      const files = walkFiles(outDir)
        .filter((file) => file !== 'sw.js')
        .filter((file) => !file.startsWith('.'))
        .filter((file) => !file.endsWith('.map'))
        .sort();

      const hash = createHash('sha256');
      for (const file of files) {
        hash.update(file);
        hash.update('\0');
        hash.update(fs.readFileSync(path.join(outDir, file)));
        hash.update('\0');
      }
      const version = hash.digest('hex').slice(0, 16);
      const assets = files.map((file) => `./${file}`);

      const templatePath = path.resolve('scripts/sw-template.js');
      const template = fs.readFileSync(templatePath, 'utf8');
      const sw = template
        .replace("'__CACHE_VERSION__'", JSON.stringify(version))
        .replace('__PRECACHE_ASSETS__', JSON.stringify(assets, null, 2));

      fs.writeFileSync(path.join(outDir, 'sw.js'), sw, 'utf8');
      fs.writeFileSync(path.join(outDir, '.nojekyll'), '', 'utf8');
      console.log(`\n[sw] предкэш: ${assets.length} файлов, версия ${version}`);
    },
  };
}

export default defineConfig({
  base: './',
  resolve: {
    // Корректная работа на Windows-дисках, смонтированных по сети.
    preserveSymlinks: true,
  },
  plugins: [react(), serviceWorkerPlugin()],
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: false,
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
});
