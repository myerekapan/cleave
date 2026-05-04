'use client';

import { useEffect, useRef, useState } from 'react';
import { Mail, Star, Clock, Check, FolderInput, ChevronUp, Reply, ReplyAll, Forward, Undo2 } from 'lucide-react';

interface EmailActionBarProps {
  isStarred?: boolean;
  archiveLabel?: 'archive' | 'unarchive';
  onMarkUnread?: () => void;
  onStar?: () => void;
  onSnooze?: () => void;
  onArchive?: () => void;
  onMoveToSection?: () => void;
  onReply?: () => void;
  onReplyAll?: () => void;
  onForward?: () => void;
}

interface IconButtonProps {
  onClick?: () => void;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}

function IconButton({ onClick, title, active, children }: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        border: '1px solid var(--border-default)',
        background: active ? 'var(--bg-elevated)' : 'var(--bg-base)',
        color: active ? 'var(--accent-bright)' : 'var(--text-secondary)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'background 120ms ease, color 120ms ease',
      }}
    >
      {children}
    </button>
  );
}

export function EmailActionBar({
  isStarred,
  archiveLabel = 'archive',
  onMarkUnread,
  onStar,
  onSnooze,
  onArchive,
  onMoveToSection,
  onReply,
  onReplyAll,
  onForward,
}: EmailActionBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const isUnarchive = archiveLabel === 'unarchive';

  const menuItems: { label: string; icon: React.ReactNode; onClick?: () => void }[] = [
    { label: 'Reply', icon: <Reply size={15} />, onClick: onReply },
    { label: 'Reply All', icon: <ReplyAll size={15} />, onClick: onReplyAll },
    { label: 'Forward', icon: <Forward size={15} />, onClick: onForward },
  ];

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
      style={{
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--bg-base)',
      }}
    >
      <IconButton onClick={onMarkUnread} title="Mark unread (U)">
        <Mail size={15} />
      </IconButton>
      <IconButton onClick={onStar} title="Star (S)" active={isStarred}>
        <Star size={15} fill={isStarred ? 'currentColor' : 'none'} />
      </IconButton>
      <IconButton onClick={onSnooze} title="Snooze (H)">
        <Clock size={15} />
      </IconButton>
      <IconButton onClick={onArchive} title={isUnarchive ? 'Unarchive (E)' : 'Archive (E)'}>
        {isUnarchive ? <Undo2 size={15} /> : <Check size={15} />}
      </IconButton>
      <IconButton onClick={onMoveToSection} title="Move to section">
        <FolderInput size={15} />
      </IconButton>

      <div ref={wrapperRef} className="flex-1 flex items-center relative" style={{ minWidth: 0 }}>
        <button
          onClick={onReplyAll}
          title="Reply All (Enter)"
          style={{
            flex: 1,
            minWidth: 0,
            height: '36px',
            paddingLeft: '16px',
            paddingRight: '36px',
            borderRadius: '999px',
            border: '1px solid var(--border-default)',
            background: 'var(--bg-elevated)',
            color: 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            textAlign: 'left',
            cursor: 'pointer',
            position: 'relative',
          }}
        >
          Reply All
        </button>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          title="Reply options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={{
            position: 'absolute',
            right: '4px',
            top: '50%',
            transform: 'translateY(-50%)',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <ChevronUp
            size={14}
            style={{
              transform: menuOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 150ms ease',
            }}
          />
        </button>

        {menuOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              bottom: 'calc(100% + 6px)',
              right: 0,
              minWidth: '200px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: '10px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)',
              padding: '4px',
              zIndex: 50,
            }}
          >
            {menuItems.map((item) => (
              <button
                key={item.label}
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  item.onClick?.();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '6px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                  textAlign: 'left',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-elevated)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <span>{item.label}</span>
                <span style={{ color: 'var(--text-muted)', display: 'inline-flex' }}>{item.icon}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
