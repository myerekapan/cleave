'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { getSnoozePresets, parseSnoozeInput, formatParsedDate, SnoozeOption } from '@/lib/snooze-utils';

interface SnoozeModalProps {
  onSelect: (until: Date, label: string) => void;
  onClose: () => void;
}

export function SnoozeModal({ onSelect, onClose }: SnoozeModalProps) {
  const [input, setInput] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const presets = useMemo(() => getSnoozePresets(), []);
  const parsedDate = useMemo(() => parseSnoozeInput(input), [input]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit(option: SnoozeOption) {
    onSelect(option.until, `${option.label} (${option.sublabel})`);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    e.nativeEvent.stopImmediatePropagation();

    if (e.key === 'Escape') {
      if (input) {
        setInput('');
        setSelectedIndex(0);
      } else {
        onClose();
      }
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (input && parsedDate) {
        onSelect(parsedDate, `${input} (${formatParsedDate(parsedDate)})`);
      } else if (!input && presets[selectedIndex]) {
        submit(presets[selectedIndex]);
      }
      return;
    }

    if (e.key === 'ArrowDown' || (!input && e.key === 'j')) {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, presets.length - 1));
      return;
    }

    if (e.key === 'ArrowUp' || (!input && e.key === 'k')) {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        ref={containerRef}
        className="w-80 outline-none"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <Clock size={14} style={{ color: 'var(--text-muted)' }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-primary)' }}>
            Remind me
          </span>
        </div>

        {/* Input */}
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center justify-between gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => { setInput(e.target.value); setSelectedIndex(0); }}
              placeholder="Try: 8 am, 3 days, aug 7"
              className="flex-1 bg-transparent outline-none"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                color: input ? 'var(--text-primary)' : undefined,
              }}
            />
            {input && parsedDate && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}>
                {formatParsedDate(parsedDate)}
              </span>
            )}
            {input && !parsedDate && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-error, #e55)', flexShrink: 0 }}>
                invalid
              </span>
            )}
          </div>
        </div>

        {/* Presets */}
        <div>
          {presets.map((opt, i) => (
            <button
              key={opt.label}
              className="w-full text-left px-4 py-2.5 flex items-center justify-between"
              style={{
                background: !input && i === selectedIndex ? 'var(--selected-bg)' : 'transparent',
                borderLeft: !input && i === selectedIndex ? '2px solid var(--selected-border)' : '2px solid transparent',
                fontFamily: 'var(--font-mono)',
              }}
              onMouseEnter={() => { if (!input) setSelectedIndex(i); }}
              onClick={() => submit(opt)}
            >
              <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{opt.label}</span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{opt.sublabel}</span>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)' }}>
            ↑↓ navigate · ↵ select · type to set custom time
          </span>
        </div>
      </div>
    </div>
  );
}
