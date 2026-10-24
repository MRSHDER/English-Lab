import { defineConfig } from '@playwright/test';

// 说明：本机预装的 Chromium 路径；在你自己的电脑上，运行 `npx playwright install chromium`
// 后可把 executablePath 这一行删掉。
const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // iPad 横屏的大致尺寸
    viewport: { width: 1180, height: 820 },
    acceptDownloads: true,
    launchOptions: { executablePath, args: ['--no-sandbox'] },
  },
  webServer: [
    { command: 'npx vite preview --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', reuseExistingServer: false, timeout: 60_000 },
    { command: 'python3 -m http.server 4174 --bind 127.0.0.1 --directory .e2e-site', url: 'http://127.0.0.1:4174/lab/v1/', reuseExistingServer: false, timeout: 60_000 },
  ],
});
