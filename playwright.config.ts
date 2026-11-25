import { defineConfig } from "@playwright/test";
process.loadEnvFile(".env.local");
export default defineConfig({ testDir: "./tests/biometric", timeout: 90000, workers: 1, use: { baseURL: "http://localhost:3000", channel: "chrome", headless: true, permissions: ["camera", "geolocation"], geolocation: { latitude: 0, longitude: 0 }, launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } }, reporter: "list" });
