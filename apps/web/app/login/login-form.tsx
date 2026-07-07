"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export function LoginForm() {
  const { login, token, isLoading } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // If auto-login (network auto-session or an existing session) produced a token,
  // leave the login page for the app.
  useEffect(() => {
    if (token) router.replace("/");
  }, [token, router]);

  // While the auth context is still resolving (silent refresh + network auto-session),
  // show a splash instead of the form so trusted users never see a login prompt.
  if (isLoading || token) {
    return (
      <p className="text-center text-sm text-on-surface-variant">Signing you in…</p>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(username, password);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-stack-sm">
      {error && (
        <p role="alert" className="rounded bg-error-container px-3 py-2 text-sm text-on-error-container">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="username" className="text-label-sm uppercase tracking-widest text-on-surface-variant">
          Username
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-on-surface focus:border-primary-container focus:outline-none"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-label-sm uppercase tracking-widest text-on-surface-variant">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-outline-variant bg-surface-container px-3 py-2 text-on-surface focus:border-primary-container focus:outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 rounded bg-primary-container py-2 text-sm font-bold text-on-primary-container transition hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
