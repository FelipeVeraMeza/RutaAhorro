import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // RNF-36: 70 % de cobertura en la lógica de negocio.
      thresholds: { lines: 70, functions: 70, branches: 70, statements: 70 },
    },
  },
});
