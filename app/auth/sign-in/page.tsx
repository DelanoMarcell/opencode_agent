"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Label } from "@/components/ui/label";

export default function SignInPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const justRegistered = searchParams.get("registered") === "true";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim()) { setError("Email is required"); return; }
    if (!password) { setError("Password is required"); return; }

    setLoading(true);

    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError("Invalid email or password");
      return;
    }

    router.push("/agent");
    router.refresh();
  }

  return (
    <div className="auth-page flex min-h-dvh">
      {/* Left — Form */}
      <div className="flex w-full flex-col justify-between px-8 py-10 md:w-1/2 md:px-16 lg:px-24">
        <div className="heading-serif text-sm tracking-widest text-(--ink-soft)">
          LNP Agent
        </div>

        <div className="mx-auto w-full max-w-sm">
          <h1 className="heading-serif text-2xl">
            Sign In
          </h1>
          <p className="mt-2 text-sm text-(--ink-muted)">
            Enter your credentials to continue
          </p>

          {justRegistered && (
            <p className="mt-4 border-2 border-(--brand) bg-(--brand-soft) px-3 py-2 text-sm text-(--brand)">
              Account created — you can now sign in.
            </p>
          )}

          {error && (
            <p className="mt-4 border-2 border-(--border) bg-(--danger-soft) px-3 py-2 text-sm text-(--danger)">
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-(--ink-soft)">
                Email
              </Label>
              <input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="app-field h-10 w-full border-2 px-3 text-sm outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-(--ink-soft)">
                Password
              </Label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="app-field h-10 w-full border-2 px-3 text-sm outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="app-btn-primary mt-2 h-10 w-full text-sm"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-(--ink-muted)">
          Don&apos;t have an account?{" "}
          <Link
            href="/auth/register"
            className="font-semibold text-foreground underline underline-offset-4"
          >
            Register
          </Link>
        </p>
      </div>

      {/* Right — Promo Panel */}
      <div className="auth-promo hidden flex-col justify-between border-l-2 border-(--border) p-12 md:flex md:w-1/2 lg:p-16">
        <div />
        <div>
          <h2 className="heading-serif text-3xl leading-tight normal-case lg:text-4xl">
            Your AI Agent,
            <br />
            Ready to Work.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed opacity-70">
            A powerful assistant built to handle complex tasks, automate
            workflows, and give you the tools to move faster. Sign in to pick up
            where you left off.
          </p>
        </div>
        <div />
      </div>
    </div>
  );
}
