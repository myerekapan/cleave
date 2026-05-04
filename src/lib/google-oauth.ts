// Identity scopes — requested so we can call userinfo to resolve the account
// email. Not validated against the granted-scope list because Google returns
// `email`/`profile` as their canonical URLs (userinfo.email/userinfo.profile),
// not the short names — the userinfo round trip itself proves they were granted.
const IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const;

// Functional scopes — the Gmail/Calendar permissions Cleave needs to actually
// work. Returned by Google verbatim, so an exact-match check is reliable.
export const REQUIRED_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/gmail.settings.basic',
  'https://www.googleapis.com/auth/calendar',
] as const;

export const GOOGLE_OAUTH_SCOPE_STRING = [...IDENTITY_SCOPES, ...REQUIRED_GOOGLE_SCOPES].join(' ');

export const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_OAUTH_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export function buildGoogleAuthUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: GOOGLE_OAUTH_SCOPE_STRING,
    access_type: 'offline',
    // `consent` forces a refresh_token; `select_account` forces the picker
    // so the user can pick a *different* Google identity than whichever is
    // currently signed in to the browser.
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    state: params.state,
  });
  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${search.toString()}`;
}
