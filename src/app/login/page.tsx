'use client';

import { useState, useEffect, Suspense } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useSearchParams } from 'next/navigation';
import { GOOGLE_OAUTH_SCOPE_STRING } from '@/lib/google-oauth';

function LoginContent() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    const err = searchParams.get('error');
    if (err === 'no_code') setError('Authentication failed: no code received.');
    if (err === 'auth_failed') setError('Authentication failed. Please try again.');
  }, [searchParams]);

  const handleSignIn = async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: GOOGLE_OAUTH_SCOPE_STRING,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm px-8 py-12 space-y-10">
      {/* Wordmark */}
      <div className="space-y-1">
        <h1
          className="text-3xl tracking-tight"
          style={{
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontWeight: 400,
            letterSpacing: '-0.02em',
          }}
        >
          Cleave
        </h1>
        <p
          className="text-sm"
          style={{
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
          }}
        >
          split inbox · zero clutter
        </p>
      </div>

      <div style={{ borderTop: '1px solid var(--border-default)' }} />

      <div className="space-y-4">
        <button
          onClick={handleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 text-sm transition-colors"
          style={{
            background: loading ? 'var(--bg-elevated)' : 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            color: loading ? 'var(--text-muted)' : 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? (
            <>
              <span className="inline-block w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
              connecting...
            </>
          ) : (
            <>
              <GoogleIcon />
              sign in with google
            </>
          )}
        </button>

        {error && (
          <p
            className="text-xs text-center"
            style={{ color: '#ef4444', fontFamily: 'var(--font-mono)' }}
          >
            {error}
          </p>
        )}
      </div>

      <p
        className="text-xs text-center leading-relaxed"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        requires gmail.modify scope
        <br />
        emails never stored
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="h-full flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
      <Suspense
        fallback={
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}>
            loading...
          </div>
        }
      >
        <LoginContent />
      </Suspense>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" opacity=".6" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" opacity=".6" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" opacity=".6" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" opacity=".6" />
    </svg>
  );
}
