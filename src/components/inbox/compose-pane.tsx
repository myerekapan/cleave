'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ParsedEmail } from '@/types/gmail';
import { sendMessage, getThreadMessages, type ThreadMessage } from '@/lib/gmail';
import { getAccessToken } from '@/lib/gmail-token';
import { parseRecipientHeader, type Recipient } from '@/lib/recipients';
import { getContactIndex, rankContacts, recordSentRecipients, type ContactEntry } from '@/lib/contacts';
import { Minimize2, X, Send, Paperclip } from 'lucide-react';

const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
import { toast } from 'sonner';

export interface ComposeState {
  mode: 'new' | 'reply' | 'forward';
  email?: ParsedEmail;
  /** Index into the thread messages array — reply to this specific message */
  replyToIndex?: number;
  /** When mode === 'reply', include original To/Cc as Cc (default true). */
  replyAll?: boolean;
}

interface ComposePaneProps extends ComposeState {
  userEmail?: string;
  /** Pre-loaded thread messages — avoids re-fetching when compose is inline */
  messages?: ThreadMessage[];
  /** When true, renders inline (no fixed positioning) */
  inline?: boolean;
  onClose: () => void;
  /** Called after a message is successfully sent — use to refetch thread */
  onSent?: () => void;
}

/* ---------- recipient helpers ---------- */

function dedup(recipients: Recipient[]): Recipient[] {
  const seen = new Set<string>();
  return recipients.filter((r) => {
    const key = r.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function excludeSelf(recipients: Recipient[], userEmail?: string): Recipient[] {
  if (!userEmail) return recipients;
  const me = userEmail.toLowerCase();
  return recipients.filter((r) => r.email.toLowerCase() !== me);
}

function chipLabel(r: Recipient): string {
  if (r.name === r.email.split('@')[0]) return r.email;
  return r.name;
}

/* ---------- subject helpers ---------- */

function initialSubject(mode: string, email?: ParsedEmail) {
  if (!email) return '';
  if (mode === 'reply') return email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
  if (mode === 'forward') return email.subject.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`;
  return '';
}

/* ---------- body helpers ---------- */

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Build the attribution + body for the quoted reply. Returns { attr, body } separately
 *  so the local preview can render them, and the send-time HTML can wrap them in gmail_quote. */
function buildQuoteParts(email: ParsedEmail, lastMsg: ThreadMessage) {
  const body = lastMsg.body.html
    ?? `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(lastMsg.body.text ?? '')}</pre>`;
  const attr = `On ${escapeHtml(email.date)}, ${escapeHtml(email.fromName)} &lt;${escapeHtml(email.fromEmail)}&gt; wrote:`;
  return { attr, body };
}

/** For local preview inside compose */
function buildQuotePreviewHtml(attr: string, body: string) {
  return `<div style="margin-bottom:8px;font-size:11px;color:var(--text-muted)">${attr}</div>${body}`;
}

/** For the actual sent email — uses gmail_quote class so Gmail auto-hides it */
function buildQuoteSendHtml(attr: string, body: string) {
  return [
    '<div class="gmail_quote">',
    `<div dir="ltr" class="gmail_attr">${attr}<br></div>`,
    '<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">',
    body,
    '</blockquote>',
    '</div>',
  ].join('');
}

function buildForwardEditorHtml(messages: ThreadMessage[], subject: string) {
  const parts = messages.map((msg) => {
    const body = msg.body.html
      ?? `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(msg.body.text ?? '')}</pre>`;
    const lines = [
      '<div style="color:#555;padding-top:10px;margin-top:10px;border-top:1px solid #ddd;font-size:13px">',
      '<b>---------- Forwarded message ---------</b><br>',
      `<b>From:</b> ${escapeHtml(msg.fromName)} &lt;${escapeHtml(msg.fromEmail)}&gt;<br>`,
      `<b>Date:</b> ${escapeHtml(msg.date)}<br>`,
      `<b>Subject:</b> ${escapeHtml(subject)}<br>`,
      `<b>To:</b> ${escapeHtml(msg.to)}`,
    ];
    if (msg.cc) {
      lines.push(`<br><b>Cc:</b> ${escapeHtml(msg.cc)}`);
    }
    lines.push('</div>', '<div style="padding-top:8px">', body, '</div>');
    return lines.join('');
  });
  return `<div><br></div>${parts.join('')}`;
}

/* ---------- RecipientInput ---------- */

function RecipientInput({
  label,
  recipients,
  onChange,
  onMoveRecipient,
  moveLabel,
  userEmail,
}: {
  label: string;
  recipients: Recipient[];
  onChange: (r: Recipient[]) => void;
  /** Called when a chip is clicked — moves it to another field */
  onMoveRecipient?: (r: Recipient, index: number) => void;
  /** Tooltip for move action (e.g. "Move to Cc") */
  moveLabel?: string;
  /** User's own email, for reading the contact index */
  userEmail?: string;
}) {
  const [inputValue, setInputValue] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedEmailSet = useMemo(
    () => new Set(recipients.map((r) => r.email.toLowerCase())),
    [recipients],
  );

  const suggestions = useMemo<ContactEntry[]>(() => {
    if (!userEmail || !inputValue.trim()) return [];
    const index = getContactIndex(userEmail);
    return rankContacts(index, inputValue).filter(
      (c) => !selectedEmailSet.has(c.email),
    );
  }, [inputValue, userEmail, selectedEmailSet]);

  useEffect(() => {
    setHighlightedIndex(0);
    setDropdownOpen(suggestions.length > 0);
  }, [suggestions]);

  function addRecipient(rawOrRecipient: string | Recipient) {
    const next: Recipient = typeof rawOrRecipient === 'string'
      ? { name: rawOrRecipient.trim().split('@')[0], email: rawOrRecipient.trim() }
      : rawOrRecipient;
    if (!next.email) return;
    if (selectedEmailSet.has(next.email.toLowerCase())) {
      setInputValue('');
      setDropdownOpen(false);
      return;
    }
    onChange([...recipients, next]);
    setInputValue('');
    setDropdownOpen(false);
  }

  function removeRecipient(index: number) {
    onChange(recipients.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const hasSuggestions = dropdownOpen && suggestions.length > 0;

    if (hasSuggestions && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setHighlightedIndex((i) => (i + delta + suggestions.length) % suggestions.length);
      return;
    }

    if (e.key === 'Escape' && dropdownOpen) {
      e.stopPropagation();
      setDropdownOpen(false);
      return;
    }

    if (e.key === 'Enter' || e.key === 'Tab' || e.key === ',') {
      if (hasSuggestions && (e.key === 'Enter' || e.key === 'Tab')) {
        e.preventDefault();
        const pick = suggestions[highlightedIndex];
        if (pick) {
          addRecipient({ name: pick.name, email: pick.email });
          return;
        }
      }
      if (inputValue.trim()) {
        e.preventDefault();
        addRecipient(inputValue);
      }
      return;
    }

    if (e.key === 'Backspace' && !inputValue && recipients.length > 0) {
      removeRecipient(recipients.length - 1);
    }
  }

  function handleBlur() {
    // Delay so a click on a suggestion can fire before the dropdown disappears.
    window.setTimeout(() => {
      setDropdownOpen(false);
      if (inputValue.trim()) addRecipient(inputValue);
    }, 120);
  }

  return (
    <div
      className="flex items-start gap-2 px-4 py-2 relative"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
      onClick={() => inputRef.current?.focus()}
    >
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '10px',
        color: 'var(--text-muted)',
        width: '32px',
        flexShrink: 0,
        paddingTop: '3px',
      }}>
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0 relative">
        {recipients.map((r, i) => (
          <span
            key={i}
            className="flex items-center gap-1"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              color: 'var(--text-secondary)',
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '4px',
              padding: '1px 6px',
              whiteSpace: 'nowrap',
              cursor: onMoveRecipient ? 'pointer' : 'default',
            }}
            title={moveLabel}
            onClick={(e) => {
              e.stopPropagation();
              if (onMoveRecipient) {
                onMoveRecipient(r, i);
              }
            }}
          >
            {chipLabel(r)}
            <button
              onClick={(e) => { e.stopPropagation(); removeRecipient(i); }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                color: 'var(--text-muted)',
                fontSize: '12px',
                lineHeight: 1,
              }}
            >
              &times;
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onFocus={() => { if (suggestions.length > 0) setDropdownOpen(true); }}
          placeholder={recipients.length === 0 ? 'recipient@example.com' : ''}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-form-type="other"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '12px',
            color: 'var(--text-primary)',
            background: 'transparent',
            outline: 'none',
            border: 'none',
            flex: 1,
            minWidth: '120px',
          }}
        />
        {dropdownOpen && suggestions.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: '4px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-default)',
              borderRadius: '4px',
              boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
              zIndex: 60,
              maxHeight: '240px',
              overflowY: 'auto',
            }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {suggestions.map((c, i) => (
              <div
                key={c.email}
                onMouseEnter={() => setHighlightedIndex(i)}
                onClick={(e) => {
                  e.stopPropagation();
                  addRecipient({ name: c.name, email: c.email });
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  background: i === highlightedIndex ? 'var(--bg-elevated)' : 'transparent',
                  borderBottom: i === suggestions.length - 1 ? 'none' : '1px solid var(--border-subtle)',
                }}
              >
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {c.name}
                </span>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {c.email}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- ComposePane ---------- */

export function ComposePane({ mode, email, userEmail, messages: preloadedMessages, replyToIndex, replyAll = true, inline, onClose, onSent }: ComposePaneProps) {
  const [toRecipients, setToRecipients] = useState<Recipient[]>([]);
  const [ccRecipients, setCcRecipients] = useState<Recipient[]>([]);
  const [bccRecipients, setBccRecipients] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState(() => initialSubject(mode, email));
  const [sending, setSending] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [quotePreviewHtml, setQuotePreviewHtml] = useState<string | null>(null);
  const [quoteSendHtml, setQuoteSendHtml] = useState<string | null>(null);
  const [quoteExpanded, setQuoteExpanded] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const editableRef = useRef<HTMLDivElement>(null);
  const replyTargetRef = useRef<ThreadMessage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  function addFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    const existingBytes = attachments.reduce((acc, f) => acc + f.size, 0);
    const incomingBytes = incoming.reduce((acc, f) => acc + f.size, 0);
    if (existingBytes + incomingBytes > MAX_ATTACHMENTS_BYTES) {
      toast.error('attachments exceed 25MB limit');
      return;
    }
    setAttachments((prev) => [...prev, ...incoming]);
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function setEditorHtml(html: string) {
    requestAnimationFrame(() => {
      if (!editableRef.current) return;
      editableRef.current.innerHTML = html;
      // Place cursor at the very start
      const sel = window.getSelection();
      const firstDiv = editableRef.current.querySelector('div');
      if (sel && firstDiv) {
        const range = document.createRange();
        range.setStart(firstDiv, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      editableRef.current.focus();
    });
  }

  // Initialize recipients + body
  useEffect(() => {
    if (mode === 'new' || !email || initialized) return;
    const token = getAccessToken();
    if (!token) return;
    let cancelled = false;

    // Always fetch fresh to ensure cc/references headers are available
    const messagesPromise = getThreadMessages(token, email.threadId);

    if (mode === 'reply') {
      messagesPromise.then((msgs) => {
        if (cancelled) return;
        const targetIdx = replyToIndex != null && replyToIndex >= 0 && replyToIndex < msgs.length
          ? replyToIndex
          : msgs.length - 1;
        const lastMsg = msgs[targetIdx];
        if (!lastMsg) return;
        replyTargetRef.current = lastMsg;

        // Reply-all: To = sender only, Cc = everyone else (original To + Cc, minus self).
        // Reply (single): To = sender only, no Cc.
        const sender: Recipient = { name: lastMsg.fromName, email: lastMsg.fromEmail };
        const senderEmail = sender.email.toLowerCase();
        const originalTo = parseRecipientHeader(lastMsg.to);
        const originalCc = parseRecipientHeader(lastMsg.cc);
        const everyone = dedup(excludeSelf([...originalTo, ...originalCc], userEmail))
          .filter((r) => r.email.toLowerCase() !== senderEmail);

        setToRecipients([sender]);
        setCcRecipients(replyAll ? everyone : []);

        const parts = buildQuoteParts(email, lastMsg);
        setQuotePreviewHtml(buildQuotePreviewHtml(parts.attr, parts.body));
        setQuoteSendHtml(buildQuoteSendHtml(parts.attr, parts.body));
        setEditorHtml('<div><br></div>');
        setInitialized(true);
      }).catch(() => {
        if (!cancelled) {
          setToRecipients([{ name: email.fromName, email: email.fromEmail }]);
          setEditorHtml('<div><br></div>');
          setInitialized(true);
        }
      });
    } else if (mode === 'forward') {
      messagesPromise.then((messages) => {
        if (cancelled) return;
        setEditorHtml(buildForwardEditorHtml(messages, email.subject));
        setInitialized(true);
      }).catch(() => {
        if (!cancelled) {
          setEditorHtml('<div><br></div>');
          setInitialized(true);
        }
      });
    }

    return () => { cancelled = true; };
  }, [mode, email, userEmail, initialized, replyAll, replyToIndex]);

  async function handleSend() {
    if (toRecipients.length === 0 || sending) return;
    const token = getAccessToken();
    if (!token) { toast.error('not authenticated'); return; }
    setSending(true);
    try {
      let editorContent = editableRef.current?.innerHTML ?? '';
      // For reply, append the quoted content using Gmail's standard quote format
      if (mode === 'reply' && quoteSendHtml) {
        editorContent += quoteSendHtml;
      }
      const sendHtml = editorContent
        ? `<html><body>${editorContent}</body></html>`
        : undefined;
      const sendBody = editableRef.current?.textContent ?? '';

      const toStr = toRecipients.map((r) => r.email).join(', ');
      const ccStr = ccRecipients.length ? ccRecipients.map((r) => r.email).join(', ') : undefined;
      const bccStr = bccRecipients.length ? bccRecipients.map((r) => r.email).join(', ') : undefined;

      // Build threading headers for proper reply threading in recipient's client
      const target = replyTargetRef.current;
      const inReplyTo = mode === 'reply' && target?.rfc2822MessageId ? target.rfc2822MessageId : undefined;
      const references = mode === 'reply' && target
        ? [target.references, target.rfc2822MessageId].filter(Boolean).join(' ') || undefined
        : undefined;

      const attachmentPayload = attachments.length > 0
        ? await Promise.all(
            attachments.map(async (f) => ({
              filename: f.name,
              mimeType: f.type || 'application/octet-stream',
              data: new Uint8Array(await f.arrayBuffer()),
            }))
          )
        : undefined;

      await sendMessage(token, {
        to: toStr,
        cc: ccStr,
        bcc: bccStr,
        subject: subject.trim() || '(no subject)',
        body: sendBody,
        html: sendHtml,
        inReplyTo,
        references,
        ...(attachmentPayload ? { attachments: attachmentPayload } : {}),
        ...(mode !== 'forward' && email?.threadId ? { threadId: email.threadId } : {}),
      });
      if (userEmail) {
        recordSentRecipients(userEmail, [...toRecipients, ...ccRecipients, ...bccRecipients]);
      }
      toast.success('sent');
      setAttachments([]);
      onSent?.();
      onClose();
    } catch (err) {
      toast.error(`send failed: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setSending(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
  }

  const title = mode === 'new' ? 'new message' : mode === 'reply' ? 'reply' : 'forward';
  const canSend = toRecipients.length > 0 && !sending;

  const fieldStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--text-primary)',
    background: 'transparent',
    outline: 'none',
    width: '100%',
  };

  const containerClass = inline
    ? 'flex flex-col relative mx-4 my-4'
    : 'fixed bottom-0 right-8 z-40 flex flex-col';

  function hasFiles(e: React.DragEvent) {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files');
  }

  function onDragEnter(e: React.DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setIsDragging(true);
  }

  function onDragOver(e: React.DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(e: React.DragEvent) {
    if (!hasFiles(e)) return;
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  }

  function onDrop(e: React.DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
  }

  const containerStyle: React.CSSProperties = inline
    ? {
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: '10px',
        overflow: 'hidden',
        boxShadow: '0 1px 2px rgba(22, 21, 15, 0.04), 0 4px 16px rgba(22, 21, 15, 0.05)',
      }
    : {
        width: '560px',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderBottom: 'none',
        borderTopLeftRadius: '10px',
        borderTopRightRadius: '10px',
        overflow: 'hidden',
        boxShadow: '0 -6px 32px rgba(22, 21, 15, 0.12)',
      };

  return (
    <div
      className={containerClass}
      style={containerStyle}
      onKeyDown={onKeyDown}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          addFiles(files);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
      />
      {isDragging && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{
            background: 'rgba(107, 95, 255, 0.08)',
            border: '2px dashed var(--selected-border)',
            zIndex: 50,
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              color: 'var(--accent-bright)',
              letterSpacing: '0.04em',
            }}
          >
            drop files to attach
          </span>
        </div>
      )}
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5 flex-shrink-0 cursor-pointer select-none"
        style={{ borderBottom: minimized ? 'none' : '1px solid var(--border-subtle)' }}
        onClick={() => !inline && setMinimized((v) => !v)}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-secondary)', letterSpacing: '0.06em' }}>
          {title}
        </span>
        <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
          {!inline && (
            <button onClick={() => setMinimized((v) => !v)} style={{ color: 'var(--text-muted)' }} title="minimise">
              <Minimize2 size={11} />
            </button>
          )}
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }} title="discard">
            <X size={12} />
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          {/* To */}
          <RecipientInput
            label="To"
            recipients={toRecipients}
            onChange={setToRecipients}
            userEmail={userEmail}
            moveLabel="Move to Cc"
            onMoveRecipient={(r, i) => {
              setToRecipients((prev) => prev.filter((_, idx) => idx !== i));
              setCcRecipients((prev) => [...prev, r]);
            }}
          />

          {/* Cc */}
          <RecipientInput
            label="Cc"
            recipients={ccRecipients}
            onChange={setCcRecipients}
            userEmail={userEmail}
            moveLabel="Move to To"
            onMoveRecipient={(r, i) => {
              setCcRecipients((prev) => prev.filter((_, idx) => idx !== i));
              setToRecipients((prev) => [...prev, r]);
            }}
          />

          {/* Bcc */}
          <RecipientInput label="Bcc" recipients={bccRecipients} onChange={setBccRecipients} userEmail={userEmail} />

          {/* Subject */}
          <div className="flex items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              color: 'var(--text-muted)',
              width: '52px',
              flexShrink: 0,
            }}>subject</span>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="(no subject)" style={fieldStyle} />
          </div>

          {/* Body — always contentEditable */}
          <div
            ref={editableRef}
            contentEditable
            suppressContentEditableWarning
            className="px-4 py-3 overflow-y-auto"
            onPaste={(e) => {
              const pastedFiles = e.clipboardData?.files
                ? Array.from(e.clipboardData.files)
                : [];
              if (pastedFiles.length > 0) {
                e.preventDefault();
                addFiles(pastedFiles);
              }
            }}
            style={{
              fontFamily: 'sans-serif',
              fontSize: '13px',
              color: 'var(--text-secondary)',
              background: 'transparent',
              outline: 'none',
              minHeight: inline ? '80px' : '140px',
              maxHeight: inline ? '300px' : '400px',
              lineHeight: '1.6',
              cursor: 'text',
            }}
          />

          {/* Quoted content (reply only) — rendered as React, outside contentEditable */}
          {quotePreviewHtml && (
            <div className="px-4 pb-2">
              <button
                onClick={() => setQuoteExpanded((v) => !v)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 6px',
                  borderRadius: '3px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '14px',
                  color: 'var(--text-muted)',
                  lineHeight: 1,
                  letterSpacing: '2px',
                }}
                title={quoteExpanded ? 'Hide quoted text' : 'Show quoted text'}
              >
                {quoteExpanded ? '▾' : '···'}
              </button>
              {quoteExpanded && (
                <div
                  className="overflow-y-auto mt-1"
                  style={{
                    color: 'var(--text-muted)',
                    borderLeft: '2px solid var(--border-default)',
                    paddingLeft: '12px',
                    fontSize: '12px',
                    maxHeight: '200px',
                    lineHeight: '1.5',
                  }}
                  dangerouslySetInnerHTML={{ __html: quotePreviewHtml }}
                />
              )}
            </div>
          )}

          {/* Attachments */}
          {attachments.length > 0 && (
            <div
              className="flex flex-wrap gap-1.5 px-4 py-2"
              style={{ borderTop: '1px solid var(--border-subtle)' }}
            >
              {attachments.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-1.5 px-2 py-1"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '5px',
                    maxWidth: '260px',
                  }}
                >
                  <Paperclip size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={f.name}
                  >
                    {f.name}
                  </span>
                  <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                    {formatFileSize(f.size)}
                  </span>
                  <button
                    onClick={() => removeAttachment(i)}
                    style={{ color: 'var(--text-muted)', flexShrink: 0, cursor: 'pointer' }}
                    title="remove"
                    type="button"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div
            className="flex items-center justify-between px-4 py-3 flex-shrink-0"
            style={{ borderTop: '1px solid var(--border-subtle)' }}
          >
            <div className="flex items-center gap-3">
              <button
                onClick={handleSend}
                disabled={!canSend}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  background: canSend ? 'var(--text-secondary)' : 'var(--bg-elevated)',
                  color: canSend ? 'var(--bg-base)' : 'var(--text-muted)',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: canSend ? 'pointer' : 'not-allowed',
                  transition: 'background 120ms ease',
                }}
              >
                <Send size={10} />
                {sending ? 'sending…' : 'send'}
              </button>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
                ⌘↵
              </span>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1.5"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'background 120ms ease, border-color 120ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--bg-elevated)';
                  e.currentTarget.style.borderColor = 'var(--border-default)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                }}
                title="attach file"
                type="button"
              >
                <Paperclip size={10} />
                attach
              </button>
            </div>
            {userEmail && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-muted)' }}>
                from {userEmail}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
