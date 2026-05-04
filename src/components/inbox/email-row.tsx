'use client';

import { useRef, useState } from 'react';
import { ParsedEmail } from '@/types/gmail';
import { formatEmailDate, formatFutureDate, formatRelativeDate } from '@/lib/date-utils';
import { Star, CheckCircle2 } from 'lucide-react';

interface EmailRowProps {
  email: ParsedEmail;
  isSelected: boolean;
  isArchiving: boolean;
  sectionLabelIds?: string[];
  onClick: () => void;
  onHover?: () => void;
  onSwipeLeft?: () => void;  // archive
  onSwipeRight?: () => void; // snooze
}

const SWIPE_THRESHOLD = 96;
const SWIPE_DEADZONE = 12;

export function EmailRow({ email, isSelected, isArchiving, sectionLabelIds, onClick, onHover, onSwipeLeft, onSwipeRight }: EmailRowProps) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const isSwiping = useRef(false);
  const multiTouch = useRef(false);

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length > 1) {
      multiTouch.current = true;
      isSwiping.current = false;
      setSwipeOffset(0);
      return;
    }
    multiTouch.current = false;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = false;
  }

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length > 1 || multiTouch.current) {
      multiTouch.current = true;
      isSwiping.current = false;
      if (swipeOffset !== 0) setSwipeOffset(0);
      return;
    }
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    if (!isSwiping.current) {
      if (Math.abs(dx) < SWIPE_DEADZONE || Math.abs(dy) > Math.abs(dx)) return;
      isSwiping.current = true;
    }
    setSwipeOffset(Math.max(-140, Math.min(140, dx)));
  }

  function onTouchEnd() {
    const dx = swipeOffset;
    const wasSwiping = isSwiping.current && !multiTouch.current;
    setSwipeOffset(0);
    isSwiping.current = false;
    multiTouch.current = false;
    if (!wasSwiping) return;
    if (dx < -SWIPE_THRESHOLD) onSwipeLeft?.();
    else if (dx > SWIPE_THRESHOLD) onSwipeRight?.();
  }

  function onTouchCancel() {
    setSwipeOffset(0);
    isSwiping.current = false;
    multiTouch.current = false;
  }

  const actionLeft = swipeOffset < -16;
  const actionRight = swipeOffset > 16;

  const isUnread = email.isUnread;
  const isArchived =
    sectionLabelIds &&
    !email.labelIds.includes('INBOX') &&
    !sectionLabelIds.some((id) => email.labelIds.includes(id));

  const metaLabel = email.snoozeUntil
    ? `returns ${formatFutureDate(email.snoozeUntil)}`
    : email.reminderDate
      ? `reminder returned ${formatRelativeDate(email.reminderDate)}`
      : null;

  return (
    <div className="relative overflow-hidden" style={{ touchAction: 'pan-y' }}>
      {(actionLeft || actionRight) && (
        <div
          className="absolute inset-0 flex items-center px-6"
          style={{
            background: actionLeft ? 'rgba(181, 55, 31, 0.10)' : 'rgba(181, 55, 31, 0.06)',
            justifyContent: actionLeft ? 'flex-end' : 'flex-start',
          }}
        >
          <span style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontSize: '12px', color: 'var(--accent-bright)' }}>
            {actionLeft ? 'archive' : 'snooze'}
          </span>
        </div>
      )}

      <button
        onClick={isSwiping.current ? undefined : onClick}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onMouseEnter={onHover}
        className="w-full text-left relative flex flex-wrap md:flex-nowrap items-baseline gap-x-3 md:gap-x-[14px] gap-y-1.5 md:gap-y-0 px-4 md:px-6 py-3 md:py-[9px]"
        style={{
          fontSize: '12.5px',
          background: isSelected ? 'var(--selected-bg)' : 'transparent',
          borderLeft: isSelected ? '2px solid var(--selected-border)' : '2px solid transparent',
          opacity: isArchiving ? 0.3 : 1,
          transition: swipeOffset !== 0 ? 'none' : 'opacity 150ms ease, background 120ms ease',
          transform: swipeOffset !== 0 ? `translateX(${swipeOffset}px)` : undefined,
        }}
      >
        {/* Unread dot */}
        <span
          className="flex-shrink-0"
          style={{
            width: '8px',
            color: 'var(--accent-bright)',
            fontSize: '10px',
            lineHeight: 1,
            transform: 'translateY(-1px)',
          }}
        >
          {isUnread ? '●' : ''}
        </span>

        {/* Sender (serif italic) */}
        <span
          className="flex-1 md:flex-none md:w-[150px] min-w-0 truncate"
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '14px',
            fontStyle: 'italic',
            color: isUnread ? 'var(--text-primary)' : 'var(--text-muted)',
            fontWeight: isUnread ? 500 : 400,
          }}
        >
          {email.fromName || email.fromEmail}
        </span>

        {/* Subject + preview */}
        <span
          className="order-last md:order-none basis-full md:basis-0 md:flex-1 min-w-0 flex flex-col gap-1 md:gap-0 md:block md:truncate"
        >
          <span className="block md:inline truncate md:whitespace-normal">
            <span
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: '14.5px',
                color: isUnread ? 'var(--text-primary)' : 'var(--text-muted)',
                fontWeight: isUnread ? 500 : 400,
                letterSpacing: '-0.005em',
                marginRight: '10px',
              }}
            >
              {email.subject || '(no subject)'}
            </span>
            {(email.messageCount ?? 1) > 1 && (
              <span
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                  fontFeatureSettings: '"tnum"',
                  marginRight: '8px',
                }}
              >
                ({email.messageCount})
              </span>
            )}
          </span>
          {metaLabel ? (
            <span
              className="line-clamp-2 md:line-clamp-none md:inline"
              style={{
                fontFamily: 'var(--font-serif)',
                fontStyle: 'italic',
                color: 'var(--text-muted)',
                fontSize: '12px',
              }}
            >
              {metaLabel}
            </span>
          ) : (
            <span
              className="line-clamp-2 md:line-clamp-none md:inline"
              style={{ color: 'var(--text-muted)', fontSize: '12px' }}
            >
              {email.snippet}
            </span>
          )}
        </span>

        {email.hasAttachments && (
          <span
            title="has attachment"
            style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0 }}
          >
            ❧
          </span>
        )}
        {email.isImportant && (
          <span
            title="important"
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '12px',
              fontStyle: 'italic',
              color: 'var(--accent-bright)',
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            !
          </span>
        )}
        {email.isStarred && (
          <Star size={13} fill="currentColor" stroke="currentColor" style={{ flexShrink: 0, color: 'var(--accent-bright)' }} />
        )}
        {isArchived && (
          <span title="archived">
            <CheckCircle2 size={10} style={{ color: 'var(--text-muted)', flexShrink: 0, opacity: 0.7 }} />
          </span>
        )}

        {/* Right-aligned date, uppercase tracking */}
        <span
          style={{
            width: '52px',
            flexShrink: 0,
            textAlign: 'right',
            color: 'var(--text-muted)',
            fontSize: '10px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            fontFeatureSettings: '"tnum"',
          }}
        >
          {formatEmailDate(email.date)}
        </span>
      </button>
    </div>
  );
}
