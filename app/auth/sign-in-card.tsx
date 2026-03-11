"use client";

import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SignInCard() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-center text-2xl">Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <Button
          className="w-full"
          size="lg"
          onClick={() => signIn("microsoft")}
        >
          Sign in with Microsoft
        </Button>
      </CardContent>
    </Card>
  );
}
