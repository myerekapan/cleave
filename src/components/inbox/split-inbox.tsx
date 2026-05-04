'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSections } from '@/hooks/use-sections';
import { usePreferences } from '@/hooks/use-preferences';
import { InboxSection } from './inbox-section';
import { AccountSwitcher } from './account-switcher';
import { FullscreenEmail, FullscreenEmailHandle } from './fullscreen-email';
import { SearchOverlay } from './search-overlay';
import { CommandPalette, Command } from './command-palette';
import { PickerModal } from './picker-modal';
import { SnoozeModal } from './snooze-modal';
import { TextInputModal } from './text-input-modal';
import { ComposePane, ComposeState } from './compose-pane';
import { CommandBar } from '@/components/ui/command-bar';
import { EmailActionBar } from './email-action-bar';
import { SidebarMenu } from './sidebar-menu';
import { useRouter } from 'next/navigation';
import { Settings, Menu, Search, Bug } from 'lucide-react';
import { useAuth } from '@/components/providers';
import { getAccessToken, getActiveEmail, setActiveEmail as setGmailActiveEmail, getAccounts, type Account } from '@/lib/gmail-token';
import { ParsedEmail, GmailApiError } from '@/types/gmail';
import { Section } from '@/types/preferences';
import {
  createLabel,
  createFilter,
  createFilterByQuery,
  deleteFilter,
  listAllInboxThreadsFromSender,
  listSectionableThreadsFromSender,
  listAllThreadIdsByQuery,
  listFilters,
  listLabels,
  modifyThread,
  getRateLimitUntil,
  ThreadMessage,
  processSnoozeReturns,
} from '@/lib/gmail';
import { toast } from 'sonner';


interface LinkOption {
  id: string;
  label: string;
  sublabel: string;
  url: string;
}

function extractLinksFromMessages(messages: ThreadMessage[]): LinkOption[] {
  const seen = new Set<string>();
  const links: LinkOption[] = [];

  for (const msg of messages) {
    const hrefs: { href: string; text: string }[] = [];

    if (msg.body.html) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(msg.body.html, 'text/html');
      doc.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href')?.trim();
        if (href) hrefs.push({ href, text: a.textContent?.trim() || '' });
      });
    } else if (msg.body.text) {
      const urlRegex = /https?:\/\/[^\s<>"')\]]+/g;
      let match;
      while ((match = urlRegex.exec(msg.body.text)) !== null) {
        hrefs.push({ href: match[0], text: '' });
      }
    }

    for (const { href, text } of hrefs) {
      if (href.startsWith('mailto:') || href.startsWith('javascript:') || href === '#') continue;
      if (seen.has(href)) continue;
      seen.add(href);
      try {
        const url = new URL(href);
        const label = text && text !== href ? text : url.hostname + (url.pathname !== '/' ? url.pathname : '');
        links.push({
          id: String(links.length),
          label: label.length > 60 ? label.slice(0, 57) + '…' : label,
          sublabel: url.hostname,
          url: href,
        });
      } catch {
        // skip invalid URLs
      }
    }
  }

  return links;
}

const GO_TO_VIEWS: { key: string; id: string; name: string; gmailLabel: string | null }[] = [
  { key: 'i', id: 'go-inbox', name: 'Inbox', gmailLabel: null },
  { key: 's', id: 'go-starred', name: 'Starred', gmailLabel: 'STARRED' },
  { key: 't', id: 'go-sent', name: 'Sent', gmailLabel: 'SENT' },
  { key: 'z', id: 'go-snoozed', name: 'Snoozed', gmailLabel: 'snoozed' },
  { key: 'd', id: 'go-drafts', name: 'Drafts', gmailLabel: 'DRAFT' },
  { key: 'p', id: 'go-spam', name: 'Spam', gmailLabel: 'SPAM' },
  { key: 'h', id: 'go-trash', name: 'Trash', gmailLabel: 'TRASH' },
  { key: 'a', id: 'go-all', name: 'All Mail', gmailLabel: 'all' },
];

export function SplitInbox() {
  const { sections, refresh, reorder } = useSections();
  const { prefs } = usePreferences();
  const [activeSectionId, setActiveSectionId] = useState('primary');
  const activeSectionIndex = Math.max(0, sections.findIndex(s => s.id === activeSectionId));
  const [activeEmailIndices, setActiveEmailIndices] = useState<Record<string, number>>({});
  const [emailCounts, setEmailCounts] = useState<Record<string, number>>({});
  const [hasMoreFlags, setHasMoreFlags] = useState<Record<string, boolean>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);
  const [previewEmail, setPreviewEmail] = useState<ParsedEmail | null>(null);
  const [specialView, setSpecialView] = useState<Section | null>(null);
  const [specialViewEmailIndex, setSpecialViewEmailIndex] = useState(0);
  const [specialViewEmailCount, setSpecialViewEmailCount] = useState(0);
  const [composeState, setComposeState] = useState<ComposeState | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [activeEmail, setActiveEmail] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [rateLimitedUntil, setRateLimitedUntil] = useState(0);
  const router = useRouter();
  const { signOut, user } = useAuth();
  const pendingGRef = useRef(false);
  const pendingGTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUndoRef = useRef<(() => void) | null>(null);
  const selectedEmailRef = useRef<ParsedEmail | null>(null);
  const pendingSectionSwitchRef = useRef<string | null>(null); // stores label ID to switch to after refresh
  const [senderScopeModal, setSenderScopeModal] = useState<{
    email: ParsedEmail;
    resolve: (scope: 'sender' | 'domain') => void;
  } | null>(null);
  const [sectionPickerModal, setSectionPickerModal] = useState<{
    email: ParsedEmail;
    resolve: (section: Section) => void;
  } | null>(null);
  const [nameInputModal, setNameInputModal] = useState<{
    defaultValue: string;
    resolve: (name: string) => void;
  } | null>(null);
  const [linkPickerLinks, setLinkPickerLinks] = useState<LinkOption[] | null>(null);
  const previewMessagesRef = useRef<ThreadMessage[]>([]);
  const fullscreenRef = useRef<FullscreenEmailHandle>(null);

  useEffect(() => {
    const check = () => {
      setHasToken(!!getAccessToken());
      setActiveEmail(getActiveEmail());
      setAccounts(getAccounts());
    };
    check();
    const onReady = () => check();
    const onAccountChanged = () => check();
    window.addEventListener('cleave:token-ready', onReady);
    window.addEventListener('cleave:account-changed', onAccountChanged);
    // Fallback timeout: if no token after 10s, let the UI show a recovery option
    const timeout = setTimeout(check, 10_000);
    return () => {
      window.removeEventListener('cleave:token-ready', onReady);
      window.removeEventListener('cleave:account-changed', onAccountChanged);
      clearTimeout(timeout);
    };
  }, []);

  // Listen for rate limit events and auto-clear when cooldown expires
  useEffect(() => {
    const onRateLimit = (e: Event) => {
      const until = (e as CustomEvent).detail?.until ?? 0;
      setRateLimitedUntil(until);
    };
    window.addEventListener('cleave:rate-limited', onRateLimit);
    return () => window.removeEventListener('cleave:rate-limited', onRateLimit);
  }, []);

  useEffect(() => {
    if (!rateLimitedUntil) return;
    const remaining = rateLimitedUntil - Date.now();
    if (remaining <= 0) { setRateLimitedUntil(0); return; }
    const timer = setTimeout(() => setRateLimitedUntil(0), remaining);
    return () => clearTimeout(timer);
  }, [rateLimitedUntil]);

  // Check for snoozed emails that are due to return
  useEffect(() => {
    let cancelled = false;
    async function checkSnoozeReturns() {
      const token = getAccessToken();
      if (!token) return;
      try {
        const returned = await processSnoozeReturns(token);
        if (returned > 0 && !cancelled) {
          // Refresh all sections so the returned threads appear
          sections.forEach((s) => {
            window.dispatchEvent(new CustomEvent('cleave:refresh', { detail: { sectionId: s.id } }));
          });
          toast.success(`${returned} snoozed ${returned === 1 ? 'email' : 'emails'} returned`);
        }
      } catch { /* ignore — token may not be ready yet */ }
    }
    checkSnoozeReturns();
    const interval = setInterval(checkSnoozeReturns, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [sections]);

  // Update tab title with total unread count
  useEffect(() => {
    const total = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0);
    document.title = total > 0 ? `(${total}) Cleave` : 'Cleave';
  }, [unreadCounts]);

  // Auto-create Calendar section on first login
  useEffect(() => {
    if (!hasToken || sections.length === 0) return;
    if (localStorage.getItem('cleave:calendar-section-init')) return;
    if (sections.some((s) => s.name.toLowerCase().includes('calendar'))) return;

    const token = getAccessToken();
    if (!token) return;

    // Set guard BEFORE async work to prevent race condition
    localStorage.setItem('cleave:calendar-section-init', '1');

    (async () => {
      try {
        const labels = await listLabels(token);
        let calLabel = labels.find((l) => {
          if (!l.name.startsWith('Cleave/')) return false;
          const display = l.name.slice('Cleave/'.length).replace(/^\d+-/, '');
          return display.toLowerCase() === 'calendar';
        });
        if (!calLabel) {
          calLabel = await createLabel(token, 'Cleave/00-Calendar');
          await createFilterByQuery(token, 'filename:ics', calLabel.id);
          const threadIds = await listAllThreadIdsByQuery(token, 'filename:ics in:inbox');
          if (threadIds.length > 0) {
            await applyLabelToThreads(token, threadIds, [calLabel!.id], ['INBOX'], undefined, ['primary']);
          }
          await refresh();
          window.dispatchEvent(new CustomEvent('cleave:refresh', { detail: { sectionId: 'primary' } }));
        }
      } catch {
        // Clear guard on failure so it retries next time
        localStorage.removeItem('cleave:calendar-section-init');
      }
    })();
  }, [hasToken, sections, refresh]);

  const currentEmailIndex = specialView ? specialViewEmailIndex : (activeEmailIndices[activeSectionId] ?? 0);
  const currentEmailCount = specialView ? specialViewEmailCount : (emailCounts[activeSectionId] ?? 0);

  const moveUp = useCallback(() => {
    if (specialView) {
      setSpecialViewEmailIndex((i) => Math.max(0, i - 1));
      return;
    }
    setActiveEmailIndices((prev) => ({
      ...prev,
      [activeSectionId]: Math.max(0, (prev[activeSectionId] ?? 0) - 1),
    }));
  }, [activeSectionId, specialView]);

  const moveDown = useCallback(() => {
    const max = currentEmailCount - 1;
    if (specialView) {
      setSpecialViewEmailIndex((i) => Math.min(max, i + 1));
      return;
    }
    setActiveEmailIndices((prev) => ({
      ...prev,
      [activeSectionId]: Math.min(max, (prev[activeSectionId] ?? 0) + 1),
    }));
  }, [activeSectionId, currentEmailCount, specialView]);

  const moveSectionLeft = useCallback(() => {
    if (specialView) { setSpecialView(null); return; }
    const idx = Math.max(0, activeSectionIndex - 1);
    setActiveSectionId(sections[idx]?.id ?? 'primary');
    setPreviewEmail(null);
  }, [activeSectionIndex, sections, specialView]);
  const moveSectionRight = useCallback(() => {
    if (specialView) { setSpecialView(null); return; }
    const idx = Math.min(sections.length - 1, activeSectionIndex + 1);
    setActiveSectionId(sections[idx]?.id ?? 'primary');
    setPreviewEmail(null);
  }, [activeSectionIndex, sections, specialView]);
  const moveSectionNext = useCallback(() => {
    if (specialView) { setSpecialView(null); return; }
    const idx = (activeSectionIndex + 1) % sections.length;
    setActiveSectionId(sections[idx]?.id ?? 'primary');
    setPreviewEmail(null);
  }, [activeSectionIndex, sections, specialView]);
  const moveSectionPrev = useCallback(() => {
    if (specialView) { setSpecialView(null); return; }
    const idx = (activeSectionIndex - 1 + sections.length) % sections.length;
    setActiveSectionId(sections[idx]?.id ?? 'primary');
    setPreviewEmail(null);
  }, [activeSectionIndex, sections, specialView]);

  function dispatchToSection(event: string, extra: Record<string, unknown> = {}) {
    if (specialView) {
      window.dispatchEvent(new CustomEvent(event, { detail: { sectionId: specialView.id, ...extra } }));
      return;
    }
    const section = sections[activeSectionIndex];
    if (!section) return;
    window.dispatchEvent(new CustomEvent(event, { detail: { sectionId: section.id, ...extra } }));
  }

  const archiveSelected = useCallback(() => {
    const wasPreviewOpen = !!previewEmail;
    const prevIdx = currentEmailIndex;
    const prevCount = emailCounts[activeSectionId] ?? 0;
    const secIdx = activeSectionIndex;

    dispatchToSection('cleave:archive');
    if (specialView) {
      setSpecialViewEmailIndex((i) => Math.min(i, Math.max(0, specialViewEmailCount - 2)));
    } else {
      setActiveEmailIndices((prev) => {
        const count = (emailCounts[activeSectionId] ?? 1) - 1;
        return { ...prev, [activeSectionId]: Math.min(prev[activeSectionId] ?? 0, Math.max(0, count - 1)) };
      });
    }

    if (!wasPreviewOpen || specialView) return;
    const remaining = prevCount - 1;
    const noNext = prefs.afterDone === 'next' && prevIdx >= prevCount - 1;
    const noPrev = prefs.afterDone === 'previous' && prevIdx <= 0;
    if (remaining <= 0 || prefs.afterDone === 'list' || noNext || noPrev) {
      setPreviewEmail(null);
      previewMessagesRef.current = [];
      return;
    }
    const targetIdx = prefs.afterDone === 'previous'
      ? prevIdx - 1
      : Math.min(prevIdx, remaining - 1);
    if (prefs.afterDone === 'previous') {
      setActiveEmailIndices((prev) => ({ ...prev, [activeSectionId]: targetIdx }));
    }
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('cleave:open', {
        detail: { sectionIndex: secIdx, emailIndex: targetIdx },
      }));
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, activeSectionId, activeSectionIndex, emailCounts, specialView, specialViewEmailCount, previewEmail, currentEmailIndex, prefs.afterDone]);

  const openSelected = useCallback(() => {
    window.dispatchEvent(new CustomEvent('cleave:open', {
      detail: { sectionIndex: specialView ? -1 : activeSectionIndex, emailIndex: currentEmailIndex },
    }));
  }, [activeSectionIndex, currentEmailIndex, specialView]);

  function starSelected() {
    dispatchToSection('cleave:star');
    if (previewEmail) {
      setPreviewEmail({ ...previewEmail, isStarred: !previewEmail.isStarred });
    }
  }

  // Global keyboard handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return;
      if (senderScopeModal || sectionPickerModal || nameInputModal || linkPickerLinks) return;

      // CMD+K → command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowCommandPalette((v) => !v);
        return;
      }

      // CMD+O → open links picker (when preview is open)
      if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
        e.preventDefault();
        if (previewEmail && previewMessagesRef.current.length > 0) {
          const links = extractLinksFromMessages(previewMessagesRef.current);
          if (links.length > 0) {
            setLinkPickerLinks(links);
          } else {
            toast('no links found in this email');
          }
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // G-prefix two-key nav
      if (pendingGRef.current) {
        pendingGRef.current = false;
        if (pendingGTimerRef.current) clearTimeout(pendingGTimerRef.current);
        const view = GO_TO_VIEWS.find((v) => v.key === e.key.toLowerCase());
        if (view) {
          e.preventDefault();
          if (view.id === 'go-inbox') {
            setSpecialView(null);
          } else {
            setPreviewEmail(null);
            setSpecialViewEmailIndex(0);
            setSpecialView({ id: view.id, name: view.name, gmailLabel: view.gmailLabel });
          }
          return;
        }
        // unrecognised second key — fall through to normal handling
      }

      // Escape closes overlays
      if (e.key === 'Escape') {
        if (showSidebar) { setShowSidebar(false); return; }
        if (composeState) { setComposeState(null); return; }
        if (previewEmail) { setPreviewEmail(null); return; }
        if (specialView) { setSpecialView(null); return; }
        if (showCommandPalette) { setShowCommandPalette(false); return; }
        if (showSearch) { setShowSearch(false); return; }
        if (showSnooze) { setShowSnooze(false); return; }
        setShowHelp(false);
        return;
      }

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          // Arrow keys navigate within a thread and stop at boundaries
          if (previewEmail) {
            const emailRef = fullscreenRef.current;
            if (emailRef && emailRef.messageCount > 1) {
              emailRef.navigateDown();
              break;
            }
          }
          // Fall through to thread navigation if not in a multi-message thread
          const nextArrowDown = Math.min(currentEmailCount - 1, currentEmailIndex + 1);
          if (specialView) {
            setSpecialViewEmailIndex(nextArrowDown);
          } else {
            setActiveEmailIndices((prev) => ({ ...prev, [activeSectionId]: nextArrowDown }));
          }
          if (previewEmail) window.dispatchEvent(new CustomEvent('cleave:open', { detail: { sectionIndex: specialView ? -1 : activeSectionIndex, emailIndex: nextArrowDown } }));
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          // Arrow keys navigate within a thread and stop at boundaries
          if (previewEmail) {
            const emailRef = fullscreenRef.current;
            if (emailRef && emailRef.messageCount > 1) {
              emailRef.navigateUp();
              break;
            }
          }
          // Fall through to thread navigation if not in a multi-message thread
          const nextArrowUp = Math.max(0, currentEmailIndex - 1);
          if (specialView) {
            setSpecialViewEmailIndex(nextArrowUp);
          } else {
            setActiveEmailIndices((prev) => ({ ...prev, [activeSectionId]: nextArrowUp }));
          }
          if (previewEmail) window.dispatchEvent(new CustomEvent('cleave:open', { detail: { sectionIndex: specialView ? -1 : activeSectionIndex, emailIndex: nextArrowUp } }));
          break;
        }
        case 'j': {
          e.preventDefault();
          // J always moves to the next thread
          const nextJ = Math.min(currentEmailCount - 1, currentEmailIndex + 1);
          if (specialView) {
            setSpecialViewEmailIndex(nextJ);
          } else {
            setActiveEmailIndices((prev) => ({ ...prev, [activeSectionId]: nextJ }));
          }
          if (previewEmail) window.dispatchEvent(new CustomEvent('cleave:open', { detail: { sectionIndex: specialView ? -1 : activeSectionIndex, emailIndex: nextJ } }));
          break;
        }
        case 'k': {
          e.preventDefault();
          // K always moves to the previous thread
          const nextK = Math.max(0, currentEmailIndex - 1);
          if (specialView) {
            setSpecialViewEmailIndex(nextK);
          } else {
            setActiveEmailIndices((prev) => ({ ...prev, [activeSectionId]: nextK }));
          }
          if (previewEmail) window.dispatchEvent(new CustomEvent('cleave:open', { detail: { sectionIndex: specialView ? -1 : activeSectionIndex, emailIndex: nextK } }));
          break;
        }
        case ' ': {
          e.preventDefault();
          const spaceRef = fullscreenRef.current;
          if (previewEmail && spaceRef) {
            spaceRef.toggleActive();
          } else {
            openSelected();
          }
          break;
        }
        case 'Tab': e.preventDefault(); e.shiftKey ? moveSectionPrev() : moveSectionNext(); break;
        case 'e': e.preventDefault(); archiveSelected(); break;
        case 'A': e.preventDefault(); dispatchToSection('cleave:archive-all'); break;
        case 'o': e.preventDefault(); openSelected(); break;
        case 'Enter': e.preventDefault(); previewEmail ? setComposeState({ mode: 'reply', email: previewEmail }) : openSelected(); break;
        case 'n': e.preventDefault(); moveDown(); openSelected(); break;
        case 'r': break; // reply is Enter when preview pane is open
        case 'f': e.preventDefault(); previewEmail ? setComposeState({ mode: 'forward', email: previewEmail }) : dispatchToSection('cleave:forward'); break;
        case 'u': e.preventDefault(); dispatchToSection('cleave:mark-unread'); break;
        case 's': e.preventDefault(); starSelected(); break;
        case 'i': e.preventDefault(); dispatchToSection('cleave:important'); break;
        case 'm': e.preventDefault(); dispatchToSection('cleave:mute'); break;
        case 'h': e.preventDefault(); setShowSnooze(true); break;
        case 'c': e.preventDefault(); setComposeState({ mode: 'new' }); break;
        case 'g':
          e.preventDefault();
          pendingGRef.current = true;
          if (pendingGTimerRef.current) clearTimeout(pendingGTimerRef.current);
          pendingGTimerRef.current = setTimeout(() => { pendingGRef.current = false; }, 1500);
          break;
        case 'z': e.preventDefault(); lastUndoRef.current?.(); lastUndoRef.current = null; break;
        case ',': e.preventDefault(); router.push('/settings'); break;
        case '/': e.preventDefault(); setShowSearch(true); break;
        case '?': e.preventDefault(); setShowHelp((v) => !v); break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveDown, moveUp, moveSectionNext, moveSectionPrev, archiveSelected, openSelected, router, previewEmail, showCommandPalette, showSearch, showSnooze, sections, activeSectionIndex, senderScopeModal, sectionPickerModal, nameInputModal, linkPickerLinks, specialView, currentEmailCount, composeState]);

  async function applyLabelToThreads(
    token: string,
    threadIds: string[],
    addLabelIds: string[],
    removeLabelIds: string[],
    onProgress?: (done: number, total: number) => void,
    removeSectionIds?: string[]
  ) {
    for (let i = 0; i < threadIds.length; i++) {
      let retries = 0;
      while (retries < 5) {
        try {
          await modifyThread(token, threadIds[i], { addLabelIds, removeLabelIds });
          break;
        } catch (err) {
          if (err instanceof GmailApiError && (err.status === 429 || err.status === 403) && retries < 4) {
            retries++;
            await new Promise((r) => setTimeout(r, 65_000));
          } else {
            throw err;
          }
        }
      }

      onProgress?.(i + 1, threadIds.length);

      // Optimistically remove from source sections (no API calls)
      if (removeSectionIds?.length) {
        for (const sectionId of removeSectionIds) {
          window.dispatchEvent(new CustomEvent('cleave:remove-threads', {
            detail: { threadIds: [threadIds[i]], sectionId }
          }));
        }
      }
    }
  }

  // Auto-switch to newly created section once it appears in the list
  useEffect(() => {
    if (!pendingSectionSwitchRef.current) return;
    const section = sections.find((s) => s.gmailLabel === pendingSectionSwitchRef.current);
    if (section) {
      pendingSectionSwitchRef.current = null;
      setActiveSectionId(section.id);
    }
  }, [sections]);

  function askSenderScope(email: ParsedEmail): Promise<'sender' | 'domain'> {
    return new Promise((resolve) => {
      setSenderScopeModal({ email, resolve });
    });
  }

  function askSectionName(defaultValue: string): Promise<string> {
    return new Promise((resolve) => {
      setNameInputModal({ defaultValue, resolve });
    });
  }

  function askSection(email: ParsedEmail): Promise<Section> {
    return new Promise((resolve) => {
      setSectionPickerModal({ email, resolve });
    });
  }

  async function createSectionFromSender() {
    const email = selectedEmailRef.current;
    if (!email) { toast.error('no email selected'); return; }
    const token = getAccessToken();
    if (!token) { toast.error('not authenticated'); return; }

    const scope = await askSenderScope(email);
    setSenderScopeModal(null);

    const domain = email.fromEmail.split('@')[1] ?? email.fromEmail;
    const senderEmail = scope === 'domain' ? `@${domain}` : email.fromEmail;
    const defaultName = scope === 'domain' ? domain : (email.fromName || email.fromEmail.split('@')[0]);

    const senderName = await askSectionName(defaultName);
    setNameInputModal(null);

    const nextOrder = String(sections.length).padStart(2, '0');
    const labelName = `Cleave/${nextOrder}-${senderName}`;

    const oldSections = sections.filter((s) => s.gmailLabel && email.labelIds?.includes(s.gmailLabel));
    const oldSectionLabels = oldSections.map((s) => s.gmailLabel!);
    const oldSectionIds = oldSections.map((s) => s.id);

    const toastId = toast.loading(`creating section for ${senderName}…`);
    try {
      const existing = (await listLabels(token)).find((l) => l.name.endsWith(`-${senderName}`) && l.name.startsWith('Cleave/'));
      const label = existing ?? await createLabel(token, labelName);

      // Delete old filters for this sender, then create the new one
      const allFilters = await listFilters(token);
      const cleaveLabelIds = new Set(sections.map((s) => s.gmailLabel).filter(Boolean));
      const oldFilters = allFilters.filter((f) =>
        f.criteria.from === senderEmail &&
        f.action.addLabelIds?.some((id) => cleaveLabelIds.has(id))
      );
      for (const f of oldFilters) {
        try { await deleteFilter(token, f.id); } catch { /* filter may already be gone */ }
      }
      try { await createFilter(token, senderEmail, label.id); } catch { /* already exists */ }

      pendingSectionSwitchRef.current = label.id;
      await refresh();
      const newSectionId = sections.find((s) => s.gmailLabel === label.id)?.id ?? label.id;

      const sectionLabelIds = sections.map((s) => s.gmailLabel).filter(Boolean) as string[];
      const threadIds = await listSectionableThreadsFromSender(token, senderEmail, sectionLabelIds);
      if (threadIds.length > 0) {
        toast.loading(`moving 0 of ${threadIds.length}…`, { id: toastId });
        await applyLabelToThreads(token, threadIds, [label.id], ['INBOX', ...oldSectionLabels],
          (done, total) => { toast.loading(`moving ${done} of ${total}…`, { id: toastId }); },
          ['primary', ...oldSectionIds]
        );
        // One final refresh for all affected sections
        window.dispatchEvent(new CustomEvent('cleave:refresh', { detail: { sectionId: 'primary' } }));
        if (newSectionId) window.dispatchEvent(new CustomEvent('cleave:refresh', { detail: { sectionId: newSectionId } }));
        oldSectionIds.forEach((id) => {
          window.dispatchEvent(new CustomEvent('cleave:refresh', { detail: { sectionId: id } }));
        });
      }

      toast.success(`section "${senderName}" created`, { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'failed', { id: toastId });
    }
  }

  async function addSenderToSection(preselectedSection?: Section) {
    const email = selectedEmailRef.current;
    if (!email) { toast.error('no email selected'); return; }
    const token = getAccessToken();
    if (!token) { toast.error('not authenticated'); return; }

    const labeledSections = sections.filter((s) => s.gmailLabel !== null);
    if (labeledSections.length === 0) { toast.error('no sections with labels yet — create one first'); return; }

    const section = preselectedSection ?? await askSection(email);
    setSectionPickerModal(null);
    if (!section.gmailLabel) return;

    const scope = await askSenderScope(email);
    setSenderScopeModal(null);

    const domain = email.fromEmail.split('@')[1] ?? email.fromEmail;
    const senderEmail = scope === 'domain' ? `@${domain}` : email.fromEmail;

    const oldSections = sections.filter((s) => s.gmailLabel && s.gmailLabel !== section.gmailLabel && email.labelIds?.includes(s.gmailLabel));
    const oldSectionLabels = oldSections.map((s) => s.gmailLabel!);
    const oldSectionIds = oldSections.map((s) => s.id);

    const toastId = toast.loading(`adding to ${section.name}…`);
    try {
      const sectionLabelIds = sections.map((s) => s.gmailLabel).filter(Boolean) as string[];
      const threadIds = await listSectionableThreadsFromSender(token, senderEmail, sectionLabelIds);
      if (threadIds.length > 0) {
        toast.loading(`moving 0 of ${threadIds.length}…`, { id: toastId });
        await applyLabelToThreads(token, threadIds, [section.gmailLabel], ['INBOX', ...oldSectionLabels],
          (done, total) => { toast.loading(`moving ${done} of ${total}…`, { id: toastId }); },
          ['primary', ...oldSectionIds]
        );
        // One final refresh for all affected sections
        window.dispatchEvent(new CustomEvent('cleave:refresh', { detail: { sectionId: 'primary' } }));
        window.dispatchEvent(new CustomEvent('cleave:refresh', { detail: { sectionId: section.id } }));
        oldSectionIds.forEach((id) => {
          window.dispatchEvent(new CustomEvent('cleave:refresh', { detail: { sectionId: id } }));
        });
      }

      // Delete old filters for this sender pointing to Cleave labels, then create the new one
      const allFilters = await listFilters(token);
      const cleaveLabelIds = new Set(sections.map((s) => s.gmailLabel).filter(Boolean));
      const oldFilters = allFilters.filter((f) =>
        f.criteria.from === senderEmail &&
        f.action.addLabelIds?.some((id) => cleaveLabelIds.has(id))
      );
      for (const f of oldFilters) {
        try { await deleteFilter(token, f.id); } catch { /* filter may already be gone */ }
      }
      try { await createFilter(token, senderEmail, section.gmailLabel); } catch { /* already exists */ }

      toast.success(`${scope === 'domain' ? `@${domain}` : email.fromName} → ${section.name}`, { id: toastId });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'failed', { id: toastId });
    }
  }

  // In special views, check if the selected email is already archived (not in INBOX)
  // Use previewEmail if open (has fresh labelIds), otherwise fall back to selectedEmailRef
  const selectedEmail = previewEmail ?? selectedEmailRef.current;
  const selectedInInbox = selectedEmail?.labelIds?.includes('INBOX') ?? true;
  const archiveLabel = specialView && !selectedInInbox ? 'unarchive' : 'archive';

  const commands: Command[] = [
    { id: 'compose', label: 'Compose new email', shortcut: 'C', action: () => setComposeState({ mode: 'new' }) },
    { id: 'reply', label: 'Reply', shortcut: '↵', action: () => previewEmail ? setComposeState({ mode: 'reply', email: previewEmail }) : dispatchToSection('cleave:reply') },
    { id: 'forward', label: 'Forward', shortcut: 'F', action: () => previewEmail ? setComposeState({ mode: 'forward', email: previewEmail }) : dispatchToSection('cleave:forward') },
    { id: 'archive', label: archiveLabel === 'archive' ? 'Archive' : 'Unarchive', shortcut: 'E', action: archiveSelected },
    { id: 'archive-all', label: 'Archive all in section', shortcut: 'Shift+A', action: () => dispatchToSection('cleave:archive-all') },
    { id: 'star', label: 'Star / Unstar', shortcut: 'S', action: () => starSelected() },
    { id: 'read', label: 'Mark read / unread', shortcut: 'U', action: () => dispatchToSection('cleave:mark-unread') },
    { id: 'important', label: 'Mark important', shortcut: 'I', action: () => dispatchToSection('cleave:important') },
    { id: 'mute', label: 'Mute thread', shortcut: 'M', action: () => dispatchToSection('cleave:mute') },
    { id: 'snooze', label: 'Snooze', shortcut: 'H', action: () => setShowSnooze(true) },
    { id: 'search', label: 'Search mail', shortcut: '/', action: () => setShowSearch(true) },
    { id: 'settings', label: 'Go to Settings', shortcut: ',', action: () => router.push('/settings') },
    { id: 'signout', label: 'Sign out', action: signOut },
    { id: 'create-section-from-sender', label: 'Create section from sender', action: createSectionFromSender },
    { id: 'add-sender-to-section', label: 'Add sender to section…', action: () => addSenderToSection() },
    ...GO_TO_VIEWS.filter((v) => v.id !== 'go-inbox').map((v) => ({
      id: v.id,
      label: `Go to ${v.name}`,
      shortcut: `G ${v.key.toUpperCase()}`,
      action: () => {
        setPreviewEmail(null);
        setSpecialViewEmailIndex(0);
        setSpecialView({ id: v.id, name: v.name, gmailLabel: v.gmailLabel });
      },
    })),
    { id: 'go-inbox', label: 'Go to Inbox', shortcut: 'G I', action: () => setSpecialView(null) },
    ...sections
      .filter((s) => s.gmailLabel !== null)
      .map((s) => ({
        id: `add-sender-to-${s.id}`,
        label: `Add sender to "${s.name}"`,
        action: () => addSenderToSection(s),
      })),
    { id: 'add-account', label: 'Add Gmail account', action: () => { window.location.href = '/api/google/oauth/start'; } },
    ...accounts
      .filter((a) => a.email !== activeEmail)
      .map((a) => ({
        id: `switch-to-${a.email}`,
        label: `Switch to ${a.email}`,
        action: () => setGmailActiveEmail(a.email),
      })),
  ];

  if (!hasToken) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <div className="text-center space-y-2">
          <span
            className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
            style={{ color: 'var(--text-muted)' }}
          />
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }}>
            connecting...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-base)' }}>
      {/* Top bar with tab navigation — editorial masthead */}
      <div
        className="flex items-end justify-between flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--border-subtle)',
          padding: '16px 24px 10px',
          gap: '20px',
          background: 'var(--bg-base)',
        }}
      >
        {/* Left: logo + tabs */}
        <div className="flex items-end min-w-0 flex-1" style={{ gap: '20px' }}>
          <div className="flex items-end gap-3 flex-shrink-0" style={{ paddingBottom: '2px' }}>
            <button
              onClick={() => setShowSidebar(true)}
              style={{ color: 'var(--text-muted)' }}
              title="Menu"
            >
              <Menu size={16} />
            </button>
            <span
              className="hidden md:inline"
              style={{
                fontFamily: 'var(--font-serif)',
                fontStyle: 'italic',
                fontSize: '18px',
                color: 'var(--text-primary)',
                letterSpacing: '-0.01em',
                fontWeight: 400,
                lineHeight: 1,
              }}
            >
              Cleave
            </span>
          </div>
          <div
            className="flex items-baseline scrollbar-hide"
            style={{ gap: '0', overflowX: 'auto', overflowY: 'hidden' }}
          >
            {sections.map((section, i) => {
              const isTab = activeSectionIndex === i;
              const total = emailCounts[section.id] ?? 0;
              const hasMore = hasMoreFlags[section.id] ?? false;
              const isDraggable = i > 0;
              const isDragging = draggingId === section.id;
              const isDragOver = dragOverId === section.id && draggingId !== section.id;
              return (
                <button
                  key={section.id}
                  onClick={() => { setActiveSectionId(section.id); setPreviewEmail(null); }}
                  draggable={isDraggable}
                  onDragStart={isDraggable ? (e) => {
                    e.dataTransfer.setData('text/plain', section.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingId(section.id);
                  } : undefined}
                  onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                  onDragOver={isDraggable ? (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDragOverId(section.id);
                  } : undefined}
                  onDragLeave={() => setDragOverId(null)}
                  onDrop={isDraggable ? (e) => {
                    e.preventDefault();
                    const fromId = e.dataTransfer.getData('text/plain');
                    const fromIndex = sections.findIndex(s => s.id === fromId);
                    if (fromIndex > 0 && fromIndex !== i) {
                      reorder(fromIndex, i);
                    }
                    setDraggingId(null);
                    setDragOverId(null);
                  } : undefined}
                  className="relative flex items-baseline flex-shrink-0 whitespace-nowrap"
                  style={{
                    outline: 'none',
                    opacity: isDragging ? 0.4 : 1,
                    padding: '0 14px',
                    gap: '6px',
                    borderLeft: isDragOver ? '2px solid var(--accent-bright)' : '2px solid transparent',
                    lineHeight: 1.3,
                  }}
                >
                  <span style={{
                    fontFamily: 'var(--font-serif)',
                    fontSize: isTab ? '22px' : '16px',
                    fontStyle: isTab ? 'normal' : 'italic',
                    fontWeight: isTab ? 500 : 400,
                    letterSpacing: '-0.015em',
                    color: isTab ? 'var(--text-primary)' : 'var(--text-muted)',
                    transition: 'color 120ms ease',
                    lineHeight: 1.3,
                  }}>
                    {section.name}
                  </span>
                  {total > 0 && (
                    <span style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: '10px',
                      fontWeight: 400,
                      color: isTab ? 'var(--accent-bright)' : 'var(--text-muted)',
                      fontFeatureSettings: '"tnum"',
                      letterSpacing: 0,
                    }}>
                      {hasMore ? '99+' : total}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: user + settings + sign out */}
        <div className="flex items-center gap-4 flex-shrink-0" style={{ paddingBottom: '3px' }}>
          <button
            onClick={() => setShowSearch(true)}
            style={{ color: 'var(--text-muted)' }}
            title="Search (/)"
          >
            <Search size={14} />
          </button>
          <button
            onClick={() => router.push('/settings')}
            style={{ color: 'var(--text-muted)' }}
            title="Settings (,)"
          >
            <Settings size={14} />
          </button>
          <a
            href="https://github.com/myerekapan/cleave/issues/new"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--text-muted)', display: 'inline-flex' }}
            title="Report a bug or send feedback"
          >
            <Bug size={14} />
          </a>
          <AccountSwitcher onSignOut={signOut} />
        </div>
      </div>

      {/* Single active section — all mounted to preserve loaded emails */}
      <div className="flex-1 min-h-0 relative">
        {sections.map((section, i) => (
          <div
            key={`${activeEmail ?? 'none'}:${section.id}`}
            style={{ display: activeSectionIndex === i ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}
          >
            <InboxSection
              section={section}
              sectionIndex={i}
              isActive={true}
              hideHeader={true}
              allSections={sections}
              userEmail={activeEmail ?? user?.email ?? undefined}
              activeEmailIndex={activeEmailIndices[section.id] ?? 0}
              onEmailCountChange={(count) => {
                setEmailCounts((prev) => ({ ...prev, [section.id]: count }));
              }}
              onHasMoreChange={(more) => {
                setHasMoreFlags((prev) => ({ ...prev, [section.id]: more }));
              }}
              onUnreadCountChange={(count) => {
                setUnreadCounts((prev) => ({ ...prev, [section.id]: count }));
              }}
              onSectionClick={() => setActiveSectionId(section.id)}
              onEmailSelect={(idx) => setActiveEmailIndices((prev) => ({ ...prev, [section.id]: idx }))}
              onUndoReady={(fn) => { lastUndoRef.current = fn; }}
              onSelectedEmailChange={activeSectionIndex === i ? (email) => { selectedEmailRef.current = email; } : undefined}
              onPreviewEmail={setPreviewEmail}
              onCompose={setComposeState}
              onRequestSnooze={() => setShowSnooze(true)}
            />
          </div>
        ))}

        {/* Special view (Sent, Starred, Spam, etc.) */}
        {specialView && (
          <div className="absolute inset-0 flex flex-col z-30" key={`${activeEmail ?? 'none'}:special:${specialView.id}`} style={{ background: 'var(--bg-base)' }}>
            <InboxSection
              section={specialView}
              sectionIndex={-1}
              isActive={true}
              isSpecialView={true}
              allSections={sections}
              userEmail={activeEmail ?? user?.email ?? undefined}
              hideHeader={false}
              activeEmailIndex={specialViewEmailIndex}
              onEmailCountChange={(c) => setSpecialViewEmailCount(c)}
              onSectionClick={() => { }}
              onEmailSelect={(idx) => setSpecialViewEmailIndex(idx)}
              onPreviewEmail={setPreviewEmail}
              onCompose={setComposeState}
              onUndoReady={(fn) => { lastUndoRef.current = fn; }}
              onSelectedEmailChange={(email) => { selectedEmailRef.current = email; }}
              onRequestSnooze={() => setShowSnooze(true)}
            />
          </div>
        )}

        {/* Fullscreen email viewer — inside the relative container so absolute inset-0 fills the content area */}
        {previewEmail && (
          <FullscreenEmail
            ref={fullscreenRef}
            email={previewEmail}
            userEmail={user?.email ?? undefined}
            archiveLabel={archiveLabel}
            composeState={composeState?.mode !== 'new' ? composeState : null}
            onClose={() => { setPreviewEmail(null); previewMessagesRef.current = []; }}
            onArchive={archiveSelected}
            onReply={() => setComposeState({ mode: 'reply', email: previewEmail })}
            onForward={() => setComposeState({ mode: 'forward', email: previewEmail })}
            onStar={starSelected}
            onMessagesLoaded={(msgs) => {
              previewMessagesRef.current = msgs;
              const freshStarred = msgs.some((m) => m.labelIds?.includes('STARRED'));
              const freshImportant = msgs.some((m) => m.labelIds?.includes('IMPORTANT'));
              const freshUnread = msgs.some((m) => m.labelIds?.includes('UNREAD'));
              setPreviewEmail((cur) => {
                if (!cur) return cur;
                if (cur.isStarred === freshStarred && cur.isImportant === freshImportant && cur.isUnread === freshUnread) return cur;
                return { ...cur, isStarred: freshStarred, isImportant: freshImportant, isUnread: freshUnread };
              });
              if (previewEmail) {
                window.dispatchEvent(new CustomEvent('cleave:sync-email', {
                  detail: { threadId: previewEmail.threadId, isStarred: freshStarred, isImportant: freshImportant, isUnread: freshUnread },
                }));
              }
            }}
            onComposeClose={() => setComposeState(null)}
          />
        )}
      </div>

      {previewEmail ? (
        <>
          <div className="md:hidden">
            <EmailActionBar
              isStarred={previewEmail.isStarred}
              archiveLabel={archiveLabel}
              onMarkUnread={() => {
                dispatchToSection('cleave:mark-unread');
                setPreviewEmail(null);
                previewMessagesRef.current = [];
              }}
              onStar={starSelected}
              onSnooze={() => setShowSnooze(true)}
              onArchive={archiveSelected}
              onMoveToSection={() => addSenderToSection()}
              onReply={() => setComposeState({ mode: 'reply', email: previewEmail, replyAll: false })}
              onReplyAll={() => setComposeState({ mode: 'reply', email: previewEmail, replyAll: true })}
              onForward={() => setComposeState({ mode: 'forward', email: previewEmail })}
            />
          </div>
          <div className="hidden md:block">
            <CommandBar />
          </div>
        </>
      ) : (
        <div className="hidden md:block">
          <CommandBar />
        </div>
      )}

      {/* Sidebar menu */}
      {showSidebar && (
        <SidebarMenu
          userEmail={user?.email ?? undefined}
          sections={sections}
          activeSectionId={activeSectionId}
          specialViewId={specialView?.id ?? null}
          onNavigateFolder={(folder) => {
            if (folder.id === 'go-inbox') {
              setSpecialView(null);
              setActiveSectionId('primary');
            } else {
              setPreviewEmail(null);
              setSpecialViewEmailIndex(0);
              setSpecialView({ id: folder.id, name: folder.name, gmailLabel: folder.gmailLabel });
            }
          }}
          onNavigateSection={(sectionId) => {
            setSpecialView(null);
            setPreviewEmail(null);
            setActiveSectionId(sectionId);
          }}
          onClose={() => setShowSidebar(false)}
        />
      )}

      {/* Compose pane — floating only for new compose or when no email view is open */}
      {composeState && (composeState.mode === 'new' || !previewEmail) && (
        <ComposePane
          {...composeState}
          userEmail={user?.email ?? undefined}
          onClose={() => setComposeState(null)}
        />
      )}

      {/* Command palette */}
      {showCommandPalette && (
        <CommandPalette
          commands={commands}
          onClose={() => setShowCommandPalette(false)}
        />
      )}

      {/* Search overlay (opened from command palette) */}
      {showSearch && (
        <SearchOverlay
          onClose={() => setShowSearch(false)}
          onPreview={(email) => { setPreviewEmail(email); }}
        />
      )}

      {/* Section picker */}
      {sectionPickerModal && (
        <PickerModal
          title="ADD TO SECTION"
          options={sections
            .filter((s) => s.gmailLabel !== null)
            .map((s) => ({ id: s.id, label: s.name }))}
          onSelect={(id) => {
            const s = sections.find((s) => s.id === id);
            if (s) { sectionPickerModal.resolve(s); setSectionPickerModal(null); }
          }}
          onClose={() => setSectionPickerModal(null)}
        />
      )}

      {/* Section name input */}
      {nameInputModal && (
        <TextInputModal
          title="SECTION NAME"
          defaultValue={nameInputModal.defaultValue}
          placeholder="e.g. GitHub"
          onConfirm={(name) => { nameInputModal.resolve(name); setNameInputModal(null); }}
          onClose={() => setNameInputModal(null)}
        />
      )}

      {/* Sender scope picker */}
      {senderScopeModal && (
        <PickerModal
          title={`FILTER BY — ${senderScopeModal.email.fromName || senderScopeModal.email.fromEmail}`}
          options={[
            { id: 'sender', label: `just ${senderScopeModal.email.fromEmail}` },
            { id: 'domain', label: `all of @${senderScopeModal.email.fromEmail.split('@')[1]}` },
          ]}
          onSelect={(id) => { senderScopeModal.resolve(id as 'sender' | 'domain'); setSenderScopeModal(null); }}
          onClose={() => setSenderScopeModal(null)}
        />
      )}

      {/* Link picker */}
      {linkPickerLinks && (
        <PickerModal
          title="OPEN LINK"
          options={linkPickerLinks}
          onSelect={(id) => {
            const link = linkPickerLinks.find((l) => l.id === id);
            if (link) window.open(link.url, '_blank');
            setLinkPickerLinks(null);
          }}
          onClose={() => setLinkPickerLinks(null)}
        />
      )}

      {/* Snooze picker */}
      {showSnooze && (
        <SnoozeModal
          onSelect={(until, label) => {
            dispatchToSection('cleave:snooze', { label, until: until.toISOString() });
            setShowSnooze(false);
            if (previewEmail) {
              setPreviewEmail(null);
              previewMessagesRef.current = [];
            }
            if (specialView) {
              setSpecialViewEmailIndex((i) => Math.min(i, Math.max(0, specialViewEmailCount - 2)));
            } else {
              setActiveEmailIndices((prev) => {
                const count = (emailCounts[activeSectionId] ?? 1) - 1;
                return { ...prev, [activeSectionId]: Math.min(prev[activeSectionId] ?? 0, Math.max(0, count - 1)) };
              });
            }
          }}
          onClose={() => setShowSnooze(false)}
        />
      )}

      {/* Rate limit banner */}
      {rateLimitedUntil > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-40 flex items-center gap-3 px-5 py-2.5"
          style={{
            background: 'var(--bg-elevated)',
            borderTop: '1px solid var(--border-default)',
          }}
        >
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '10px',
            fontWeight: '600',
            color: 'var(--text-muted)',
            letterSpacing: '0.05em',
          }}>
            NOTE
          </span>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '11px',
            color: 'var(--text-secondary)',
          }}>
            Gmail is temporarily throttling requests. Try again in a moment.
          </span>
        </div>
      )}

      {/* Help overlay */}
      {showHelp && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setShowHelp(false)}
        >
          <div
            className="p-8 w-80"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', letterSpacing: '0.1em', marginBottom: '16px' }}>
              KEYBOARD SHORTCUTS
            </h2>
            <div className="space-y-2">
              {[
                ['J / K', 'navigate down / up'],
                ['H / L', 'prev / next section'],
                ['Tab / ⇧Tab', 'cycle sections fwd / back'],
                ['↵ / O', 'open preview / reply in preview'],
                ['N', 'next + preview'],
                ['E', 'archive'],
                ['Shift+A', 'archive all in section'],
                ['S', 'star / unstar'],
                ['I', 'mark important'],
                ['U', 'mark read / unread'],
                ['↵', 'reply (in preview)'],
                ['F', 'forward'],
                ['M', 'mute thread'],
                ['H', 'snooze'],
                ['C', 'compose'],
                ['⌘O', 'open links (in preview)'],
                ['/', 'search'],
                ['G → I/S/T/Z', 'go to inbox/starred/sent/snoozed'],
                ['G → D/P/H/A', 'go to drafts/spam/trash/all mail'],
                [',', 'settings'],
                ['?', 'toggle help'],
                ['Esc', 'close'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between gap-6">
                  <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-primary)', flexShrink: 0 }}>
                    {key}
                  </kbd>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-muted)', textAlign: 'right' }}>
                    {desc}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
