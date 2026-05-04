import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { buildGoogleAuthUrl } from '@/lib/google-oauth';

export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'OAuth not configured' }, { status: 500 });
  }

  const origin = request.nextUrl.origin;
  const state = randomBytes(16).toString('base64url');
  const url = buildGoogleAuthUrl({
    clientId,
    redirectUri: `${origin}/api/google/oauth/callback`,
    state,
  });

  const res = NextResponse.redirect(url);
  res.cookies.set('cleave_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 600,
    path: '/',
  });
  return res;
}
