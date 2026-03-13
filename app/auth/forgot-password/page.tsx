"use client";

import { useState } from "react";
import Link from "next/link";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Email is required");
      return;
    }

    setSubmitted(true);
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
            Forgot Password
          </h1>
          <p className="mt-2 text-sm text-(--ink-muted)">
            Enter your email and we&apos;ll send you a reset link
          </p>

          {submitted ? (
            <div className="mt-8">
              <p className="border-2 border-(--brand) bg-(--brand-soft) px-3 py-2 text-sm text-(--brand)">
                If an account exists for <strong>{email}</strong>, you&apos;ll receive a
                password reset email shortly.
              </p>
              <Link
                href="/auth/sign-in"
                className="mt-6 inline-block text-sm font-semibold text-foreground underline underline-offset-4"
              >
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
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

                <button
                  type="submit"
                  className="app-btn-primary mt-2 h-10 w-full text-sm"
                >
                  Send reset link
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-sm text-(--ink-muted)">
          Remember your password?{" "}
          <Link
            href="/auth/sign-in"
            className="font-semibold text-foreground underline underline-offset-4"
          >
            Sign in
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
        </div>
        <div />
      </div>
    </div>
  );
}
