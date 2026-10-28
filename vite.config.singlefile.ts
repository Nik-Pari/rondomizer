import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0b0f14"/><circle cx="32" cy="32" r="19" fill="none" stroke="#1b2532" stroke-width="6"/><path d="M32 13a19 19 0 0 1 16.5 9.5" fill="none" stroke="#ff7a59" stroke-width="6" stroke-linecap="round"/><path d="M32 51a19 19 0 0 1-16.5-9.5" fill="none" stroke="#3ddc97" stroke-width="6" stroke-linecap="round"/></svg>`;

function singleFileHtml(): Plugin {
  return {
    name: 'rondomizer-single-html',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/\s*<link rel="manifest"[^>]*>/g, '')
        .replace(/\s*<link rel="apple-touch-icon"[^>]*>/g, '')
        .replace(/\s*<link rel="icon"[^>]*>/g, '')
        .replace(
          '</head>',
          `  <link rel="icon" href="data:image/svg+xml,${encodeURIComponent(faviconSvg)}" />\n  </head>`,
        );
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  resolve: {
    preserveSymlinks: true,
  },
  plugins: [react(), viteSingleFile(), singleFileHtml()],
  build: {
    outDir: 'dist-single',
    target: 'es2020',
    sourcemap: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
  },
});
