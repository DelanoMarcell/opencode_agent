import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Resolve .env relative to this file so it works regardless of cwd
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, "..", ".env"), quiet: true });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  tenantId: requireEnv("AZURE_TENANT_ID"),
  clientId: requireEnv("AZURE_CLIENT_ID"),
  clientSecret: requireEnv("AZURE_CLIENT_SECRET"),
  graphBaseUrl: "https://graph.microsoft.com/v1.0",
} as const;
