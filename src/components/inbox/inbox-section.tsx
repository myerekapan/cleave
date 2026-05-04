'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Section } from '@/types/preferences';
import { GmailApiError, ParsedEmail } from '@/types/gmail';
import { fetchSectionEmails, getSnoozeLabelId, listFilters, modifyMessage, modifyThread, snoozeThread, unsnoozeThread } from '@/lib/gmail';
import { ComposeState } from './compose-pane';
import { getAccessToken, getActiveEmail } from '@/lib/gmail-token';
import { EmailRow } from './email-row';
import { SectionSkeleton } from '@/components/ui/loading-skeleton';
import { toast } from 'sonner';
import { bucketLabel, dayBucket, type DayBucket } from '@/lib/date-utils';

const REFRESH_INTERVAL_MS = 60_000;

interface InboxSectionProps {
  section: Section;
  sectionIndex: number;
  isActive: boolean;
  activeEmailIndex: number;
  hideHeader?: boolean;
  isSpecialView?: boolean;
  allSections?: Section[];
  userEmail?: string;
  onEmailCountChange?: (count: number) => void;
  onHasMoreChange?: (hasMore: boolean) => void;
  onUnreadCountChange?: (count: number) => void;
  onSectionClick: () => void;
  onEmailSelect?: (index: number) => void;
  onPreviewEmail?: (email: ParsedEmail) => void;
  onCompose?: (state: ComposeState) => void;
  onUndoReady?: (fn: (() => void) | null) => void;
  onSelectedEmailChange?: (email: ParsedEmail | null) => void;
  onRequestSnooze?: () => void;
}

export function InboxSection({
  section,
  sectionIndex,
  isActive,
  activeEmailIndex,
  hideHeader = false,
  isSpecialView = false,
  allSections = [],
  onEmailCountChange,
  onHasMoreChange,
  onUnreadCountChange,
  onSectionClick,
  onEmailSelect,
  onPreviewEmail,
  onCompose,
  onUndoReady,
  onSelectedEmailChange,
  onRequestSnooze,
  userEmail,
}: InboxSectionProps) {
  const sectionLabelIds = useMemo(
    () => allSections.map((s) => s.gmailLabel).filter((id): id is string => id !== null),
    [allSections]
  );
  const [emails, setEmails] = useState<ParsedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const selectedRef = useRef<HTMLDivElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const emailsRef = useRef<ParsedEmail[]>([]);
  emailsRef.current = emails;

  // Scope the cache by active account so swapping accounts doesn't show
  // the previous account's threads. The component is also remounted on
  // account change (key includes activeEmail in split-inbox) so this is
  // computed fresh per instance.
  const cacheKey = `cleave:emails:${getActiveEmail() ?? 'legacy'}:${section.gmailLabel ?? 'primary'}`;

  async function loadEmails(silent = false) {
    if (!silent) setLoading(true);
    setError(null);

    try {
      const token = getAccessToken();
      if (!token) { setError('not authenticated'); if (!silent) setLoading(false); return; }
      // Pass existing emails (from memory or localStorage cache) so fetchSectionEmails
      // can skip re-fetching threads that are already known
      let existing = emailsRef.current.length > 0 ? emailsRef.current : undefined;
      if (!existing) {
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) existing = JSON.parse(cached) as ParsedEmail[];
        } catch { /* ignore corrupt cache */ }
      }
      // For Done view, exclude emails that still have any Cleave label (section labels + snooze)
      const isDone = section.gmailLabel === 'done';
      const excludeIds = isDone
        ? [...sectionLabelIds, ...(getSnoozeLabelId() ? [getSnoozeLabelId()!] : [])]
        : undefined;
      const { emails: results, hasMore: more } = await fetchSectionEmails(token, section.gmailLabel, 100, existing, excludeIds);
      setEmails(results);
      setHasMore(more);
      onEmailCountChange?.(results.length);
      onHasMoreChange?.(more);
      setLastUpdated(new Date());
      // Persist to localStorage for next page load
      try { localStorage.setItem(cacheKey, JSON.stringify(results)); } catch { /* storage full */ }
    } catch (err) {
      const isRateLimit = err instanceof GmailApiError && (err.status === 429 || err.status === 403);
      if (!silent) {
        setError(isRateLimit ? 'rate limited — try again in a moment' : 'failed to load');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    // Stagger initial fetches to avoid Gmail rate limits when all sections mount at once
    const delay = sectionIndex * 300;
    const t = setTimeout(() => loadEmails(), delay);
    return () => clearTimeout(t);
  }, [section.gmailLabel, section.id]); // eslint-disable-line
  useEffect(() => {
    intervalRef.current = setInterval(() => loadEmails(true), REFRESH_INTERVAL_MS);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [section.gmailLabel, section.id]); // eslint-disable-line
  useEffect(() => { onUnreadCountChange?.(emails.filter((e) => e.isUnread).length); }, [emails]); // eslint-disable-line
  useEffect(() => { onSelectedEmailChange?.(emails[activeEmailIndex] ?? null); }, [emails, activeEmailIndex]); // eslint-disable-line
  useEffect(() => { selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [activeEmailIndex]);

  // Archive single email (with undo toast)
  // In special views (Sent, Starred, etc.), toggles archive state and keeps the email in the list.
  // Resolve the section a sender belongs to by checking Gmail filters against known sections.
  async function resolveSection(token: string, senderEmail: string): Promise<{ label: string; name: string } | null> {
    try {
      const filters = await listFilters(token);
      const sectionLabels = new Set(allSections.filter((s) => s.gmailLabel).map((s) => s.gmailLabel));
      for (const f of filters) {
        const from = f.criteria.from?.toLowerCase() ?? '';
        const sender = senderEmail.toLowerCase();
        // Match full email or @domain
        if (from && (sender === from || sender.endsWith(from.startsWith('@') ? from : `@${from}`))) {
          const labelId = f.action.addLabelIds?.find((id) => sectionLabels.has(id));
          if (labelId) {
            const sec = allSections.find((s) => s.gmailLabel === labelId);
            if (sec) return { label: labelId, name: sec.name };
          }
        }
      }
    } catch { /* filter lookup failed, fall back */ }
    return null;
  }

  // Archive / unarchive a single email.
  // In special views, checks Gmail filters to restore to the correct section on unarchive.
  async function archiveEmail(email: ParsedEmail) {
    const token = getAccessToken();
    if (!token || archivingId) return;
    setArchivingId(email.id);

    if (isSpecialView) {
      const inInbox = email.labelIds.includes('INBOX');
      const originalLabels = email.labelIds;

      if (inInbox) {
        // Archive: remove INBOX
        const updatedLabels = email.labelIds.filter((l) => l !== 'INBOX');
        setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, labelIds: updatedLabels } : e)));
        try {
          await modifyThread(token, email.threadId, { removeLabelIds: ['INBOX'] });
          window.dispatchEvent(new CustomEvent('cleave:refresh', { detail: { sectionId: 'primary' } }));
          const undoFn = async () => {
            const t = getAccessToken();
            if (!t) return;
            try {
              await modifyThread(t, email.threadId, { addLabelIds: ['INBOX'] });
              setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, labelIds: originalLabels } : e)));
              window.dispatchEvent(new CustomEvent('cleave:refresh', { detail: { sectionId: 'primary' } }));
            } catch { toast.error('undo failed'); }
          };
          onUndoReady?.(undoFn);
          toast('archived', {
            action: { label: 'undo (Z)', onClick: undoFn },
            duration: 3000,
            onDismiss: () => onUndoReady?.(null),
            onAutoClose: () => onUndoReady?.(null),
          });
        } catch (err) {
          setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, labelIds: originalLabels } : e)));
          toast.error(`failed: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      } else {
        // Unarchive: look up Gmail filters to find the right section, fallback to INBOX
        const match = await resolveSection(token, email.fromEmail);
        const restoreLabel = match?.label ?? 'INBOX';
        const restoreName = match?.name ?? 'Inbox';
        const updatedLabels = [...email.labelIds, restoreLabel];
        setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, labelIds: updatedLabels } : e)));
        try {
          await modifyThread(token, email.threadId, { addLabelIds: [restoreLabel] });
          // Refresh the target section so the email appears there
          const targetSectionId = restoreLabel === 'INBOX' ? 'primary' : allSections.find((s) => s.gmailLabel === restoreLabel)?.id;
          if (targetSectionId) window.dispatchEvent(new CustomEvent('cleave:refresh', { detail: { sectionId: targetSectionId } }));
          const undoFn = async () => {
            const t = getAccessToken();
            if (!t) return;
            try {
              await modifyThread(t, email.threadId, { removeLabelIds: [restoreLabel] });
              setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, labelIds: originalLabels } : e)));
              if (targetSectionId) window.dispatchEvent(new CustomEvent('cleave:refresh', { detail: { sectionId: targetSectionId } }));
            } catch { toast.error('undo failed'); }
          };
          onUndoReady?.(undoFn);
          toast(`moved to ${restoreName}`, {
            action: { label: 'undo (Z)', onClick: undoFn },
            duration: 3000,
            onDismiss: () => onUndoReady?.(null),
            onAutoClose: () => onUndoReady?.(null),
          });
        } catch (err) {
          setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, labelIds: originalLabels } : e)));
          toast.error(`failed: ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }
      setArchivingId(null);
      return;
    }

    const originalEmails = emails;
    const emailIndex = emails.findIndex((e) => e.id === email.id);
    setEmails((prev) => prev.filter((e) => e.id !== email.id));
    onEmailCountChange?.(emails.length - 1);
    const removeLabels = section.gmailLabel ? [section.gmailLabel] : ['INBOX'];
    try {
      await modifyThread(token, email.threadId, { removeLabelIds: removeLabels });
      const undoFn = async () => {
        const t = getAccessToken();
        if (!t) return;
        try {
          await modifyThread(t, email.threadId, { addLabelIds: removeLabels });
          setEmails((prev) => {
            const next = [...prev];
            next.splice(Math.min(emailIndex, prev.length), 0, email);
            onEmailCountChange?.(next.length);
            return next;
          });
        } catch { toast.error('undo failed'); }
      };
      onUndoReady?.(undoFn);
      toast('archived', {
        action: { label: 'undo (Z)', onClick: undoFn },
        duration: 3000,
        onDismiss: () => onUndoReady?.(null),
        onAutoClose: () => onUndoReady?.(null),
      });
    } catch (err) {
      setEmails(originalEmails);
      onEmailCountChange?.(originalEmails.length);
      toast.error(`archive failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setArchivingId(null);
    }
  }

  // Archive all emails in this section (with undo toast)
  async function archiveAll() {
    const token = getAccessToken();
    if (!token || emails.length === 0) return;
    const snapshot = [...emails];
    const removeLabels = section.gmailLabel ? [section.gmailLabel] : ['INBOX'];
    setEmails([]);
    onEmailCountChange?.(0);
    try {
      await Promise.all(snapshot.map((e) => modifyThread(token, e.threadId, { removeLabelIds: removeLabels })));
      const undoFn = async () => {
        const t = getAccessToken();
        if (!t) return;
        try {
          await Promise.all(snapshot.map((e) => modifyThread(t, e.threadId, { addLabelIds: removeLabels })));
          setEmails(snapshot);
          onEmailCountChange?.(snapshot.length);
        } catch { toast.error('undo failed'); }
      };
      onUndoReady?.(undoFn);
      toast(`archived ${snapshot.length}`, {
        action: { label: 'undo (Z)', onClick: undoFn },
        duration: 3000,
        onDismiss: () => onUndoReady?.(null),
        onAutoClose: () => onUndoReady?.(null),
      });
    } catch (err) {
      setEmails(snapshot);
      onEmailCountChange?.(snapshot.length);
      toast.error(`archive all failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  async function toggleReadUnread(email: ParsedEmail) {
    const token = getAccessToken();
    if (!token) return;
    const wasUnread = email.isUnread;
    setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, isUnread: !wasUnread } : e)));
    try {
      await modifyThread(token, email.threadId, wasUnread ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] });
    } catch {
      setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, isUnread: wasUnread } : e)));
      toast.error('mark read/unread failed');
    }
  }

  async function toggleStar(email: ParsedEmail) {
    const token = getAccessToken();
    if (!token) return;
    const wasStarred = email.isStarred;
    setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, isStarred: !wasStarred } : e)));
    try {
      await modifyMessage(token, email.id, wasStarred ? { removeLabelIds: ['STARRED'] } : { addLabelIds: ['STARRED'] });
      toast.success(wasStarred ? 'unstarred' : 'starred');
    } catch {
      setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, isStarred: wasStarred } : e)));
      toast.error('star failed');
    }
  }

  async function toggleImportant(email: ParsedEmail) {
    const token = getAccessToken();
    if (!token) return;
    const was = email.isImportant ?? false;
    setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, isImportant: !was } : e)));
    try {
      await modifyMessage(token, email.id, was ? { removeLabelIds: ['IMPORTANT'] } : { addLabelIds: ['IMPORTANT'] });
    } catch {
      setEmails((prev) => prev.map((e) => (e.id === email.id ? { ...e, isImportant: was } : e)));
      toast.error('mark important failed');
    }
  }

  async function muteEmail(email: ParsedEmail) {
    const token = getAccessToken();
    if (!token) return;
    const originalEmails = emails;
    setEmails((prev) => prev.filter((e) => e.id !== email.id));
    onEmailCountChange?.(emails.length - 1);
    try {
      await modifyThread(token, email.threadId, { addLabelIds: ['MUTED'], removeLabelIds: ['INBOX'] });
      toast.success('thread muted');
    } catch {
      setEmails(originalEmails);
      onEmailCountChange?.(originalEmails.length);
      toast.error('mute failed');
    }
  }

  // Custom events
  useEffect(() => {
    const on = (name: string, fn: EventListener) => window.addEventListener(name, fn);
    const off = (name: string, fn: EventListener) => window.removeEventListener(name, fn);

    const archiveHandler = (e: CustomEvent<{ sectionId: string }>) => {
      if (e.detail.sectionId !== section.id) return;
      const email = emails[activeEmailIndex];
      if (email) archiveEmail(email);
    };
    const archiveAllHandler = (e: CustomEvent<{ sectionId: string }>) => {
      if (e.detail.sectionId !== section.id) return;
      archiveAll();
    };
    const openHandler = (e: CustomEvent<{ sectionIndex: number; emailIndex: number }>) => {
      if (e.detail.sectionIndex !== sectionIndex) return;
      const email = emails[e.detail.emailIndex];
      if (!email) return;
      if (email.isUnread) toggleReadUnread(email);
      onPreviewEmail?.(email);
    };
    const replyHandler = (e: CustomEvent<{ sectionId: string }>) => {
      if (e.detail.sectionId !== section.id) return;
      const email = emails[activeEmailIndex];
      if (email) onCompose?.({ mode: 'reply', email });
    };
    const forwardHandler = (e: CustomEvent<{ sectionId: string }>) => {
      if (e.detail.sectionId !== section.id) return;
      const email = emails[activeEmailIndex];
      if (email) onCompose?.({ mode: 'forward', email });
    };
    const markUnreadHandler = (e: CustomEvent<{ sectionId: string }>) => {
      if (e.detail.sectionId !== section.id) return;
      const email = emails[activeEmailIndex];
      if (email) toggleReadUnread(email);
    };
    const starHandler = (e: CustomEvent<{ sectionId: string }>) => {
      if (e.detail.sectionId !== section.id) return;
      const email = emails[activeEmailIndex];
      if (email) toggleStar(email);
    };
    const importantHandler = (e: CustomEvent<{ sectionId: string }>) => {
      if (e.detail.sectionId !== section.id) return;
      const email = emails[activeEmailIndex];
      if (email) toggleImportant(email);
    };
    const muteHandler = (e: CustomEvent<{ sectionId: string }>) => {
      if (e.detail.sectionId !== section.id) return;
      const email = emails[activeEmailIndex];
      if (email) muteEmail(email);
    };
    const snoozeHandler = (e: CustomEvent<{ sectionId: string; label: string; until: string }>) => {
      if (e.detail.sectionId !== section.id) return;
      const email = emails[activeEmailIndex];
      if (!email) return;
      const token = getAccessToken();
      if (!token || !userEmail) return;
      const originalEmails = emails;
      setEmails((prev) => prev.filter((em) => em.id !== email.id));
      onEmailCountChange?.(emails.length - 1);
      snoozeThread(token, email.threadId, userEmail, new Date(e.detail.until), email.subject).then(() => {
        const undoFn = async () => {
          const t = getAccessToken();
          if (!t) return;
          try {
            await unsnoozeThread(t, email.threadId);
            setEmails(originalEmails);
            onEmailCountChange?.(originalEmails.length);
          } catch { toast.error('undo failed'); }
        };
        onUndoReady?.(undoFn);
        toast.success(`snoozed until ${e.detail.label}`, {
          action: { label: 'Undo', onClick: () => { undoFn(); } },
        });
      }).catch(() => {
        setEmails(originalEmails);
        onEmailCountChange?.(originalEmails.length);
        toast.error('snooze failed');
      });
    };

    const refreshHandler = (e: CustomEvent<{ sectionId: string }>) => {
      if (e.detail.sectionId !== section.id) return;
      loadEmails(true);
    };
    const removeThreadsHandler = (e: CustomEvent<{ threadIds: string[]; sectionId: string }>) => {
      if (e.detail.sectionId !== section.id) return;
      const idsToRemove = new Set(e.detail.threadIds);
      setEmails((prev) => {
        const next = prev.filter((em) => !idsToRemove.has(em.threadId));
        onEmailCountChange?.(next.length);
        return next;
      });
    };
    const syncEmailHandler = (e: CustomEvent<{ threadId: string; isStarred?: boolean; isUnread?: boolean; isImportant?: boolean }>) => {
      const { threadId, isStarred, isUnread, isImportant } = e.detail;
      setEmails((prev) => prev.map((em) => {
        if (em.threadId !== threadId) return em;
        return {
          ...em,
          ...(isStarred !== undefined ? { isStarred } : {}),
          ...(isUnread !== undefined ? { isUnread } : {}),
          ...(isImportant !== undefined ? { isImportant } : {}),
        };
      }));
    };

    on('cleave:refresh', refreshHandler as EventListener);
    on('cleave:remove-threads', removeThreadsHandler as EventListener);
    on('cleave:sync-email', syncEmailHandler as EventListener);
    on('cleave:archive', archiveHandler as EventListener);
    on('cleave:archive-all', archiveAllHandler as EventListener);
    on('cleave:open', openHandler as EventListener);
    on('cleave:reply', replyHandler as EventListener);
    on('cleave:forward', forwardHandler as EventListener);
    on('cleave:mark-unread', markUnreadHandler as EventListener);
    on('cleave:star', starHandler as EventListener);
    on('cleave:important', importantHandler as EventListener);
    on('cleave:mute', muteHandler as EventListener);
    on('cleave:snooze', snoozeHandler as EventListener);

    return () => {
      off('cleave:refresh', refreshHandler as EventListener);
      off('cleave:remove-threads', removeThreadsHandler as EventListener);
      off('cleave:sync-email', syncEmailHandler as EventListener);
      off('cleave:archive', archiveHandler as EventListener);
      off('cleave:archive-all', archiveAllHandler as EventListener);
      off('cleave:open', openHandler as EventListener);
      off('cleave:reply', replyHandler as EventListener);
      off('cleave:forward', forwardHandler as EventListener);
      off('cleave:mark-unread', markUnreadHandler as EventListener);
      off('cleave:star', starHandler as EventListener);
      off('cleave:important', importantHandler as EventListener);
      off('cleave:mute', muteHandler as EventListener);
      off('cleave:snooze', snoozeHandler as EventListener);
    };
  }, [section.id, sectionIndex, emails, activeEmailIndex, archivingId]); // eslint-disable-line

  const unreadCount = emails.filter((e) => e.isUnread).length;

  function formatLastUpdated(date: Date): string {
    const secs = Math.floor((Date.now() - date.getTime()) / 1000);
    if (secs < 10) return 'just now';
    if (secs < 60) return `${secs}s ago`;
    return `${Math.floor(secs / 60)}m ago`;
  }

  return (
    <div className="flex flex-col h-full" onClick={onSectionClick} style={{ cursor: 'default' }}>
      {/* Section header — hidden when parent renders its own tab bar */}
      {!hideHeader && (
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{
            borderBottom: '1px solid var(--border-subtle)',
            background: isActive ? 'var(--bg-surface)' : 'var(--bg-base)',
          }}
        >
          <div
            className="flex items-center gap-2 cursor-pointer select-none"
            onClick={(e) => { e.stopPropagation(); setCollapsed((v) => !v); }}
            title={collapsed ? 'expand' : 'collapse'}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '9px',
                color: 'var(--text-muted)',
                display: 'inline-block',
                transition: 'transform 120ms ease',
                transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              }}
            >
              ▾
            </span>
            <span
              className="text-xs uppercase tracking-widest"
              style={{
                fontFamily: 'var(--font-mono)',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                letterSpacing: '0.12em',
                fontWeight: isActive ? '500' : '300',
              }}
            >
              {section.name}
            </span>
            {!loading && !error && unreadCount > 0 && (
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-accent)', fontSize: '10px', fontWeight: '600' }}>
                ({unreadCount})
              </span>
            )}
            {lastUpdated && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '9px', color: 'var(--text-muted)', opacity: 0.6 }}>
                {formatLastUpdated(lastUpdated)}
              </span>
            )}
          </div>

          <button
            onClick={(e) => { e.stopPropagation(); loadEmails(); }}
            className="opacity-0 hover:opacity-100 transition-opacity"
            title="Refresh"
            style={{ color: 'var(--text-muted)', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
          >
            ↺
          </button>
        </div>
      )}

      {/* Email list */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <SectionSkeleton />
          ) : error ? (
            <div className="px-4 py-8 text-center">
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>{error}</p>
              <button onClick={() => loadEmails()} className="mt-2 underline" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                retry
              </button>
            </div>
          ) : emails.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>all clear ✓</p>
            </div>
          ) : (
            <div>
              {(() => {
                const order: DayBucket[] = ['today', 'yesterday', 'earlier-week', 'archive'];
                const groups = new Map<DayBucket, { email: ParsedEmail; index: number }[]>();
                emails.forEach((email, index) => {
                  const b = dayBucket(email.date);
                  const arr = groups.get(b) ?? [];
                  arr.push({ email, index });
                  groups.set(b, arr);
                });
                return order
                  .filter((b) => (groups.get(b)?.length ?? 0) > 0)
                  .map((b) => {
                    const items = groups.get(b)!;
                    return (
                      <div key={b}>
                        <div
                          style={{
                            padding: '18px 24px 8px',
                            display: 'flex',
                            alignItems: 'baseline',
                            gap: '12px',
                            background: 'var(--bg-base)',
                            position: 'sticky',
                            top: 0,
                            zIndex: 1,
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'var(--font-serif)',
                              fontSize: '15px',
                              fontStyle: 'italic',
                              color: 'var(--text-primary)',
                              fontWeight: 500,
                              letterSpacing: '-0.005em',
                            }}
                          >
                            {bucketLabel(b)}
                          </span>
                          <div
                            style={{
                              flex: 1,
                              height: 1,
                              borderTop: '1px solid var(--border-subtle)',
                              transform: 'translateY(-4px)',
                            }}
                          />
                          <span
                            style={{
                              fontSize: '10px',
                              color: 'var(--text-muted)',
                              letterSpacing: '0.1em',
                              textTransform: 'uppercase',
                              fontFeatureSettings: '"tnum"',
                            }}
                          >
                            {items.length} {items.length === 1 ? 'letter' : 'letters'}
                          </span>
                        </div>
                        {items.map(({ email, index }) => (
                          <div key={email.id} ref={isActive && index === activeEmailIndex ? selectedRef : null}>
                            <EmailRow
                              email={email}
                              isSelected={isActive && index === activeEmailIndex}
                              isArchiving={archivingId === email.id}
                              sectionLabelIds={sectionLabelIds}
                              onClick={() => { onSectionClick(); onEmailSelect?.(index); if (email.isUnread) toggleReadUnread(email); onPreviewEmail?.(email); }}
                              onHover={() => { onSectionClick(); onEmailSelect?.(index); }}
                              onSwipeLeft={() => archiveEmail(email)}
                              onSwipeRight={() => {
                                onSectionClick();
                                onEmailSelect?.(index);
                                onRequestSnooze?.();
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    );
                  });
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
