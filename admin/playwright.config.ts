import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser',
  use: { baseURL: 'http://127.0.0.1:3010', channel: 'chrome' },
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:3010', reuseExistingServer: false },
})
