"use client";

import { useState } from "react";
import Link from "next/link";

import { Spinner } from "@/components/loaders/spinner";
import { Label } from "@/components/ui/label";

type AllowlistResponse = {
  created: boolean;
  location: {
    id: string;
    label: string;
    webUrl?: string;
  };
  resolved: {
    siteName: string | null;
    driveName: string | null;
    rootName: string;
  };
  error?: string;
};

export default function Ms365AllowlistPage() {
  const [url, setUrl] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AllowlistResponse | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setResult(null);

    if (!url.trim()) {
      setError("SharePoint URL is required");
      return;
    }

    if (!adminPassword) {
      setError("Admin password is required");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/ms365/allowlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          adminPassword,
        }),
      });

      const payload = (await response.json()) as AllowlistResponse;
      if (!response.ok) {
        setError(payload.error ?? "Failed to add allowlisted location");
        setLoading(false);
        return;
      }

      setResult(payload);
      setAdminPassword("");
      setUrl("");
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page flex min-h-dvh">
      <div className="grid w-full grid-rows-[auto_1fr] px-8 py-10 md:px-16 lg:px-24">
        <Link
          href="/agent"
          className="heading-serif text-sm tracking-widest text-(--ink-soft) transition-colors hover:text-foreground"
        >
          LNP Agent
        </Link>

        <div className="flex items-center">
          <div className="mx-auto w-full max-w-3xl">
            <h1 className="heading-serif text-2xl">MS365 Allowlist</h1>
            <p className="mt-2 text-sm text-(--ink-muted)">
              Add a SharePoint location to the Microsoft 365 browser.
            </p>

            {error ? (
              <p className="mt-4 border-2 border-(--border) bg-(--danger-soft) px-3 py-2 text-sm text-(--danger)">
                {error}
              </p>
            ) : null}

          {result ? (
            <div className="mt-4 border-2 border-(--brand) bg-(--brand-soft) px-3 py-3 text-sm text-(--brand)">
              <p className="font-semibold">
                {result.created ? "Location added." : "Location already exists."}
              </p>
            </div>
          ) : null}

            <form onSubmit={handleSubmit} autoComplete="off" className="mt-8 flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="url"
                  className="text-xs font-semibold uppercase tracking-wider text-(--ink-soft)"
                >
                  SharePoint URL
                </Label>
                <textarea
                  id="url"
                  placeholder="Paste a SharePoint or Teams Files URL"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  className="app-field min-h-28 w-full border-2 px-3 py-2 text-sm outline-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="admin-password"
                  className="text-xs font-semibold uppercase tracking-wider text-(--ink-soft)"
                >
                  Admin Password
                </Label>
                <input
                  id="admin-password"
                  name="admin-access-code"
                  type="text"
                  inputMode="text"
                  value={adminPassword}
                  onChange={(event) => setAdminPassword(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  data-lpignore="true"
                  data-1p-ignore="true"
                  style={{ WebkitTextSecurity: "disc" }}
                  className="app-field h-10 w-full border-2 px-3 text-sm outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="app-btn-primary mt-2 h-10 w-full text-sm"
              >
                {loading ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Spinner size="sm" className="text-(--brand-on)" />
                    <span>Adding location…</span>
                  </span>
                ) : (
                  "Add location"
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
