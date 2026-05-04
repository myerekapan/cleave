'use client';

import { useEffect, useState } from 'react';
import { useSections } from '@/hooks/use-sections';
import { usePreferences, type AfterDoneAction } from '@/hooks/use-preferences';
import { useAuth } from '@/components/providers';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Plus, X } from 'lucide-react';
import {
  getAccounts,
  getActiveEmail,
  setActiveEmail,
  removeAccount,
  type Account,
} from '@/lib/gmail-token';

const AFTER_DONE_OPTIONS: { value: AfterDoneAction; label: string }[] = [
  { value: 'next', label: 'next email' },
  { value: 'previous', label: 'previous email' },
  { value: 'list', label: 'back to list' },
];

export default function SettingsPage() {
  const { sections } = useSections();
  const { prefs, update } = usePreferences();
  const { user } = useAuth();
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeEmail, setActiveEmailState] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      setAccounts(getAccounts());
      setActiveEmailState(getActiveEmail());
    };
    sync();
    window.addEventListener('cleave:account-changed', sync);
    window.addEventListener('cleave:token-ready', sync);
    return () => {
      window.removeEventListener('cleave:account-changed', sync);
      window.removeEventListener('cleave:token-ready', sync);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        router.push('/');
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  function handleSwitch(email: string) {
    if (email !== activeEmail) setActiveEmail(email);
  }

  function handleRemove(account: Account) {
    if (account.source === 'supabase') return;
    if (!confirm(`Remove ${account.email}? You'll need to re-authorize to add it back.`)) return;
    fetch('/api/google/oauth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: account.refreshToken }),
    }).catch(() => {});
    removeAccount(account.email);
  }

  return (
    <main
      className="h-full overflow-y-auto"
      style={{ background: 'var(--bg-base)', fontFamily: 'var(--font-mono)' }}
    >
      <div className="max-w-xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex items-center gap-3 mb-10">
          <button
            onClick={() => router.push('/')}
            className="flex items-center justify-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <h1
              className="text-xs uppercase"
              style={{ color: 'var(--text-primary)', letterSpacing: '0.12em', fontWeight: 500 }}
            >
              settings
            </h1>
            <p className="mt-0.5" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
              {activeEmail ?? user?.email ?? 'preferences'}
            </p>
          </div>
        </div>

        {/* Accounts */}
        <div className="space-y-3 mb-10">
          <span
            className="text-xs uppercase"
            style={{ color: 'var(--text-muted)', letterSpacing: '0.12em', fontWeight: 300 }}
          >
            accounts
          </span>

          <div style={{ border: '1px solid var(--border-default)' }}>
            {accounts.map((account, i) => (
              <div
                key={account.email}
                className="flex items-center gap-3 px-4 py-2.5"
                style={{
                  borderBottom: i < accounts.length - 1 ? '1px solid var(--border-subtle)' : undefined,
                  background: 'var(--bg-surface)',
                }}
              >
                <button
                  onClick={() => handleSwitch(account.email)}
                  className="flex items-center gap-2 flex-1 min-w-0"
                  style={{ textAlign: 'left', cursor: account.email === activeEmail ? 'default' : 'pointer' }}
                  disabled={account.email === activeEmail}
                >
                  <Check
                    size={11}
                    style={{
                      color: 'var(--text-primary)',
                      visibility: account.email === activeEmail ? 'visible' : 'hidden',
                      flexShrink: 0,
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      style={{
                        color: account.email === activeEmail ? 'var(--text-primary)' : 'var(--text-muted)',
                        fontSize: '12px',
                      }}
                      className="truncate"
                    >
                      {account.email}
                    </p>
                    <p className="mt-0.5" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                      {account.source === 'supabase' ? 'primary' : 'linked'}
                    </p>
                  </div>
                </button>
                {account.source !== 'supabase' && (
                  <button
                    onClick={() => handleRemove(account)}
                    title={`Remove ${account.email}`}
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
            <a
              href="/api/google/oauth/start"
              className="flex items-center gap-2 px-4 py-2.5"
              style={{
                borderTop: accounts.length > 0 ? '1px solid var(--border-subtle)' : undefined,
                background: 'var(--bg-surface)',
                color: 'var(--text-muted)',
                fontSize: '12px',
              }}
            >
              <Plus size={11} />
              add Gmail account
            </a>
          </div>
        </div>

        {/* Sections */}
        <div className="space-y-3">
          <span
            className="text-xs uppercase"
            style={{ color: 'var(--text-muted)', letterSpacing: '0.12em', fontWeight: 300 }}
          >
            sections
          </span>

          <div style={{ border: '1px solid var(--border-default)' }}>
            {sections.map((section, i) => (
              <div
                key={section.id}
                className="flex items-center gap-3 px-4 py-2.5"
                style={{
                  borderBottom: i < sections.length - 1 ? '1px solid var(--border-subtle)' : undefined,
                  background: 'var(--bg-surface)',
                }}
              >
                <div className="flex-1 min-w-0">
                  <p style={{ color: 'var(--text-primary)', fontSize: '12px' }}>
                    {section.name}
                  </p>
                  <p className="mt-0.5 truncate" style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                    {section.gmailLabel ? `Cleave/${section.name}` : 'inbox'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Behavior */}
        <div className="space-y-3 mt-10">
          <span
            className="text-xs uppercase"
            style={{ color: 'var(--text-muted)', letterSpacing: '0.12em', fontWeight: 300 }}
          >
            behavior
          </span>

          <div
            className="px-4 py-3"
            style={{ border: '1px solid var(--border-default)', background: 'var(--bg-surface)' }}
          >
            <p className="mb-2" style={{ color: 'var(--text-primary)', fontSize: '12px' }}>
              after archiving, go to
            </p>
            <div className="flex gap-1">
              {AFTER_DONE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => update({ afterDone: opt.value })}
                  className="px-3 py-1.5 transition-colors"
                  style={{
                    fontSize: '11px',
                    border: prefs.afterDone === opt.value ? '1px solid var(--selected-border)' : '1px solid var(--border-default)',
                    background: prefs.afterDone === opt.value ? 'var(--selected-bg)' : 'transparent',
                    color: prefs.afterDone === opt.value ? 'var(--accent-bright)' : 'var(--text-muted)',
                    fontWeight: prefs.afterDone === opt.value ? 500 : 400,
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Info */}
        <div
          className="mt-12 p-4 space-y-1.5"
          style={{ border: '1px solid var(--border-subtle)' }}
        >
          <p style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
            sections are derived from Gmail labels prefixed with Cleave/.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
            create sections via ⌘K → &quot;create section from sender&quot;.
          </p>
          <p style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
            emails are never stored — fetched live from gmail.
          </p>
        </div>

        <p className="mt-6" style={{ color: 'var(--text-muted)', fontSize: '10px', opacity: 0.6 }}>
          press esc to go back
        </p>
      </div>
    </main>
  );
}
