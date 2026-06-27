import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { api } from "../lib/api";

const REFRESH_TOKEN_KEY = "quest_refresh_token";

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
  const refreshedRef = useRef(false);

  useEffect(() => {
    if (refreshedRef.current) return;
    refreshedRef.current = true;

    SecureStore.getItemAsync(REFRESH_TOKEN_KEY)
      .then(async (stored) => {
        if (!stored) return;
        const res = await api.refresh(stored);
        setToken(res.accessToken);
      })
      .catch(() => setToken(null))
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await api.login(username, password);
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, res.refreshToken);
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
