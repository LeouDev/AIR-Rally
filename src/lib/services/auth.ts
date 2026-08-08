export type AuthSession = { userId: string; email: string; name: string } | null;

export interface AuthProvider {
  readonly name: string;
  signIn(email: string, password: string): Promise<AuthSession>;
  signUp(email: string, password: string, name: string): Promise<AuthSession>;
  signOut(): Promise<void>;
  getSession(): Promise<AuthSession>;
}

/**
 * No auth backend is connected in Phase 1. The sign-in / sign-up /
 * forgot-password screens are UI-only and never call this — it exists so
 * Supabase Auth can implement it in a later phase without redesigning
 * those screens.
 */
export const activeAuthProvider: AuthProvider | null = null;
