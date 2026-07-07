"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, refreshAccessToken, setAuthHandlers } from "./api";

// Proactively refresh well before the 15-minute JWT expiry.
const PROACTIVE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

interface AuthState {
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Wire api.ts's 401-retry interceptor (and proactive refresh below) back
  // into this context's state so the rest of the app always sees a fresh
  // access token without needing a full reload.
  useEffect(() => {
    setAuthHandlers({
      onTokenRefreshed: (accessToken) => setToken(accessToken),
      onAuthFailure: () => setToken(null),
    });
    return () => setAuthHandlers({});
  }, []);

  // On mount: silent refresh via the httpOnly cookie; if that fails (no valid session),
  // try passwordless network auto-login (trusted LAN / Tailscale) before giving up.
  useEffect(() => {
    (async () => {
      try {
        await refreshAccessToken();
      } catch {
        try {
          const { accessToken } = await api.session();
          setToken(accessToken);
        } catch {
          // Untrusted network or offline — leave unauthenticated (password form shows).
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Proactive refresh timer while authenticated, so the access token never
  // gets a chance to expire mid-session.
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(() => {
      refreshAccessToken().catch((err) => console.error("Proactive token refresh failed:", err));
    }, PROACTIVE_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    setToken(res.accessToken);
  }, []);

  const logout = useCallback(async () => {
    if (token) await api.logout(token).catch(() => {});
    setToken(null);
  }, [token]);

  return (
    <AuthContext.Provider value={{ token, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
