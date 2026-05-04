'use client';

import { Section } from '@/types/preferences';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';

interface SidebarFolder {
  id: string;
  name: string;
  gmailLabel: string | null;
  indent?: boolean;
}

const SYSTEM_FOLDERS: SidebarFolder[] = [
  { id: 'go-inbox', name: 'Inbox', gmailLabel: null },
  { id: 'go-important', name: 'Important', gmailLabel: 'IMPORTANT', indent: true },
  { id: 'go-other', name: 'Other', gmailLabel: 'CATEGORY_PROMOTIONS', indent: true },
  { id: 'go-starred', name: 'Starred', gmailLabel: 'STARRED' },
  { id: 'go-drafts', name: 'Drafts', gmailLabel: 'DRAFT' },
  { id: 'go-sent', name: 'Sent', gmailLabel: 'SENT' },
  { id: 'go-snoozed', name: 'Snoozed', gmailLabel: 'snoozed' },
  { id: 'go-done', name: 'Done', gmailLabel: 'done' },
  { id: 'go-all', name: 'All Mail', gmailLabel: 'all' },
  { id: 'go-spam', name: 'Spam', gmailLabel: 'SPAM' },
  { id: 'go-trash', name: 'Trash', gmailLabel: 'TRASH' },
];

interface SidebarMenuProps {
  userEmail?: string;
  sections: Section[];
  activeSectionId: string;
  specialViewId: string | null;
  onNavigateFolder: (folder: SidebarFolder) => void;
  onNavigateSection: (sectionId: string) => void;
  onClose: () => void;
}

export function SidebarMenu({
  userEmail,
  sections,
  activeSectionId,
  specialViewId,
  onNavigateFolder,
  onNavigateSection,
  onClose,
}: SidebarMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const isActiveFolder = (folder: SidebarFolder) => {
    if (folder.id === 'go-inbox' && !specialViewId && activeSectionId === 'primary') return true;
    return specialViewId === folder.id;
  };

  const cleaveSubSections = sections.filter((s) => s.gmailLabel !== null);

  return (
    <div
      className="fixed inset-0 z-50 flex"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.3)' }} />

      {/* Sidebar panel */}
      <div
        ref={panelRef}
        className="relative flex flex-col h-full overflow-y-auto"
        style={{
          width: '280px',
          background: 'var(--bg-surface)',
          borderRight: '1px solid var(--border-default)',
          animation: 'slideIn 150ms ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* User header */}
        <div
          className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'var(--accent-bright)',
              color: 'var(--bg-base)',
              fontSize: '13px',
              fontWeight: '500',
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
            }}
          >
            {userEmail?.charAt(0).toUpperCase() ?? '?'}
          </div>
          <span
            className="truncate flex-1"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--text-primary)',
            }}
          >
            {userEmail}
          </span>
          <button
            onClick={onClose}
            style={{ color: 'var(--text-muted)', flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        </div>

        {/* System folders */}
        <div className="py-2">
          {SYSTEM_FOLDERS.map((folder) => {
            const active = isActiveFolder(folder);
            return (
              <button
                key={folder.id}
                className="w-full text-left px-5 py-2 transition-colors"
                style={{
                  paddingLeft: folder.indent ? '40px' : '20px',
                  fontFamily: 'var(--font-sans)',
                  fontSize: '13px',
                  fontWeight: active ? '500' : '400',
                  color: active ? 'var(--accent-bright)' : 'var(--text-primary)',
                  background: active ? 'var(--selected-bg)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = active ? 'var(--selected-bg)' : 'transparent';
                }}
                onClick={() => {
                  onNavigateFolder(folder);
                  onClose();
                }}
              >
                {folder.name}
              </button>
            );
          })}
        </div>

        {/* Divider */}
        {cleaveSubSections.length > 0 && (
          <>
            <div
              className="mx-5"
              style={{ height: '1px', background: 'var(--border-default)' }}
            />

            {/* Cleave label */}
            <div className="px-5 pt-4 pb-2">
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: 'var(--accent-bright)',
                  fontWeight: '500',
                }}
              >
                Cleave
              </span>
            </div>

            {/* Cleave sections */}
            <div className="pb-4">
              {cleaveSubSections.map((section) => {
                const active = !specialViewId && activeSectionId === section.id;
                return (
                  <button
                    key={section.id}
                    className="w-full text-left px-8 py-2 transition-colors"
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: '13px',
                      fontWeight: active ? '500' : '400',
                      color: active ? 'var(--accent-bright)' : 'var(--text-secondary)',
                      background: active ? 'var(--selected-bg)' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!active) e.currentTarget.style.background = 'var(--bg-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = active ? 'var(--selected-bg)' : 'transparent';
                    }}
                    onClick={() => {
                      onNavigateSection(section.id);
                      onClose();
                    }}
                  >
                    {section.name}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(-100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
