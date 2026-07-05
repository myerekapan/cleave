'use client';

import { useState, useEffect, useRef } from 'react';
import { Check, Plus, X, LogOut } from 'lucide-react';
import {
  getAccounts,
  getActiveEmail,
  setActiveEmail,
  removeAccount,
  type Account,
} from '@/lib/gmail-token';

interface AccountSwitcherProps {
  onSignOut: () => void;
}

export function AccountSwitcher({ onSignOut }: AccountSwitcherProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeEmail, setActiveEmailState] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const active = accounts.find((a) => a.email === activeEmail);
  if (!active) return null;

  const initial = (active.displayName || active.email).trim().charAt(0).toUpperCase() || '?';

  const handleSwitch = (email: string) => {
    if (email !== activeEmail) setActiveEmail(email);
    setOpen(false);
  };

  const handleAdd = () => {
    window.location.href = '/api/google/oauth/start';
  };

  const handleRemove = (account: Account) => {
    if (account.source === 'supabase') return;
    if (!confirm(`Remove ${account.email}? You'll need to re-authorize to add it back.`)) return;
    // Best-effort revoke at Google
    fetch('/api/google/oauth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: account.refreshToken }),
    }).catch(() => {});
    removeAccount(account.email);
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '11px',
          fontWeight: 500,
          lineHeight: 1,
          color: 'var(--bg-base)',
          background: 'var(--text-primary)',
          width: '22px',
          height: '22px',
          borderRadius: '9999px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          cursor: 'pointer',
        }}
        title={`${active.email} — switch account`}
        aria-label={`Switch Gmail account (${active.email})`}
      >
        {initial}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: '260px',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-default)',
            zIndex: 50,
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            boxShadow: '0 6px 24px rgba(0,0,0,0.06)',
          }}
        >
          {accounts.map((acc) => (
            <div
              key={acc.email}
              style={{
                display: 'flex',
                alignItems: 'stretch',
              }}
            >
              <button
                onClick={() => handleSwitch(acc.email)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 10px',
                  color: acc.email === activeEmail ? 'var(--text-primary)' : 'var(--text-muted)',
                  background: 'transparent',
                  textAlign: 'left',
                  cursor: 'pointer',
                  minWidth: 0,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <Check
                  size={11}
                  style={{ visibility: acc.email === activeEmail ? 'visible' : 'hidden', flexShrink: 0 }}
                />
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {acc.email}
                </span>
                {acc.source === 'supabase' && (
                  <span
                    style={{
                      fontSize: '10px',
                      color: 'var(--text-muted)',
                      opacity: 0.6,
                      flexShrink: 0,
                    }}
                  >
                    primary
                  </span>
                )}
              </button>
              {acc.source !== 'supabase' && (
                <button
                  onClick={() => handleRemove(acc)}
                  title={`Remove ${acc.email}`}
                  style={{
                    padding: '0 10px',
                    color: 'var(--text-muted)',
                    background: 'transparent',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <X size={11} />
                </button>
              )}
            </div>
          ))}

          <div style={{ borderTop: '1px solid var(--border-default)' }} />

          <button
            onClick={handleAdd}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              color: 'var(--text-muted)',
              background: 'transparent',
              textAlign: 'left',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Plus size={11} />
            add Gmail account
          </button>

          <div style={{ borderTop: '1px solid var(--border-default)' }} />

          <button
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 10px',
              color: 'var(--text-muted)',
              background: 'transparent',
              textAlign: 'left',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-elevated)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <LogOut size={11} />
            sign out
          </button>
        </div>
      )}
    </div>
  );
}
