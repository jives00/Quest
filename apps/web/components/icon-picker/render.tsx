"use client";
import React from "react";

/** Renders a platform icon value: URL → <img>, emoji → text, null → fallback */
export function PlatformIcon({
  value,
  fallback = "🎮",
  size = 20,
}: {
  value?: string | null;
  fallback?: React.ReactNode;
  size?: number;
}) {
  if (!value) return <>{fallback}</>;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return (
      <img
        src={value}
        alt=""
        width={size}
        height={size}
        className="rounded-sm object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return <span className="text-xl leading-none">{value}</span>;
}
