import { NextRequest, NextResponse } from 'next/server';
import {
  REQUIRED_GOOGLE_SCOPES,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_OAUTH_USERINFO_URL,
} from '@/lib/google-oauth';

const STATE_COOKIE = 'cleave_oauth_state';

function errorRedirect(origin: string, code: string): NextResponse {
  const res = NextResponse.redirect(
    `${origin}/#${new URLSearchParams({ add_account_error: code }).toString()}`,
  );
  res.cookies.set(STATE_COOKIE, '', { maxAge: 0, path: '/' });
  return res;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const oauthError = searchParams.get('error');
  const cookieState = request.cookies.get(STATE_COOKIE)?.value;

  if (oauthError) return errorRedirect(origin, oauthError);
  if (!code || !state || !cookieState || state !== cookieState) {
    return errorRedirect(origin, 'invalid_state');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return errorRedirect(origin, 'not_configured');

  const tokenRes = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${origin}/api/google/oauth/callback`,
      grant_type: 'authorization_code',
    }).toString(),
  });

  if (!tokenRes.ok) return errorRedirect(origin, 'token_exchange_failed');

  const tokens = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    scope: string;
    expires_in: number;
  };

  if (!tokens.refresh_token) {
    // Without a refresh token Cleave can't keep the account alive across
    // reloads. Surface this so the user re-grants with `prompt=consent`.
    return errorRedirect(origin, 'no_refresh_token');
  }

  const granted = new Set(tokens.scope.split(' '));
  const missing = REQUIRED_GOOGLE_SCOPES.filter((s) => !granted.has(s));
  if (missing.length > 0) {
    const res = NextResponse.redirect(
      `${origin}/#${new URLSearchParams({
        add_account_error: 'missing_scopes',
        missing: missing.join(','),
      }).toString()}`,
    );
    res.cookies.set(STATE_COOKIE, '', { maxAge: 0, path: '/' });
    return res;
  }

  const userRes = await fetch(GOOGLE_OAUTH_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) return errorRedirect(origin, 'userinfo_failed');

  const info = (await userRes.json()) as { email?: string; name?: string };
  if (!info.email) return errorRedirect(origin, 'userinfo_no_email');

  const hash = new URLSearchParams({
    add_account: '1',
    email: info.email,
    pt: tokens.access_token,
    prt: tokens.refresh_token,
    scope: tokens.scope,
    ...(info.name ? { name: info.name } : {}),
  });

  const res = NextResponse.redirect(`${origin}/#${hash.toString()}`);
  res.cookies.set(STATE_COOKIE, '', { maxAge: 0, path: '/' });
  return res;
}
