import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/dev',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    channel: 'chrome',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
  },
})
