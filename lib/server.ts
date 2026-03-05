import { fileURLToPath } from "node:url";
import path from "node:path";

export const OPENCODE_HOST = "127.0.0.1";
export const OPENCODE_PORT = 4096;

export async function startOpencodeServer() {
  const { createOpencode } = await import("@opencode-ai/sdk");
  const { client, server } = await createOpencode({
    hostname: OPENCODE_HOST,
    port: OPENCODE_PORT,
    timeout: 5000,
  });

  return { client, server };
}

async function main() {
  const { server } = await startOpencodeServer();
  console.log(`[opencode] server started at ${server.url}`);
  console.log(`[opencode] fixed port: ${OPENCODE_PORT}`);

  const shutdown = () => {
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const runningAsScript =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (runningAsScript) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
