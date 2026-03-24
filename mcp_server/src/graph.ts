import { config } from "./config.js";
import { getAccessToken } from "./auth.js";

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "GraphError";
  }
}

export async function graphGet<T>(
  path: string,
  params?: Record<string, string>,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const token = await getAccessToken();

  const url = new URL(`${config.graphBaseUrl}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    let message = `Graph API error (${response.status}): ${body}`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      // keep raw message
    }
    throw new GraphError(response.status, message);
  }

  return response.json() as Promise<T>;
}

/** Formats a Graph API result as a readable JSON string for MCP text content. */
export function toText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
