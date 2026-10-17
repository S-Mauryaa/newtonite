import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  apiRequest,
  loginWithPassword,
  type AuthenticatedApiRequestOptions,
} from "../lib/api";
import { ApiError } from "../lib/api";
import { AuthContext, type AuthSession } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);

  const login = useCallback(async (email: string, password: string) => {
    const result = await loginWithPassword(email, password);
    setSession({ accessToken: result.accessToken, user: result.user });
  }, []);

  const logout = useCallback(() => {
    setSession(null);
  }, []);

  const authenticatedRequest = useCallback(
    async (path: string, options: AuthenticatedApiRequestOptions = {}) => {
      if (!session) {
        throw new ApiError("Sign in to continue.", 401, "UNAUTHENTICATED");
      }

      return apiRequest(path, {
        ...options,
        token: session.accessToken,
        onUnauthorized: () => {
          setSession((current) =>
            current?.accessToken === session.accessToken ? null : current,
          );
        },
      });
    },
    [session],
  );

  const value = useMemo(
    () => ({ session, login, logout, authenticatedRequest }),
    [session, login, logout, authenticatedRequest],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
