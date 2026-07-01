import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as SecureStore from "expo-secure-store";
import { api, refreshAccessToken, setAuthHandlers } from "../lib/api";

const REFRESH_TOKEN_KEY = "quest_refresh_token";
// Proactively refresh well before the 15-minute JWT expiry.
const PROACTIVE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
// Avoid spamming refresh calls if the app is rapidly backgrounded/foregrounded.
const MIN_FOREGROUND_REFRESH_GAP_MS = 60 * 1000;

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
  const lastRefreshAtRef = useRef(0);
  const appStateRef = useRef(AppState.currentState);

  // Wire api.ts's 401-retry interceptor (and proactive/foreground refresh
  // below) back into this context's state/storage so the rest of the app
  // always sees a fresh access token without needing an app restart.
  useEffect(() => {
    setAuthHandlers({
      getRefreshToken: () => SecureStore.getItemAsync(REFRESH_TOKEN_KEY),
      onTokenRefreshed: (accessToken) => {
        lastRefreshAtRef.current = Date.now();
        setToken(accessToken);
      },
      onAuthFailure: () => {
        setToken(null);
        SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
      },
    });
    return () => setAuthHandlers({});
  }, []);

  // Initial silent refresh on launch.
  useEffect(() => {
    refreshAccessToken()
      .catch(() => {
        // Failure already handled via onAuthFailure above.
      })
      .finally(() => setIsLoading(false));
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

  // Refresh when the app comes back to the foreground from background, since
  // the 15-minute access token may well have expired while backgrounded.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;
      if (
        nextState === "active" &&
        prevState !== "active" &&
        token &&
        Date.now() - lastRefreshAtRef.current > MIN_FOREGROUND_REFRESH_GAP_MS
      ) {
        refreshAccessToken().catch((err) => console.error("Foreground token refresh failed:", err));
      }
    });
    return () => subscription.remove();
  }, [token]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, res.refreshToken);
    lastRefreshAtRef.current = Date.now();
    setToken(res.accessToken);
  }, []);

  const logout = useCallback(async () => {
    const stored = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY).catch(() => null);
    if (token && stored) await api.logout(token, stored).catch(() => {});
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {});
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
