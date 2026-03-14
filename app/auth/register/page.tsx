"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AuthPromoImage } from "@/components/auth/auth-promo-image";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim()) { setError("Email is required"); return; }
    if (!password) { setError("Password is required"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error);
        setLoading(false);
        return;
      }

      router.push("/auth/sign-in?registered=true");
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
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
            Create Account
          </h1>
          <p className="mt-2 text-sm text-(--ink-muted)">
            Enter your details to get started
          </p>

          {error && (
            <p className="mt-4 border-2 border-(--border) bg-(--danger-soft) px-3 py-2 text-sm text-(--danger)">
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name" className="text-xs font-semibold uppercase tracking-wider text-(--ink-soft)">
                Name
              </Label>
              <input
                id="name"
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                className="app-field h-10 w-full border-2 px-3 text-sm outline-none"
              />
            </div>

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
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className="app-field h-10 w-full border-2 px-3 text-sm outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="app-btn-primary mt-2 h-10 w-full text-sm"
            >
              {loading ? (<span className="inline-flex items-center justify-center gap-2"><Spinner size="sm" className="text-(--brand-on)" /><span>Creating account…</span></span>) : "Create account"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-(--ink-muted)">
          Already have an account?{" "}
          <Link
            href="/auth/sign-in"
            className="font-semibold text-foreground underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </div>

      <AuthPromoImage />
    </div>
  );
}
