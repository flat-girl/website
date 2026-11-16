import { defineConfig } from '@playwright/test'

const port = Number(process.env.FLAT_GIRL_TEST_PORT || 3000)

export default defineConfig({
  testDir: './tests',
  testIgnore: ['**/dev/**', '**/service/**'],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: 'chrome',
  },
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1 --directory .output/public`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
  },
})
