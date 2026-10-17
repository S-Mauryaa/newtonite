import { createContext } from "react";
import type { AuthenticatedApiRequestOptions, AuthenticatedUser } from "../lib/api";

export interface AuthSession {
  accessToken: string;
  user: AuthenticatedUser;
}

export interface AuthContextValue {
  session: AuthSession | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  authenticatedRequest: (
    path: string,
    options?: AuthenticatedApiRequestOptions,
  ) => Promise<unknown>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
