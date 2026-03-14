"use client";

import { useEffect } from "react";
import { signOut } from "next-auth/react";
import { Spinner } from "@/components/ui/spinner";

export default function SignOutPage() {
  useEffect(() => {
    void signOut({ callbackUrl: "/auth/sign-in" });
  }, []);

  return (
    <div className="auth-page flex min-h-dvh items-center justify-center">
      <div className="mx-auto w-full max-w-sm text-center">
        <h1 className="heading-serif text-2xl">Sign Out</h1>
        <p className="mt-2 text-sm text-(--ink-muted)">
          Signing you out...
        </p>

        <div className="mt-8 flex items-center justify-center">
          <Spinner className="text-(--brand)" />
        </div>
      </div>
    </div>
  );
}
