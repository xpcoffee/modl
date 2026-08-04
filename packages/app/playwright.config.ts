import { defineConfig, devices } from '@playwright/test';

/**
 * Overridable because `reuseExistingServer` trusts whatever answers on the
 * port: a dev server left running in another worktree serves that worktree's
 * code, and the suite then tests the wrong build. A parallel run sets its own
 * port and stays isolated.
 */
const port = Number(process.env['MODL_E2E_PORT'] ?? 5173);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  ...(process.env['CI'] ? { workers: 1 } : {}),
  // `list` keeps failures readable in a terminal for an agent.
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env['CI'],
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
