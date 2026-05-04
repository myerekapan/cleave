export function EmailSkeleton() {
  return (
    <div className="px-4 py-3 space-y-1.5 animate-pulse">
      <div className="flex items-center justify-between gap-2">
        <div
          className="h-2 rounded"
          style={{ width: '40%', background: 'var(--bg-elevated)' }}
        />
        <div
          className="h-2 rounded"
          style={{ width: '10%', background: 'var(--bg-elevated)' }}
        />
      </div>
      <div
        className="h-2.5 rounded"
        style={{ width: '75%', background: 'var(--bg-elevated)' }}
      />
      <div
        className="h-2 rounded"
        style={{ width: '90%', background: 'var(--border-subtle)' }}
      />
    </div>
  );
}

export function SectionSkeleton() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, i) => (
        <EmailSkeleton key={i} />
      ))}
    </div>
  );
}
