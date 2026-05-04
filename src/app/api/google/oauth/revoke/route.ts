import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { refresh_token } = await request.json();
  if (!refresh_token) {
    return NextResponse.json({ error: 'Missing refresh_token' }, { status: 400 });
  }

  // Best-effort revoke. We always return ok so the client doesn't block on
  // network/Google failures — the registry entry will be removed regardless.
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refresh_token }).toString(),
    });
  } catch {
    // Swallow — caller treats this as fire-and-forget.
  }

  return NextResponse.json({ ok: true });
}
