"use client";

import { useState } from "react";

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function Avatar({ name, src, size = "md" }: { name: string; src?: string; size?: "md" | "lg" }) {
  const [broken, setBroken] = useState(false);
  const dim = size === "lg" ? "size-14" : "size-9";
  const text = size === "lg" ? "text-sm" : "text-xs";

  if (!src || broken) {
    return (
      <div className={`grid ${dim} shrink-0 place-items-center rounded-full bg-teal-800 ${text} font-semibold text-white`}>
        {initials(name)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className={`${dim} shrink-0 rounded-full object-cover bg-stone-200`}
      onError={() => setBroken(true)}
    />
  );
}
