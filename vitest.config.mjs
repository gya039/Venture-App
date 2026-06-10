import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Mirror the Next.js / tsconfig.json `@/` → `src/` path alias so that
      // files imported by API routes (e.g. @/lib/categories) resolve correctly
      // in the Vitest environment without a build step.
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,ts,mjs}'],
  },
});
