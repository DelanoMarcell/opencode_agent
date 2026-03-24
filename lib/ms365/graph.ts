import { getMs365AppAccessToken } from "@/lib/ms365/auth";
import { getMs365Config } from "@/lib/ms365/config";

export class Ms365GraphError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "Ms365GraphError";
  }
}

export async function ms365GraphGet<T>(
  path: string,
  params?: Record<string, string>
): Promise<T> {
  const token = await getMs365AppAccessToken();
  const config = getMs365Config();
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
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    let message = `Graph API error (${response.status}): ${body}`;
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string } };
      if (parsed.error?.message) {
        message = parsed.error.message;
      }
    } catch {
      // Keep original body text when JSON parsing fails.
    }
    throw new Ms365GraphError(response.status, message);
  }

  return response.json() as Promise<T>;
}
