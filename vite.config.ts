import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

// base: './' 让打包结果用相对路径引用资源，
// 所以放在网站根目录或任何子目录下都能直接打开，不依赖特定平台。
export default defineConfig({
  base: './',
  plugins: [preact()],
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
