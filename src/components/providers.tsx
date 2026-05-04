'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import {
  setTokens,
  clearTokens,
  clearLegacyTokens,
  getAccessToken,
  getRefreshToken,
  refreshAccessToken,
  addAccount,
  setActiveEmail,
  getActiveEmail,
  getAccounts,
} from '@/lib/gmail-token';
import { GOOGLE_OAUTH_SCOPE_STRING, GOOGLE_OAUTH_USERINFO_URL } from '@/lib/google-oauth';
import { ensureContactIndex } from '@/lib/contacts';
import { useRouter } from 'next/navigation';
import { Toaster, toast } from 'sonner';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

/**
 * Resolves a Supabase Google access token to its account email and registers
 * (or refreshes) the primary, Supabase-backed account in the registry.
 *
 * Critical: this only ever touches the primary account's slot — never the
 * active account's. Without that guarantee, a Supabase auth event firing
 * after the user has switched to a side-channel account would silently
 * overwrite that account's tokens with the primary's, leaving the UI
 * showing the wrong inbox.
 */
async function registerPrimaryAccount(
  accessToken: string,
  refreshToken: string | null,
): Promise<void> {
  // Already-known primary: just bump its tokens in place. We don't need
  // userinfo (we already know the email) and we don't dispatch token-ready
  // because the active account's token didn't change.
  const existingPrimary = getAccounts().find((a) => a.source === 'supabase');
  if (existingPrimary) {
    addAccount({
      email: existingPrimary.email,
      refreshToken: refreshToken ?? existingPrimary.refreshToken,
      accessToken,
      scopes: existingPrimary.scopes,
      source: 'supabase',
      displayName: existingPrimary.displayName,
    });
    if (getActiveEmail() === existingPrimary.email) {
      window.dispatchEvent(new Event('cleave:token-ready'));
    }
    return;
  }

  // First-time registration: identify the email via userinfo.
  if (refreshToken) {
    try {
      const res = await fetch(GOOGLE_OAUTH_USERINFO_URL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const info = (await res.json()) as { email: string; name?: string };
        addAccount({
          email: info.email,
          refreshToken,
          accessToken,
          scopes: GOOGLE_OAUTH_SCOPE_STRING,
          source: 'supabase',
          displayName: info.name,
        });
        setActiveEmail(info.email);
        clearLegacyTokens();
        return;
      }
    } catch {
      // Fall through to legacy storage path.
    }
  }

  // Couldn't identify the account — fall back to legacy singleton storage so
  // the user isn't locked out of the in-memory session.
  setTokens(accessToken, refreshToken);
  window.dispatchEvent(new Event('cleave:token-ready'));
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  // Capture provider tokens (Supabase callback or side-channel callback) from URL hash.
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;

    const params = new URLSearchParams(hash.slice(1));
    const cleanHash = () =>
      history.replaceState(null, '', window.location.pathname + window.location.search);

    const addAccountError = params.get('add_account_error');
    if (addAccountError) {
      toast.error(`Couldn't add account: ${addAccountError}`);
      cleanHash();
      return;
    }

    if (params.get('add_account') === '1') {
      const email = params.get('email');
      const pt = params.get('pt');
      const prt = params.get('prt');
      const scope = params.get('scope') ?? '';
      const name = params.get('name') ?? undefined;
      if (email && pt && prt) {
        addAccount({
          email,
          refreshToken: prt,
          accessToken: pt,
          scopes: scope,
          source: 'side-channel',
          displayName: name,
        });
        setActiveEmail(email);
        toast.success(`Added ${email}`);
      }
      cleanHash();
      return;
    }

    const pt = params.get('pt');
    const prt = params.get('prt');
    if (pt) {
      void registerPrimaryAccount(pt, prt);
      cleanHash();
    }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);

      if (event === 'SIGNED_IN' && session?.provider_token) {
        void registerPrimaryAccount(
          session.provider_token,
          session.provider_refresh_token ?? null,
        );
      }

      if (event === 'SIGNED_OUT') {
        clearTokens();
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-bootstrap: if we have a user session but no access token, try to refresh.
  // After refresh succeeds for a user that hasn't been migrated to the registry
  // yet (legacy single-account storage), promote them into the registry.
  useEffect(() => {
    if (loading || !user) return;
    if (getAccessToken()) return; // already have a token
    const refreshToken = getRefreshToken();
    if (!refreshToken) return;

    let cancelled = false;
    refreshAccessToken()
      .then(async (accessToken) => {
        if (cancelled) return;
        if (!getActiveEmail()) {
          await registerPrimaryAccount(accessToken, refreshToken);
        } else {
          window.dispatchEvent(new Event('cleave:token-ready'));
        }
      })
      .catch(() => {
        // Refresh token is invalid/revoked — force re-auth
        if (!cancelled) signOut();
      });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, user]);

  // Kick off contact-index build once we have a user + access token.
  useEffect(() => {
    if (loading || !user?.email) return;

    function tryBuild() {
      const token = getAccessToken();
      const email = user?.email;
      if (!token || !email) return false;
      ensureContactIndex(token, email);
      return true;
    }

    if (tryBuild()) return;

    const onTokenReady = () => { tryBuild(); };
    window.addEventListener('cleave:token-ready', onTokenReady);
    return () => window.removeEventListener('cleave:token-ready', onTokenReady);
  }, [loading, user]);

  const signOut = useCallback(async () => {
    clearTokens();
    await supabase.auth.signOut();
    router.push('/login');
  }, [supabase, router]);

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
      <Toaster
        position="bottom-right"
        theme="light"
        toastOptions={{
          style: {
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontSize: '13px',
          },
        }}
      />
    </AuthContext.Provider>
  );
}
