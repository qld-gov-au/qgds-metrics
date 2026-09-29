import { existsSync } from "node:fs";

// Loads .env locally. In Actions, secrets arrive as environment variables instead.
export function loadEnv(): void {
  if (existsSync(".env")) process.loadEnvFile(".env");
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing environment variable ${name}. Set it in .env or as a repository secret.`);
    process.exit(1);
  }
  return value;
}

export const isCI = process.env.CI === "true";
