'use client';

import { useEffect, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  action: () => void;
}

interface CommandPaletteProps {
  commands: Command[];
  onClose: () => void;
}

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? commands.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
    : commands;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  function execute(cmd: Command) {
    onClose();
    cmd.action();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && filtered[selectedIndex]) {
      e.preventDefault();
      execute(filtered[selectedIndex]);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: 'rgba(0,0,0,0.3)', paddingTop: '15vh' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md flex flex-col"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
          borderRadius: '8px',
          overflow: 'hidden',
          maxHeight: '60vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div
          className="flex items-center gap-3 px-4"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command..."
            className="flex-1 py-3 outline-none bg-transparent"
            style={{
              fontSize: '14px',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        {/* Commands */}
        <div className="overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-3">
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No commands match</p>
            </div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                className="w-full text-left px-4 py-2.5 flex items-center justify-between gap-4"
                style={{
                  background: i === selectedIndex ? 'var(--selected-bg)' : 'transparent',
                  borderLeft: i === selectedIndex ? '2px solid var(--selected-border)' : '2px solid transparent',
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => execute(cmd)}
              >
                <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>
                  {cmd.label}
                </span>
                {cmd.shortcut && (
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
                    {cmd.shortcut}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-2"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)' }}>
            ↑↓ navigate · ↵ execute · Esc close
          </span>
        </div>
      </div>
    </div>
  );
}
