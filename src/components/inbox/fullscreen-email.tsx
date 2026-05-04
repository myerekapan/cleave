'use client';

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ParsedEmail, Attachment } from '@/types/gmail';
import { getThreadMessages, getAttachment, ThreadMessage } from '@/lib/gmail';
import { getAccessToken } from '@/lib/gmail-token';
import { formatRelativeDate } from '@/lib/date-utils';
import { Paperclip, Download, ArrowLeft, Star, ChevronDown, Calendar, MapPin, Reply, Forward, Archive, ArchiveRestore } from 'lucide-react';
import { ComposePane, ComposeState } from './compose-pane';
import { ParsedEvent, RsvpStatus, parseIcsFromBase64url, formatEventDate } from '@/lib/ics';
import { CalendarEventRef, findCalendarEvent, createCalendarEvent, updateCalendarRsvp, getMyResponseStatus } from '@/lib/calendar';
import { toast } from 'sonner';

const SUPERHUMAN_REMINDER_EMAILS = ['reminder@superhuman.com', 'reminders@superhuman.com'];

function isSuperhumanReminder(msg: ThreadMessage): boolean {
  return SUPERHUMAN_REMINDER_EMAILS.some((e) => msg.fromEmail.toLowerCase() === e);
}

function HeaderActionButton({
  icon,
  label,
  title,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '4px 9px',
        borderRadius: '4px',
        border: '1px solid var(--border-default)',
        background: 'var(--bg-surface)',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        lineHeight: 1,
        cursor: 'pointer',
        transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hover)';
        e.currentTarget.style.borderColor = 'var(--border-strong)';
        e.currentTarget.style.color = 'var(--text-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--bg-surface)';
        e.currentTarget.style.borderColor = 'var(--border-default)';
        e.currentTarget.style.color = 'var(--text-secondary)';
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export interface FullscreenEmailHandle {
  navigateUp: () => boolean;
  navigateDown: () => boolean;
  toggleActive: () => void;
  messageCount: number;
}

interface FullscreenEmailProps {
  email: ParsedEmail;
  userEmail?: string;
  archiveLabel?: string;
  composeState?: ComposeState | null;
  onClose: () => void;
  onArchive?: () => void;
  onReply?: () => void;
  onForward?: () => void;
  onStar?: () => void;
  onMessagesLoaded?: (messages: ThreadMessage[]) => void;
  onComposeClose?: () => void;
}

export const FullscreenEmail = forwardRef<FullscreenEmailHandle, FullscreenEmailProps>(function FullscreenEmail(
  { email, userEmail, archiveLabel, composeState, onClose, onArchive, onReply, onForward, onStar, onMessagesLoaded, onComposeClose },
  ref
) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(-1);
  const [expandedHeaders, setExpandedHeaders] = useState<Set<string>>(new Set());
  const [parsedEvent, setParsedEvent] = useState<ParsedEvent | null>(null);
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus | null>(null);
  const [calEventRef, setCalEventRef] = useState<CalendarEventRef | null>(null);
  const [rsvpLoading, setRsvpLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useImperativeHandle(ref, () => ({
    navigateUp: () => {
      if (activeIndex <= 0) return false;
      setActiveIndex((i) => i - 1);
      return true;
    },
    navigateDown: () => {
      if (activeIndex >= messages.length - 1) return false;
      setActiveIndex((i) => i + 1);
      return true;
    },
    toggleActive: () => {
      const msg = messages[activeIndex];
      if (msg) toggleCollapse(msg.id);
    },
    messageCount: messages.length,
  }), [activeIndex, messages]);

  function loadMessages(resetState = true) {
    if (resetState) {
      setLoading(true);
      setMessages([]);
      setCollapsedIds(new Set());
      setActiveIndex(-1);
      setParsedEvent(null);
      setRsvpStatus(null);
      setCalEventRef(null);
    }

    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }

    // Always fetch as thread after a send (message count may have changed)
    getThreadMessages(token, email.threadId)
      .then(async (raw) => {
        const msgs = raw.filter((m) => !isSuperhumanReminder(m));
        setMessages(msgs);
        setActiveIndex(msgs.length - 1);
        onMessagesLoaded?.(msgs);
        if (msgs.length > 1 && resetState) {
          const collapsed = new Set(msgs.slice(0, -1).map((m) => m.id));
          setCollapsedIds(collapsed);
        }

        // Find and parse .ics calendar content (inline text/calendar part or .ics attachment)
        for (const msg of msgs) {
          if (!msg.icsRef) continue;
          const data = 'data' in msg.icsRef
            ? msg.icsRef.data
            : await getAttachment(token, msg.icsRef.messageId, msg.icsRef.attachmentId);
          const event = parseIcsFromBase64url(data);
          if (event?.summary) {
            setParsedEvent(event);
            if (event.uid) {
              findCalendarEvent(token, event.uid, event).then(async (ref) => {
                if (!ref) return;
                setCalEventRef(ref);
                // Prefer the user's actual response from Calendar over the ICS's PARTSTAT
                // (the ICS always reports NEEDS-ACTION for the invitee).
                const actual = userEmail ? await getMyResponseStatus(token, ref, userEmail) : null;
                setRsvpStatus(actual ?? event.attendeeStatus);
              });
            }
          }
          break;
        }
      })
      .catch(() => { if (resetState) setMessages([]); })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadMessages(true);
  }, [email.id, email.threadId, email.messageCount, email.from, email.fromName, email.fromEmail, email.date]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const el = messageRefs.current.get(activeIndex);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeIndex]);

  function toggleCollapse(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function isEditable(el: Element | null): boolean {
      if (!el || !(el instanceof HTMLElement)) return false;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
      if (el.tagName === 'IFRAME' || el.tagName === 'PRE') return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function recapture() {
      const active = document.activeElement;
      if (!active || active === container || !container?.contains(active)) return;
      // Don't steal focus from editable elements (compose pane inputs, contentEditable body)
      if (isEditable(active)) return;
      container.focus();
    }

    document.addEventListener('focusin', recapture);
    const interval = setInterval(recapture, 100);

    return () => {
      document.removeEventListener('focusin', recapture);
      clearInterval(interval);
    };
  }, []);

  function formatDate(dateStr: string) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  }

  function isFromMe(msg: ThreadMessage): boolean {
    if (!userEmail) return false;
    return msg.fromEmail.toLowerCase() === userEmail.toLowerCase();
  }

  /** Parse a To/Cc header into individual display names or emails */
  function parseRecipients(header: string): string[] {
    if (!header.trim()) return [];
    return header.split(',').map((r) => {
      const m = r.trim().match(/^"?([^"<]+)"?\s*<(.+?)>$/);
      if (m) {
        const email = m[2].toLowerCase();
        if (userEmail && email === userEmail.toLowerCase()) return 'Me';
        return m[1].trim();
      }
      const raw = r.trim();
      if (userEmail && raw.toLowerCase() === userEmail.toLowerCase()) return 'Me';
      return raw;
    });
  }

  /** Compact summary line: "to Me & nick@overarc.io" */
  function formatRecipientSummary(msg: ThreadMessage): string {
    const toNames = parseRecipients(msg.to);
    const ccNames = parseRecipients(msg.cc);
    const all = [...toNames, ...ccNames].filter(Boolean);
    if (all.length === 0) {
      return isFromMe(msg) ? '' : 'to Me';
    }
    return 'to ' + all.join(' & ');
  }

  function toggleHeaderExpand(msgId: string) {
    setExpandedHeaders((prev) => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleDownload(att: Attachment) {
    const token = getAccessToken();
    if (!token) return;
    const data = await getAttachment(token, att.messageId, att.attachmentId);
    const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: att.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = att.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleRsvp(status: RsvpStatus) {
    if (!userEmail || rsvpLoading || !parsedEvent?.uid) return;
    const token = getAccessToken();
    if (!token) return;
    setRsvpLoading(true);
    try {
      let ref = calEventRef;
      if (!ref) {
        ref = await findCalendarEvent(token, parsedEvent.uid, parsedEvent);
        if (ref) setCalEventRef(ref);
      }
      if (!ref) {
        ref = await createCalendarEvent(token, parsedEvent, userEmail, status);
        setCalEventRef(ref);
        setRsvpStatus(status);
        return;
      }
      await updateCalendarRsvp(token, ref, userEmail, status);
      setRsvpStatus(status);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update RSVP');
    } finally {
      setRsvpLoading(false);
    }
  }

  function renderEventCard(event: ParsedEvent) {
    const isCancelled = event.method === 'CANCEL' || event.status === 'CANCELLED';
    const isReply = event.method === 'REPLY';
    const showRsvp = !!event.uid && !isCancelled && !isReply;
    return (
      <div style={{ borderBottom: '1px solid var(--border-subtle)', overflow: 'hidden' }}>
        {event.image && (
          <div style={{ width: '100%', maxHeight: '220px', overflow: 'hidden' }}>
            <img
              src={event.image}
              alt=""
              style={{ width: '100%', height: '220px', objectFit: 'cover', display: 'block' }}
            />
          </div>
        )}
        <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {event.summary && (
            <p style={{
              fontSize: '16px', fontWeight: '600', margin: 0, lineHeight: '1.3',
              color: isCancelled ? 'var(--text-muted)' : 'var(--text-primary)',
              textDecoration: isCancelled ? 'line-through' : 'none',
            }}>
              {event.summary}
            </p>
          )}
          {(isCancelled || isReply) && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {isCancelled ? 'cancelled' : 'rsvp reply'}
            </span>
          )}
          {event.start && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Calendar size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                {formatEventDate(event.start, event.end)}
              </span>
            </div>
          )}
          {event.location && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <MapPin size={13} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: '1px' }} />
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)' }}>
                {event.location}
              </span>
            </div>
          )}
          {showRsvp && (
            <div style={{ display: 'flex', gap: '6px', paddingTop: '2px' }}>
              {(['accepted', 'tentative', 'declined'] as RsvpStatus[]).map((s) => {
                const labels: Record<string, string> = { accepted: 'yes', tentative: 'maybe', declined: 'no' };
                const active = rsvpStatus === s;
                return (
                  <button
                    key={s}
                    onClick={() => handleRsvp(s)}
                    disabled={rsvpLoading}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '11px',
                      padding: '3px 10px',
                      borderRadius: '4px',
                      border: active ? '1px solid var(--accent-bright)' : '1px solid var(--border-default)',
                      background: active ? 'var(--accent-bright)' : 'var(--bg-surface)',
                      color: active ? '#fff' : 'var(--text-secondary)',
                      cursor: rsvpLoading ? 'not-allowed' : 'pointer',
                      opacity: rsvpLoading ? 0.6 : 1,
                      transition: 'all 150ms ease',
                    }}
                  >
                    {labels[s]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderAttachments(attachments: Attachment[]) {
    if (!attachments.length) return null;
    return (
      <div
        style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
        }}
      >
        {attachments.map((att) => (
          <button
            key={att.attachmentId}
            onClick={() => handleDownload(att)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 10px',
              borderRadius: '6px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-elevated)',
              cursor: 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              maxWidth: '240px',
            }}
          >
            <Paperclip size={12} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {att.filename}
            </span>
            <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              {formatSize(att.size)}
            </span>
            <Download size={11} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
          </button>
        ))}
      </div>
    );
  }

  function resizeIframe(iframe: HTMLIFrameElement) {
    try {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;

      const h = doc.body.scrollHeight;
      if (h) iframe.style.height = `${h}px`;

      // Watch for size changes (images loading, layout shifts, etc.)
      const ro = new ResizeObserver(() => {
        const newH = doc.body.scrollHeight;
        if (newH) iframe.style.height = `${newH}px`;
      });
      ro.observe(doc.body);

      // Forward keyboard shortcuts to parent while letting Cmd+C work natively
      doc.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: e.key,
          code: e.code,
          shiftKey: e.shiftKey,
          bubbles: true,
        }));
        e.preventDefault();
      });
    } catch { /* cross-origin guard */ }
  }

  function renderMessageBody(msg: ThreadMessage) {
    const srcdoc = msg.body.html
      ? `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
          body{font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:14px;color:#16150f;background:#f6f3ec;padding:24px;margin:0;line-height:1.7}
          a{color:#b5371f}img{max-width:100%;height:auto}
          table{border-collapse:collapse;max-width:100%}
          blockquote{margin:0 0 0 0.8em;padding-left:1em;border-left:2px solid #d9d4c6;color:#7a766a;font-style:italic}
          pre{white-space:pre-wrap;overflow-x:auto}
        </style></head><body>${msg.body.html}</body></html>`
      : null;

    if (srcdoc) {
      return (
        <iframe
          srcDoc={srcdoc}
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-downloads"
          className="w-full"
          style={{ border: 'none', minHeight: '60px' }}
          tabIndex={-1}
          onLoad={(e) => resizeIframe(e.currentTarget)}
        />
      );
    }
    if (msg.body.text) {
      return (
        <pre
          className="px-6 py-4 overflow-auto"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
          }}
        >
          {msg.body.text}
        </pre>
      );
    }
    return (
      <div className="px-6 py-6 text-center">
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
          no preview available
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="absolute inset-0 flex flex-col z-40 outline-none"
      style={{
        background: 'var(--bg-base)',
      }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 px-6 py-4 space-y-1"
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              style={{ color: 'var(--text-muted)', flexShrink: 0 }}
              title="Back (Esc)"
            >
              <ArrowLeft size={14} />
            </button>
            <p
              className="text-sm leading-snug"
              style={{
                color: 'var(--text-primary)',
                fontWeight: '500',
                fontSize: '14px',
              }}
            >
              {email.subject}
            </p>
            {(email.messageCount ?? 1) > 1 && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                  background: 'var(--bg-elevated)',
                  padding: '1px 5px',
                  borderRadius: '3px',
                }}
              >
                {email.messageCount}
              </span>
            )}
            <button
              onClick={onStar}
              title="Star (S)"
              style={{ flexShrink: 0, color: email.isStarred ? 'var(--accent-bright)' : 'var(--text-muted)' }}
            >
              <Star size={13} fill={email.isStarred ? 'currentColor' : 'none'} />
            </button>
          </div>
          {email.reminderDate && (
            <p style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--text-muted)',
              marginTop: '2px',
            }}>
              reminder returned {formatRelativeDate(email.reminderDate)}
            </p>
          )}
          <div className="hidden md:flex items-center gap-1.5 flex-shrink-0">
            {onReply && (
              <HeaderActionButton
                icon={<Reply size={12} />}
                label="reply"
                title="Reply (Enter)"
                onClick={onReply}
              />
            )}
            {onForward && (
              <HeaderActionButton
                icon={<Forward size={12} />}
                label="fwd"
                title="Forward (F)"
                onClick={onForward}
              />
            )}
            {onArchive && (
              <HeaderActionButton
                icon={archiveLabel === 'archive' ? <Archive size={12} /> : <ArchiveRestore size={12} />}
                label={archiveLabel ?? 'archive'}
                title={archiveLabel === 'archive' ? 'Archive (E)' : 'Unarchive (E)'}
                onClick={() => { onArchive(); if (archiveLabel === 'archive') onClose(); }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        <div className="max-w-3xl mx-auto w-full flex-1 flex flex-col">
          {parsedEvent && !loading && renderEventCard(parsedEvent)}
          {loading ? (
            <div className="px-6 py-8 space-y-2">
              {[80, 100, 60, 90, 70].map((w, i) => (
                <div
                  key={i}
                  style={{
                    height: '12px',
                    width: `${w}%`,
                    background: 'var(--bg-elevated)',
                    borderRadius: '2px',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)' }}>
                no preview available
              </p>
            </div>
          ) : messages.length === 1 ? (
            <div className="flex flex-col flex-1">
              <div className="flex-shrink-0 px-6 py-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center gap-3">
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '50%',
                      background: 'var(--accent-bright)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#fff' }}>
                      {messages[0].fromName?.charAt(0)?.toUpperCase() || '?'}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-1.5 min-w-0">
                        <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-primary)' }}>
                          {messages[0].fromName}
                        </span>
                        <button
                          onClick={() => toggleHeaderExpand(messages[0].id)}
                          className="flex items-center gap-1 min-w-0"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '10px',
                            color: 'var(--text-muted)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {formatRecipientSummary(messages[0])}
                          </span>
                          <ChevronDown
                            size={10}
                            style={{
                              color: 'var(--text-muted)',
                              flexShrink: 0,
                              transform: expandedHeaders.has(messages[0].id) ? 'rotate(180deg)' : 'none',
                              transition: 'transform 150ms ease',
                            }}
                          />
                        </button>
                      </div>
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        color: 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                      }}>
                        {formatDate(messages[0].date)}
                      </span>
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateRows: expandedHeaders.has(messages[0].id) ? '1fr' : '0fr',
                      transition: 'grid-template-rows 200ms ease',
                    }}>
                      <div style={{ overflow: 'hidden' }}>
                        <div style={{
                          marginTop: '8px',
                          padding: '8px 0',
                          borderTop: '1px solid var(--border-subtle)',
                          display: 'grid',
                          gridTemplateColumns: 'auto 1fr',
                          gap: '3px 10px',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '10px',
                        }}>
                          <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>From</span>
                          <span style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>{messages[0].from}</span>
                          <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>To</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{messages[0].to}</span>
                          {messages[0].cc && (
                            <>
                              <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>Cc</span>
                              <span style={{ color: 'var(--text-secondary)' }}>{messages[0].cc}</span>
                            </>
                          )}
                          <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>Date</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{formatDate(messages[0].date)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {renderAttachments(messages[0].attachments)}
              <div>
                {renderMessageBody(messages[0])}
              </div>
              {composeState && onComposeClose && (
                <ComposePane
                  {...composeState}
                  replyToIndex={0}
                  userEmail={userEmail}
                  messages={messages}
                  inline
                  onClose={onComposeClose}
                  onSent={() => setTimeout(() => loadMessages(false), 1500)}
                />
              )}
            </div>
          ) : (
            <div style={{ padding: '16px 24px 32px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {messages.map((msg, idx) => {
                const isCollapsed = collapsedIds.has(msg.id);
                const isLast = idx === messages.length - 1;
                const isActive = idx === activeIndex;
                const initial = msg.fromName?.charAt(0)?.toUpperCase() || '?';

                return (
                <React.Fragment key={msg.id}>
                  <div
                    ref={(el) => { if (el) messageRefs.current.set(idx, el); else messageRefs.current.delete(idx); }}
                    onClick={() => setActiveIndex(idx)}
                    style={{
                      borderRadius: '10px',
                      border: isActive
                        ? '1px solid var(--accent-bright)'
                        : isLast ? '1px solid var(--border-default)' : '1px solid var(--border-subtle)',
                      background: isLast || isActive ? 'var(--bg-base)' : isCollapsed ? 'var(--bg-surface)' : 'var(--bg-base)',
                      boxShadow: isActive
                        ? '0 0 0 1px var(--accent-bright), 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)'
                        : isLast
                          ? '0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)'
                          : 'none',
                      overflow: 'hidden',
                      transition: 'box-shadow 150ms ease, border-color 150ms ease',
                    }}
                  >
                    <button
                      onClick={() => toggleCollapse(msg.id)}
                      className="w-full text-left flex items-center gap-3"
                      style={{
                        padding: isCollapsed ? '10px 16px' : '14px 16px 12px',
                        cursor: 'pointer',
                        background: 'transparent',
                        border: 'none',
                      }}
                    >
                      <div
                        style={{
                          width: isLast ? '36px' : '28px',
                          height: isLast ? '36px' : '28px',
                          borderRadius: '50%',
                          background: isLast ? 'var(--accent-bright)' : 'var(--bg-elevated)',
                          border: isLast ? 'none' : '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'all 150ms ease',
                        }}
                      >
                        <span style={{
                          fontSize: isLast ? '14px' : '11px',
                          fontWeight: '600',
                          color: isLast ? '#fff' : 'var(--text-muted)',
                        }}>
                          {initial}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span style={{
                            fontSize: isLast ? '13px' : '12px',
                            fontWeight: isLast ? '600' : '500',
                            color: 'var(--text-primary)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}>
                            {msg.fromName}
                          </span>
                          <span style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '10px',
                            color: 'var(--text-muted)',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}>
                            {formatDate(msg.date)}
                          </span>
                        </div>
                        {isCollapsed && (
                          <p style={{
                            fontSize: '11px',
                            color: 'var(--text-muted)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            marginTop: '2px',
                            lineHeight: '1.3',
                          }}>
                            {msg.body.text?.slice(0, 100) || 'no preview'}
                          </p>
                        )}
                      </div>
                    </button>

                    {!isCollapsed && (
                      <div>
                        <div style={{ padding: '0 16px 8px 16px', marginLeft: isLast ? '48px' : '40px' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleHeaderExpand(msg.id); }}
                            className="flex items-center gap-1"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          >
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
                              {formatRecipientSummary(msg)}
                            </span>
                            <ChevronDown
                              size={9}
                              style={{
                                color: 'var(--text-muted)',
                                flexShrink: 0,
                                transform: expandedHeaders.has(msg.id) ? 'rotate(180deg)' : 'none',
                                transition: 'transform 150ms ease',
                              }}
                            />
                          </button>
                          <div style={{
                            display: 'grid',
                            gridTemplateRows: expandedHeaders.has(msg.id) ? '1fr' : '0fr',
                            transition: 'grid-template-rows 200ms ease',
                          }}>
                            <div style={{ overflow: 'hidden' }}>
                              <div style={{
                                marginTop: '6px',
                                padding: '6px 0',
                                borderTop: '1px solid var(--border-subtle)',
                                display: 'grid',
                                gridTemplateColumns: 'auto 1fr',
                                gap: '3px 10px',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '10px',
                              }}>
                                <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>From</span>
                                <span style={{ color: 'var(--text-secondary)', fontWeight: '500' }}>{msg.from}</span>
                                <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>To</span>
                                <span style={{ color: 'var(--text-secondary)' }}>{msg.to}</span>
                                {msg.cc && (
                                  <>
                                    <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>Cc</span>
                                    <span style={{ color: 'var(--text-secondary)' }}>{msg.cc}</span>
                                  </>
                                )}
                                <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>Date</span>
                                <span style={{ color: 'var(--text-secondary)' }}>{formatDate(msg.date)}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div>
                          {renderMessageBody(msg)}
                        </div>
                        {renderAttachments(msg.attachments)}
                      </div>
                    )}
                  </div>
                  {isActive && composeState && onComposeClose && (
                    <ComposePane
                      {...composeState}
                      replyToIndex={idx}
                      userEmail={userEmail}
                      messages={messages}
                      inline
                      onClose={onComposeClose}
                      onSent={() => setTimeout(() => loadMessages(false), 1500)}
                    />
                  )}
                </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
