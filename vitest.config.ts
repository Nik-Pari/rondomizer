import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // На Windows-дисках, смонтированных по сети (M: → UNC), Vite иначе
    // превращает путь в /SERVER/... и не находит файлы.
    preserveSymlinks: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ['verbose'],
  },
});
