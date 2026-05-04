// New keyed storage
const REGISTRY_KEY = 'cleave_accounts';
const ACTIVE_EMAIL_KEY = 'cleave_active_email';
const accessTokenKey = (email: string) => `cleave_at:${email}`;
const accessTokenTsKey = (email: string) => `cleave_at_ts:${email}`;

// Legacy singleton storage (kept for backwards compat until the primary
// account is registered with its email — see Providers).
const LEGACY_ACCESS_TOKEN_KEY = 'cleave_gmail_access_token';
const LEGACY_TOKEN_TIMESTAMP_KEY = 'cleave_gmail_token_ts';
const LEGACY_REFRESH_TOKEN_KEY = 'cleave_gmail_refresh_token';

// Access tokens expire after 3600s; refresh 10 min early
const TOKEN_MAX_AGE_MS = 50 * 60 * 1000;

export type AccountSource = 'supabase' | 'side-channel';

export interface Account {
  email: string;
  displayName?: string;
  refreshToken: string;
  addedAt: number;
  source: AccountSource;
  scopes: string;
}

interface AccountRegistry {
  version: 2;
  activeEmail: string | null;
  accounts: Record<string, Account>;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function readRegistry(): AccountRegistry | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(REGISTRY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AccountRegistry;
    if (parsed?.version !== 2) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRegistry(reg: AccountRegistry): void {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg));
  if (reg.activeEmail) localStorage.setItem(ACTIVE_EMAIL_KEY, reg.activeEmail);
  else localStorage.removeItem(ACTIVE_EMAIL_KEY);
}

function emptyRegistry(): AccountRegistry {
  return { version: 2, activeEmail: null, accounts: {} };
}

// ---------- Registry API ----------

export function getAccounts(): Account[] {
  const reg = readRegistry();
  return reg ? Object.values(reg.accounts) : [];
}

export function getActiveEmail(): string | null {
  const reg = readRegistry();
  if (!reg) return null;
  if (reg.activeEmail && reg.accounts[reg.activeEmail]) return reg.activeEmail;
  return null;
}

export function getActiveAccount(): Account | null {
  const reg = readRegistry();
  const email = getActiveEmail();
  if (!reg || !email) return null;
  return reg.accounts[email] ?? null;
}

export function setActiveEmail(email: string): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeEmail(email);
  const reg = readRegistry();
  if (!reg || !reg.accounts[normalized]) {
    throw new Error(`setActiveEmail: account ${normalized} is not registered`);
  }
  reg.activeEmail = normalized;
  writeRegistry(reg);
  window.dispatchEvent(
    new CustomEvent('cleave:account-changed', { detail: { email: normalized } }),
  );
  window.dispatchEvent(new Event('cleave:token-ready'));
}

export function addAccount(input: {
  email: string;
  refreshToken: string;
  scopes: string;
  source: AccountSource;
  displayName?: string;
  accessToken?: string;
}): void {
  if (typeof window === 'undefined') return;
  const email = normalizeEmail(input.email);
  const reg = readRegistry() ?? emptyRegistry();
  const existing = reg.accounts[email];
  reg.accounts[email] = {
    email,
    displayName: input.displayName ?? existing?.displayName,
    refreshToken: input.refreshToken,
    scopes: input.scopes,
    source: input.source,
    addedAt: existing?.addedAt ?? Date.now(),
  };
  if (!reg.activeEmail) reg.activeEmail = email;
  writeRegistry(reg);
  if (input.accessToken) {
    sessionStorage.setItem(accessTokenKey(email), input.accessToken);
    sessionStorage.setItem(accessTokenTsKey(email), String(Date.now()));
  }
}

export function removeAccount(email: string): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeEmail(email);
  const reg = readRegistry();
  if (!reg) return;
  delete reg.accounts[normalized];
  sessionStorage.removeItem(accessTokenKey(normalized));
  sessionStorage.removeItem(accessTokenTsKey(normalized));
  // Drop per-account localStorage caches so removing + re-adding gives a
  // clean slate, and so a removed account's cached threads / contact index
  // don't linger.
  const sectionCachePrefix = `cleave:emails:${normalized}:`;
  const contactKey = `cleave-contacts:${normalized}`;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(sectionCachePrefix) || key === contactKey) {
      localStorage.removeItem(key);
    }
  }
  if (reg.activeEmail === normalized) {
    const remaining = Object.keys(reg.accounts);
    reg.activeEmail = remaining[0] ?? null;
  }
  writeRegistry(reg);
  if (reg.activeEmail) {
    window.dispatchEvent(
      new CustomEvent('cleave:account-changed', { detail: { email: reg.activeEmail } }),
    );
    window.dispatchEvent(new Event('cleave:token-ready'));
  }
}

// ---------- Token access (legacy-compatible API) ----------

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  const email = getActiveEmail();
  if (email) return sessionStorage.getItem(accessTokenKey(email));
  return sessionStorage.getItem(LEGACY_ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  const account = getActiveAccount();
  if (account) return account.refreshToken;
  return localStorage.getItem(LEGACY_REFRESH_TOKEN_KEY);
}

function isTokenExpired(): boolean {
  if (typeof window === 'undefined') return true;
  const email = getActiveEmail();
  const tsKey = email ? accessTokenTsKey(email) : LEGACY_TOKEN_TIMESTAMP_KEY;
  const ts = sessionStorage.getItem(tsKey);
  if (!ts) return true;
  return Date.now() - Number(ts) > TOKEN_MAX_AGE_MS;
}

/**
 * Writes tokens for the active account when one is registered; otherwise
 * falls back to the legacy singleton keys. The legacy path is used briefly
 * during the initial Supabase callback before the primary account is
 * registered with its email (via a userinfo lookup).
 */
export function setTokens(accessToken: string, refreshToken: string | null): void {
  if (typeof window === 'undefined') return;
  const email = getActiveEmail();
  if (email) {
    sessionStorage.setItem(accessTokenKey(email), accessToken);
    sessionStorage.setItem(accessTokenTsKey(email), String(Date.now()));
    if (refreshToken) {
      const reg = readRegistry();
      if (reg && reg.accounts[email]) {
        reg.accounts[email] = { ...reg.accounts[email], refreshToken };
        writeRegistry(reg);
      }
    }
    return;
  }
  sessionStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, accessToken);
  sessionStorage.setItem(LEGACY_TOKEN_TIMESTAMP_KEY, String(Date.now()));
  if (refreshToken) localStorage.setItem(LEGACY_REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens(): void {
  if (typeof window === 'undefined') return;
  clearLegacyTokens();
  for (const a of getAccounts()) {
    sessionStorage.removeItem(accessTokenKey(a.email));
    sessionStorage.removeItem(accessTokenTsKey(a.email));
  }
  localStorage.removeItem(REGISTRY_KEY);
  localStorage.removeItem(ACTIVE_EMAIL_KEY);
}

/**
 * Drops the legacy singleton keys without touching the registry. Called
 * after the primary account is migrated into the registry so we don't
 * keep stale state in localStorage / sessionStorage.
 */
export function clearLegacyTokens(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(LEGACY_TOKEN_TIMESTAMP_KEY);
  localStorage.removeItem(LEGACY_REFRESH_TOKEN_KEY);
}

export async function refreshAccessToken(): Promise<string> {
  if (typeof window === 'undefined') throw new Error('refreshAccessToken called server-side');
  const email = getActiveEmail();
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('No refresh token available');

  const res = await fetch('/api/refresh-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken, ...(email ? { email } : {}) }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Token refresh failed: ${body}`);
  }

  const data = await res.json();
  const newAccessToken: string = data.access_token;
  const rotatedRefreshToken: string | undefined = data.refresh_token;

  if (email) {
    sessionStorage.setItem(accessTokenKey(email), newAccessToken);
    sessionStorage.setItem(accessTokenTsKey(email), String(Date.now()));
    if (rotatedRefreshToken) {
      const reg = readRegistry();
      if (reg && reg.accounts[email]) {
        reg.accounts[email] = { ...reg.accounts[email], refreshToken: rotatedRefreshToken };
        writeRegistry(reg);
      }
    }
  } else {
    sessionStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, newAccessToken);
    sessionStorage.setItem(LEGACY_TOKEN_TIMESTAMP_KEY, String(Date.now()));
    if (rotatedRefreshToken) localStorage.setItem(LEGACY_REFRESH_TOKEN_KEY, rotatedRefreshToken);
  }

  return newAccessToken;
}

/**
 * Returns a valid access token, refreshing if needed.
 * Throws if no refresh token is available (caller should redirect to login).
 */
export async function ensureFreshToken(): Promise<string> {
  const token = getAccessToken();
  if (token && !isTokenExpired()) return token;
  return refreshAccessToken();
}
