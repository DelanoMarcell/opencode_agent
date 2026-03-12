"use client";

import { signOut } from "next-auth/react";

export default function SignOutPage() {
  return (
    <div className="auth-page flex min-h-dvh items-center justify-center">
      <div className="mx-auto w-full max-w-sm text-center">
        <h1 className="heading-serif text-2xl">Sign Out</h1>
        <p className="mt-2 text-sm text-(--ink-muted)">
          Are you sure you want to sign out?
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={() => signOut({ callbackUrl: "/auth/sign-in" })}
            className="app-btn-primary h-10 w-full text-sm"
          >
            Sign out
          </button>
          <button
            onClick={() => window.history.back()}
            className="app-btn h-10 w-full text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
