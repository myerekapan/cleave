import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  // Pass provider tokens as hash fragments so they never appear in server logs
  const providerToken = data.session.provider_token ?? '';
  const providerRefreshToken = data.session.provider_refresh_token ?? '';

  const redirectUrl = new URL(next, origin);
  const hash = new URLSearchParams();
  if (providerToken) hash.set('pt', providerToken);
  if (providerRefreshToken) hash.set('prt', providerRefreshToken);

  const finalUrl = `${redirectUrl.toString()}#${hash.toString()}`;
  return NextResponse.redirect(finalUrl);
}
