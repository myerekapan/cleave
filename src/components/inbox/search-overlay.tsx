'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ParsedEmail } from '@/types/gmail';
import { searchThreads } from '@/lib/gmail';
import { GmailApiError } from '@/types/gmail';
import { getAccessToken } from '@/lib/gmail-token';
import { X, Search, Clock, Star, Paperclip } from 'lucide-react';
import { formatEmailDate } from '@/lib/date-utils';

interface SearchOverlayProps {
  onClose: () => void;
  onPreview: (email: ParsedEmail) => void;
}

const SEARCH_CHIPS = [
  { label: 'from:', insert: 'from:' },
  { label: 'to:', insert: 'to:' },
  { label: 'subject:', insert: 'subject:' },
  { label: 'has:attachment', insert: 'has:attachment ' },
  { label: 'is:unread', insert: 'is:unread ' },
  { label: 'is:starred', insert: 'is:starred ' },
  { label: 'newer_than:7d', insert: 'newer_than:7d ' },
];

const STORAGE_KEY = 'cleave-recent-searches';
const MAX_RECENT = 8;

function getRecentSearches(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  } catch { return []; }
}

function addRecentSearch(query: string) {
  const recent = getRecentSearches().filter((q) => q !== query);
  recent.unshift(query);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

function clearRecentSearches() {
  localStorage.removeItem(STORAGE_KEY);
}

export function SearchOverlay({ onClose, onPreview }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ParsedEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    setRecentSearches(getRecentSearches());
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      const token = getAccessToken();
      if (!token) { setLoading(false); return; }
      try {
        // Append wildcard for prefix matching unless the query contains operators
        const raw = query.trim();
        const hasOperator = /[:\s"]/.test(raw);
        const q = hasOperator ? raw : `${raw}*`;
        const found = await searchThreads(token, q, 10);
        setResults(found);
        setSelectedIndex(0);
      } catch (err) {
        // On rate limit, wait and retry once
        if (err instanceof GmailApiError && (err.status === 429 || err.status === 403)) {
          await new Promise((r) => setTimeout(r, 2000));
          try {
            const retryToken = getAccessToken();
            if (retryToken) {
              const found = await searchThreads(retryToken, query.trim(), 10);
              setResults(found);
              setSelectedIndex(0);
              return;
            }
          } catch { /* fall through */ }
        }
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 600);

    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  // Scroll selected result into view
  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const item = container.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const openResult = useCallback((email: ParsedEmail) => {
    addRecentSearch(query.trim());
    onPreview(email);
    onClose();
  }, [query, onPreview, onClose]);

  function insertChip(insert: string) {
    setQuery((prev) => prev + insert);
    inputRef.current?.focus();
  }

  function applyRecentSearch(q: string) {
    setQuery(q);
    inputRef.current?.focus();
  }

  function handleClearRecent() {
    clearRecentSearches();
    setRecentSearches([]);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return; }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!query.trim() && results.length === 0) {
        // Navigate recent searches
        setSelectedIndex((i) => Math.min(i + 1, recentSearches.length - 1));
      } else {
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!query.trim() && recentSearches[selectedIndex]) {
        applyRecentSearch(recentSearches[selectedIndex]);
      } else if (results[selectedIndex]) {
        openResult(results[selectedIndex]);
      }
    }
  }

  const showEmpty = !query.trim();
  const showResults = !showEmpty && results.length > 0;
  const showNoResults = !showEmpty && !loading && query.trim() && results.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', paddingTop: '12vh' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl flex flex-col"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          maxHeight: '70vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input row */}
        <div
          className="flex items-center gap-3 px-4"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search mail..."
            className="flex-1 py-3 outline-none bg-transparent"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              color: 'var(--text-primary)',
            }}
          />
          {loading && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
              searching...
            </span>
          )}
          <kbd style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            color: 'var(--text-muted)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: '3px',
            padding: '1px 5px',
            flexShrink: 0,
          }}>
            /
          </kbd>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>
            <X size={13} />
          </button>
        </div>

        {/* Search chips */}
        <div
          className="flex items-center gap-1.5 px-4 py-2 flex-wrap"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          {SEARCH_CHIPS.map((chip) => (
            <button
              key={chip.label}
              onClick={() => insertChip(chip.insert)}
              className="inline-flex items-center"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '10px',
                color: 'var(--text-secondary)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-subtle)',
                padding: '2px 8px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* Empty state: recent searches */}
        {showEmpty && recentSearches.length > 0 && (
          <div className="overflow-y-auto">
            <div
              className="px-4 py-2 flex items-center justify-between"
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
                RECENT SEARCHES
              </span>
              <button
                onClick={handleClearRecent}
                style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                clear
              </button>
            </div>
            {recentSearches.map((q, i) => (
              <button
                key={q}
                className="w-full text-left px-4 py-2 flex items-center gap-3"
                style={{
                  background: i === selectedIndex ? 'var(--bg-elevated)' : 'transparent',
                  borderLeft: i === selectedIndex ? '2px solid var(--text-accent)' : '2px solid transparent',
                }}
                onClick={() => applyRecentSearch(q)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <Clock size={11} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' }}>
                  {q}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        {showResults && (
          <div className="overflow-y-auto" ref={resultsRef}>
            {results.map((email, i) => (
              <button
                key={email.id}
                className="w-full text-left px-4 py-2.5"
                style={{
                  background: i === selectedIndex ? 'var(--bg-elevated)' : 'transparent',
                  borderBottom: '1px solid var(--border-subtle)',
                  borderLeft: i === selectedIndex ? '2px solid var(--text-accent)' : '2px solid transparent',
                }}
                onClick={() => openResult(email)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div className="flex items-start gap-3 min-w-0">
                  {/* Unread dot */}
                  <div
                    className="flex-shrink-0"
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: email.isUnread ? 'var(--unread-dot)' : 'transparent',
                      marginTop: '6px',
                    }}
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    {/* Row 1: sender + date */}
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="text-xs truncate"
                          style={{
                            fontFamily: 'var(--font-mono)',
                            color: email.isUnread ? 'var(--text-primary)' : 'var(--text-muted)',
                            fontWeight: email.isUnread ? '600' : '400',
                            letterSpacing: '-0.01em',
                          }}
                        >
                          {email.fromName || email.fromEmail}
                        </span>
                        {email.isStarred && <Star size={10} fill="currentColor" stroke="currentColor" style={{ flexShrink: 0, color: 'var(--accent-bright)' }} />}
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontSize: '10px', fontWeight: '300', flexShrink: 0 }}>
                        {formatEmailDate(email.date)}
                      </span>
                    </div>

                    {/* Row 2: subject + thread count + attachment */}
                    <div className="flex items-baseline gap-1.5 min-w-0">
                      <p
                        className="text-xs truncate"
                        style={{
                          color: email.isUnread ? 'var(--text-accent)' : 'var(--text-muted)',
                          fontWeight: email.isUnread ? '600' : '400',
                          fontSize: '12px',
                          minWidth: 0,
                        }}
                      >
                        {email.subject}
                      </p>
                      {(email.messageCount ?? 1) > 1 && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>
                          ({email.messageCount})
                        </span>
                      )}
                      {email.hasAttachments && (
                        <Paperclip size={10} style={{ color: 'var(--text-muted)', flexShrink: 0, opacity: 0.65 }} />
                      )}
                    </div>

                    {/* Row 3: snippet */}
                    <p
                      className="text-xs truncate"
                      style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: '300' }}
                    >
                      {email.snippet}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {showNoResults && (
          <div className="px-4 py-4">
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
              no results for &ldquo;{query.trim()}&rdquo;
            </p>
          </div>
        )}

        {/* Footer hint */}
        <div
          className="px-4 py-2 flex items-center gap-4"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)' }}>
            ↵ open · ↑↓ navigate · Esc close
          </span>
        </div>
      </div>
    </div>
  );
}
