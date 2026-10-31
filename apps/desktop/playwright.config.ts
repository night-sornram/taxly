import { defineConfig, devices } from "@playwright/test";
const preview = Boolean(process.env.TAXLY_E2E_PREVIEW);
const baseURL = preview ? "http://127.0.0.1:1421" : "http://127.0.0.1:1420";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: preview ? "npx vite preview --host 127.0.0.1 --port 1421 --strictPort" : "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
