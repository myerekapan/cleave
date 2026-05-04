'use client';

import { useEffect, useRef, useState } from 'react';

interface Option {
  id: string;
  label: string;
  sublabel?: string;
}

interface PickerModalProps {
  title: string;
  options: Option[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function PickerModal({ title, options, onSelect, onClose }: PickerModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    e.nativeEvent.stopImmediatePropagation();
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, options.length - 1));
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter' && options[selectedIndex]) {
      e.preventDefault();
      onSelect(options[selectedIndex].id);
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
        tabIndex={0}
        className="w-72 outline-none"
        style={{
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-default)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em' }}>
            {title}
          </p>
        </div>
        <div>
          {options.map((opt, i) => (
            <button
              key={opt.id}
              className="w-full text-left px-4 py-2.5"
              style={{
                background: i === selectedIndex ? 'var(--selected-bg)' : 'transparent',
                borderLeft: i === selectedIndex ? '2px solid var(--selected-border)' : '2px solid transparent',
                fontFamily: 'var(--font-mono)',
              }}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => onSelect(opt.id)}
            >
              <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{opt.label}</span>
              {opt.sublabel && (
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '8px' }}>{opt.sublabel}</span>
              )}
            </button>
          ))}
        </div>
        <div className="px-4 py-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)' }}>
            ↑↓ navigate · ↵ select · Esc close
          </span>
        </div>
      </div>
    </div>
  );
}
