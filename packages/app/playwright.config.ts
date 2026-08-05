import { defineConfig, devices } from '@playwright/test';

/**
 * Overridable so two worktrees can run the suite at the same time. With the
 * port fixed at 5173 and `reuseExistingServer` on, a second run silently
 * drove the first worktree's dev server and tested the wrong code.
 */
const port = Number(process.env['MODL_PORT'] ?? 5173);

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
    // `--strictPort` fails loudly when the port is taken, rather than letting
    // vite drift to the next port while the tests stay on this one.
    command: `npm run dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env['CI'],
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
