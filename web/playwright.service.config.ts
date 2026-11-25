import { defineConfig } from '@playwright/test'

// API adapters are tested with injected fetch responses; no server or credentials.
export default defineConfig({ testDir: './tests/service' })
