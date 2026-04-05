import { defineConfig } from 'vitest/config';

/** Config dédiée aux tests : pas de @vitejs/plugin-react ni PWA → évite les warnings esbuild/oxc de Vitest 4. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
