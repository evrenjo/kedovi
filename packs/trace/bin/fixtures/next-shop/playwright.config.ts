import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:5299' },
  webServer: { command: 'npm run dev', url: 'http://localhost:5299', reuseExistingServer: true },
})
