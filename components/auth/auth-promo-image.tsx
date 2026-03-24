"use client";

import Image from "next/image";

export function AuthPromoImage() {
  return (
    <div className="hidden border-l-2 border-(--border) md:block md:w-1/2">
      <div className="relative h-full min-h-dvh w-full overflow-hidden">
        <Image
          src="/loginsignup.jpg"
          alt="LNP Agent authentication preview"
          fill
          priority
          className="object-cover"
          sizes="50vw"
        />
      </div>
    </div>
  );
}
