'use client';

interface Key {
  keys: string[];
  label: string;
}

const KEYS: Key[] = [
  { keys: ['E'], label: 'archive' },
  { keys: ['Z'], label: 'undo' },
  { keys: ['J', 'K'], label: 'nav' },
  { keys: ['Tab'], label: 'sections' },
  { keys: ['S'], label: 'star' },
  { keys: ['R'], label: 'reply' },
  { keys: ['F'], label: 'fwd' },
  { keys: ['U'], label: 'read' },
  { keys: ['M'], label: 'mute' },
  { keys: ['C'], label: 'compose' },
  { keys: ['⌘K'], label: 'commands' },
  { keys: ['?'], label: 'help' },
];

export function CommandBar() {
  return (
    <div
      className="flex items-center gap-4 px-4 py-2 flex-shrink-0 overflow-x-auto"
      style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-base)',
      }}
    >
      {KEYS.map(({ keys, label }) => (
        <div
          key={label}
          className="flex items-center gap-1.5 flex-shrink-0"
        >
          <div className="flex items-center gap-0.5">
            {keys.map((k) => (
              <kbd
                key={k}
                className="px-1.5 py-0.5 text-center"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-default)',
                  borderRadius: '2px',
                  lineHeight: '1.4',
                  minWidth: '18px',
                }}
              >
                {k}
              </kbd>
            ))}
          </div>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--text-muted)',
            }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}
