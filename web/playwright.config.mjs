import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/ui',
  outputDir: '../output/visual-audit/browser-results',
  timeout: 90000,
  workers: 2,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:8761', reducedMotion: 'reduce', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }, { name: 'webkit', use: { browserName: 'webkit' } }],
  webServer: { command: '../.venv/bin/python ../scripts/preview.py --port 8761', url: 'http://127.0.0.1:8761', reuseExistingServer: false },
});
