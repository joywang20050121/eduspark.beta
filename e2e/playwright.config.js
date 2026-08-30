import {defineConfig, devices} from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: process.env.CI
        ? [['github'], ['html', {open: 'never'}]]
        : [['list'], ['html', {open: 'never'}]],
    use: {
        baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5002',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure'
    },
    projects: [
        {
            name: 'mobile-chromium',
            use: {...devices['Pixel 7']}
        }
    ]
});
