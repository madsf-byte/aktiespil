import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [preact()],
  test: {
    environment: 'node',
  },
});
