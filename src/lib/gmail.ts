import {
  GmailMessage,
  GmailMessagePayload,
  GmailThread,
  GmailLabel,
  ParsedEmail,
  Attachment,
  TokenExpiredError,
  GmailApiError,
} from '@/types/gmail';
import { refreshAccessToken } from '@/lib/gmail-token';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Global rate-limit cooldown: no requests fire until this timestamp passes
let rateLimitUntil = 0;

/** Returns the timestamp (ms) until which requests are blocked, or 0 if not rate-limited. */
export function getRateLimitUntil(): number {
  return Date.now() < rateLimitUntil ? rateLimitUntil : 0;
}

/**
 * Resets module-level state that's tied to a specific Gmail account
 * (rate-limit cooldown, cached snooze label id). Call after switching the
 * active account so the next request doesn't carry stale state.
 */
export function resetGmailRuntime(): void {
  rateLimitUntil = 0;
  snoozeLabelId = null;
}

if (typeof window !== 'undefined') {
  const w = window as Window & { __cleaveGmailResetInstalled?: boolean };
  if (!w.__cleaveGmailResetInstalled) {
    w.__cleaveGmailResetInstalled = true;
    window.addEventListener('cleave:account-changed', () => resetGmailRuntime());
  }
}

function parseRetryAfter(body: string): number {
  try {
    const parsed = JSON.parse(body);
    const match = parsed?.error?.message?.match(/Retry after (.+)/);
    if (match) {
      const retryDate = new Date(match[1]).getTime();
      if (retryDate > Date.now()) return retryDate + 2000; // add 2s buffer
    }
  } catch { /* ignore */ }
  return Date.now() + 30_000; // fallback: 30s cooldown
}

async function rawFetch(
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  // Block all requests during global cooldown
  if (Date.now() < rateLimitUntil) {
    throw new GmailApiError(429, JSON.stringify({
      error: { code: 429, message: `Rate limited — cooling down until ${new Date(rateLimitUntil).toISOString()}` }
    }));
  }

  const res = await fetch(`${GMAIL_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 401) throw new TokenExpiredError();
  if (res.status === 429 || (res.status === 403 && !path.includes('/modify'))) {
    const body = await res.text().catch(() => '');
    rateLimitUntil = parseRetryAfter(body);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cleave:rate-limited', { detail: { until: rateLimitUntil } }));
    }
    throw new GmailApiError(res.status, body);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GmailApiError(res.status, body);
  }

  return res;
}

/** Parse wait time from a Gmail 429 error's Retry-After timestamp. */
function parseRetryAfterMs(err: GmailApiError): number {
  try {
    const body = JSON.parse(err.message);
    const match = body?.error?.message?.match(/Retry after (.+)/);
    if (match) {
      const retryDate = new Date(match[1]).getTime();
      const delta = retryDate - Date.now();
      if (delta > 0) return Math.min(delta + 500, 60_000);
    }
  } catch { /* ignore parse errors */ }
  return 0;
}

/** Fetch with automatic retry on 401 (token refresh) and 429/403 (rate limit backoff). */
async function gmailFetch(
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  let currentToken = token;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      return await rawFetch(currentToken, path, options);
    } catch (err) {
      if (err instanceof TokenExpiredError && attempt === 0) {
        currentToken = await refreshAccessToken();
        continue;
      }
      if (err instanceof GmailApiError && (err.status === 429 || err.status === 403) && attempt < 2) {
        const retryMs = parseRetryAfterMs(err) || Math.min(3000 * 2 ** attempt, 15_000);
        await new Promise((r) => setTimeout(r, retryMs));
        continue;
      }
      throw err;
    }
  }
  // Unreachable, but TypeScript needs it
  throw new Error('gmailFetch: exhausted retries');
}

export async function listMessages(
  token: string,
  options: {
    labelIds?: string[];
    query?: string;
    maxResults?: number;
    pageToken?: string;
  }
): Promise<{ messages: { id: string; threadId: string }[]; nextPageToken?: string }> {
  const params = new URLSearchParams();
  params.set('maxResults', String(options.maxResults ?? 25));
  if (options.query) params.set('q', options.query);
  if (options.pageToken) params.set('pageToken', options.pageToken);
  if (options.labelIds) {
    options.labelIds.forEach((id) => params.append('labelIds', id));
  }

  const res = await gmailFetch(token, `/messages?${params}`);
  const data = await res.json();
  return {
    messages: data.messages ?? [],
    nextPageToken: data.nextPageToken,
  };
}

export async function getMessage(
  token: string,
  messageId: string
): Promise<GmailMessage> {
  const params = new URLSearchParams({ format: 'metadata' });
  params.append('metadataHeaders', 'From');
  params.append('metadataHeaders', 'Subject');
  params.append('metadataHeaders', 'Date');

  const res = await gmailFetch(token, `/messages/${messageId}?${params}`);
  return res.json();
}

export interface MessageRecipientHeaders {
  to: string;
  cc: string;
  bcc: string;
  dateMs: number;
}

export async function getMessageRecipientHeaders(
  token: string,
  messageId: string
): Promise<MessageRecipientHeaders> {
  const params = new URLSearchParams({ format: 'metadata' });
  params.append('metadataHeaders', 'To');
  params.append('metadataHeaders', 'Cc');
  params.append('metadataHeaders', 'Bcc');
  params.append('metadataHeaders', 'Date');

  const res = await gmailFetch(token, `/messages/${messageId}?${params}`);
  const data: GmailMessage = await res.json();
  const headers = data.payload?.headers ?? [];
  const pick = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';

  const dateHeader = pick('Date');
  const parsedDate = dateHeader ? Date.parse(dateHeader) : NaN;
  const internalDate = data.internalDate ? Number(data.internalDate) : NaN;
  const dateMs = Number.isFinite(parsedDate)
    ? parsedDate
    : Number.isFinite(internalDate)
    ? internalDate
    : Date.now();

  return { to: pick('To'), cc: pick('Cc'), bcc: pick('Bcc'), dateMs };
}

export async function modifyMessage(
  token: string,
  messageId: string,
  modifications: { addLabelIds?: string[]; removeLabelIds?: string[] }
): Promise<void> {
  await gmailFetch(token, `/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify(modifications),
  });
}

export async function modifyThread(
  token: string,
  threadId: string,
  modifications: { addLabelIds?: string[]; removeLabelIds?: string[] }
): Promise<void> {
  await gmailFetch(token, `/threads/${threadId}/modify`, {
    method: 'POST',
    body: JSON.stringify(modifications),
  });
}

// Fetch thread with metadata + parts structure (no body data) for attachment detection
export async function getThread(token: string, threadId: string): Promise<GmailThread> {
  // format=full with fields limits response to structure only — no body content
  const fields = 'id,snippet,messages(id,threadId,labelIds,snippet,internalDate,payload(headers,mimeType,parts(mimeType,filename)))';
  const params = new URLSearchParams({ format: 'full', fields });
  const res = await gmailFetch(token, `/threads/${threadId}?${params}`);
  return res.json();
}

export async function listThreads(
  token: string,
  options: { labelIds?: string[]; query?: string; maxResults?: number; pageToken?: string }
): Promise<{ threads: { id: string }[]; nextPageToken?: string; resultSizeEstimate?: number }> {
  const params = new URLSearchParams();
  params.set('maxResults', String(options.maxResults ?? 25));
  if (options.query) params.set('q', options.query);
  if (options.pageToken) params.set('pageToken', options.pageToken);
  if (options.labelIds) options.labelIds.forEach((id) => params.append('labelIds', id));
  const res = await gmailFetch(token, `/threads?${params}`);
  const data = await res.json();
  return { threads: data.threads ?? [], nextPageToken: data.nextPageToken, resultSizeEstimate: data.resultSizeEstimate };
}

export async function createLabel(token: string, name: string): Promise<GmailLabel> {
  const res = await gmailFetch(token, '/labels', {
    method: 'POST',
    body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
  });
  return res.json();
}

export async function updateLabel(token: string, labelId: string, updates: { name?: string }): Promise<GmailLabel> {
  const res = await gmailFetch(token, `/labels/${labelId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  return res.json();
}

export interface GmailFilter {
  id: string;
  criteria: { from?: string; to?: string; subject?: string; query?: string };
  action: { addLabelIds?: string[]; removeLabelIds?: string[] };
}

export async function listFilters(token: string): Promise<GmailFilter[]> {
  const res = await gmailFetch(token, '/settings/filters');
  const data = await res.json();
  return data.filter ?? [];
}

export async function createFilter(token: string, fromEmail: string, labelId: string): Promise<void> {
  await gmailFetch(token, '/settings/filters', {
    method: 'POST',
    body: JSON.stringify({
      criteria: { from: fromEmail },
      action: { addLabelIds: [labelId], removeLabelIds: ['INBOX'] },
    }),
  });
}

export async function deleteFilter(token: string, filterId: string): Promise<void> {
  await gmailFetch(token, `/settings/filters/${filterId}`, { method: 'DELETE' });
}

export async function listAllInboxThreadsFromSender(token: string, email: string): Promise<string[]> {
  return listAllThreadIdsByQuery(token, `from:${email} in:inbox`);
}

export async function listAllThreadsFromSender(token: string, email: string): Promise<string[]> {
  return listAllThreadIdsByQuery(token, `from:${email}`);
}

export async function createFilterByQuery(token: string, query: string, labelId: string): Promise<void> {
  await gmailFetch(token, '/settings/filters', {
    method: 'POST',
    body: JSON.stringify({
      criteria: { query },
      action: { addLabelIds: [labelId], removeLabelIds: ['INBOX'] },
    }),
  });
}

export async function listAllThreadIdsByQuery(token: string, query: string, labelIds?: string[]): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const res = await listThreads(token, { query, maxResults: 100, pageToken, labelIds });
    res.threads.forEach((t) => ids.push(t.id));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return ids;
}

export async function listSectionableThreadsFromSender(
  token: string,
  email: string,
  sectionLabelIds: string[]
): Promise<string[]> {
  const queries = [
    listAllThreadIdsByQuery(token, `from:${email}`, ['INBOX']),
    ...sectionLabelIds.map((id) => listAllThreadIdsByQuery(token, `from:${email}`, [id])),
  ];
  const results = await Promise.all(queries);
  return [...new Set(results.flat())];
}

export async function listLabels(token: string): Promise<GmailLabel[]> {
  const res = await gmailFetch(token, '/labels');
  const data = await res.json();
  return data.labels ?? [];
}

function detectAttachments(payload?: GmailMessagePayload): boolean {
  if (!payload?.parts) return false;
  return payload.parts.some(
    (p) =>
      (p.filename && p.filename.length > 0) ||
      p.mimeType?.startsWith('application/') ||
      (p.mimeType?.startsWith('image/') && p.filename)
  );
}

const SUPERHUMAN_REMINDER_EMAILS = ['reminder@superhuman.com', 'reminders@superhuman.com'];

const CLEAVE_SNOOZE_SUBJECT_RE = /\[Cleave Snooze until:(.+?)\]/;

function isSuperhumanReminderMsg(msg: GmailMessage): boolean {
  const from = (msg.payload?.headers ?? [])
    .find((h) => h.name.toLowerCase() === 'from')?.value ?? '';
  const match = from.match(/<(.+?)>/);
  const email = (match ? match[1] : from).toLowerCase();
  return SUPERHUMAN_REMINDER_EMAILS.includes(email);
}

function isCleaveSnoozeMarker(msg: GmailMessage): boolean {
  const subject = (msg.payload?.headers ?? [])
    .find((h) => h.name.toLowerCase() === 'subject')?.value ?? '';
  return CLEAVE_SNOOZE_SUBJECT_RE.test(subject);
}

function isReminderOrSnoozeMarker(msg: GmailMessage): boolean {
  return isSuperhumanReminderMsg(msg) || isCleaveSnoozeMarker(msg);
}

// --- Snooze ---

let snoozeLabelId: string | null = null;

export function getSnoozeLabelId(): string | null {
  return snoozeLabelId;
}

async function ensureSnoozeLabel(token: string): Promise<string> {
  if (snoozeLabelId) return snoozeLabelId;
  const labels = await listLabels(token);
  const existing = labels.find((l) => l.name === 'Cleave/Snoozed');
  if (existing) {
    snoozeLabelId = existing.id;
    return existing.id;
  }
  const created = await createLabel(token, 'Cleave/Snoozed');
  snoozeLabelId = created.id;
  return created.id;
}

export async function snoozeThread(
  token: string,
  threadId: string,
  userEmail: string,
  until: Date,
  subject: string
): Promise<void> {
  const labelId = await ensureSnoozeLabel(token);
  // Send a marker email to self within the thread first — sending to self
  // causes Gmail to add INBOX to the thread, so we modify labels AFTER.
  const markerSubject = `[Cleave Snooze until:${until.toISOString()}] ${subject}`;
  await sendMessage(token, {
    to: userEmail,
    subject: markerSubject,
    body: `This email was snoozed by Cleave until ${until.toLocaleString()}. It will return to your inbox when you next open Cleave after that time.`,
    threadId,
  });
  await modifyThread(token, threadId, {
    addLabelIds: [labelId],
    removeLabelIds: ['INBOX'],
  });
}

export async function unsnoozeThread(token: string, threadId: string): Promise<void> {
  const labelId = await ensureSnoozeLabel(token);
  await modifyThread(token, threadId, {
    addLabelIds: ['INBOX'],
    removeLabelIds: [labelId],
  });
}

export async function processSnoozeReturns(token: string): Promise<number> {
  const labelId = await ensureSnoozeLabel(token);
  const { threads } = await listThreads(token, { labelIds: [labelId], maxResults: 25 });
  if (!threads.length) return 0;

  const details = await batchGetThreads(token, threads);
  const now = Date.now();
  let returned = 0;

  for (const thread of details) {
    const msgs = thread.messages ?? [];
    // Find the latest Cleave snooze marker to get the snooze-until time
    const markers = msgs.filter(isCleaveSnoozeMarker);
    if (!markers.length) continue;
    const latestMarker = markers[markers.length - 1];
    const subject = (latestMarker.payload?.headers ?? [])
      .find((h) => h.name.toLowerCase() === 'subject')?.value ?? '';
    const match = subject.match(CLEAVE_SNOOZE_SUBJECT_RE);
    if (!match) continue;
    const snoozeUntil = new Date(match[1]).getTime();
    if (isNaN(snoozeUntil) || snoozeUntil > now) continue;

    // Snooze time has passed — return to inbox
    await modifyThread(token, thread.id, {
      addLabelIds: ['INBOX'],
      removeLabelIds: [labelId],
    });
    returned++;
  }

  return returned;
}

// Parse raw GmailMessage into a flat ParsedEmail for UI
export function parseEmail(msg: GmailMessage): ParsedEmail {
  const headers = msg.payload?.headers ?? [];
  const get = (name: string) =>
    fixMojibake(decodeRfc2047(headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''));

  const from = get('From');
  const nameMatch = from.match(/^"?([^"<]+)"?\s*<(.+?)>$/);
  const fromName = nameMatch ? nameMatch[1].trim() : from.split('@')[0];
  const fromEmail = nameMatch ? nameMatch[2] : from;
  const labelIds = msg.labelIds ?? [];

  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds,
    subject: get('Subject') || '(no subject)',
    from,
    fromName,
    fromEmail,
    date: get('Date'),
    snippet: decodeHtmlEntities(msg.snippet ?? ''),
    isUnread: labelIds.includes('UNREAD'),
    isStarred: labelIds.includes('STARRED'),
    isImportant: labelIds.includes('IMPORTANT'),
    hasAttachments: detectAttachments(msg.payload),
  };
}

// Parse a GmailThread into a ParsedEmail using the latest message for headers
export function parseThread(thread: GmailThread): ParsedEmail {
  const msgs = thread.messages ?? [];
  // Extract reminder date before filtering (Superhuman reminders + Cleave snooze markers)
  const reminderMsgs = msgs.filter((m) => isReminderOrSnoozeMarker(m));
  const realMsgs = msgs.filter((m) => !isReminderOrSnoozeMarker(m));
  const reminderDate = reminderMsgs.length > 0
    ? ((reminderMsgs[reminderMsgs.length - 1].payload?.headers ?? [])
        .find((h) => h.name.toLowerCase() === 'date')?.value ?? '')
    : undefined;
  // Extract snooze-until time from the latest Cleave snooze marker subject
  const snoozeMarkers = msgs.filter(isCleaveSnoozeMarker);
  const latestSnoozeSubject = snoozeMarkers.length > 0
    ? ((snoozeMarkers[snoozeMarkers.length - 1].payload?.headers ?? [])
        .find((h) => h.name.toLowerCase() === 'subject')?.value ?? '')
    : '';
  const snoozeUntil = latestSnoozeSubject.match(CLEAVE_SNOOZE_SUBJECT_RE)?.[1];
  const display = realMsgs.length > 0 ? realMsgs : msgs;
  const latest = display[display.length - 1] ?? display[0];
  if (!latest) {
    return {
      id: thread.id, threadId: thread.id, labelIds: [],
      subject: '(no subject)', from: '', fromName: '', fromEmail: '',
      date: '', snippet: decodeHtmlEntities(thread.snippet ?? ''), isUnread: false, isStarred: false,
    };
  }
  // Any real message in thread unread → thread is unread
  const anyUnread = realMsgs.some((m) => (m.labelIds ?? []).includes('UNREAD'));
  const anyStarred = realMsgs.some((m) => (m.labelIds ?? []).includes('STARRED'));
  const anyImportant = realMsgs.some((m) => (m.labelIds ?? []).includes('IMPORTANT'));
  const anyAttachment = realMsgs.some((m) => detectAttachments(m.payload));
  return {
    ...parseEmail(latest),
    isUnread: anyUnread,
    isStarred: anyStarred,
    isImportant: anyImportant,
    hasAttachments: anyAttachment,
    messageCount: realMsgs.length,
    ...(reminderDate ? { reminderDate } : {}),
    ...(snoozeUntil ? { snoozeUntil } : {}),
  };
}

// Fetch thread details in batches to avoid Gmail rate limits
async function batchGetThreads(token: string, threadIds: { id: string }[], batchSize = 10): Promise<GmailThread[]> {
  const results: GmailThread[] = [];
  for (let i = 0; i < threadIds.length; i += batchSize) {
    const batch = threadIds.slice(i, i + batchSize);
    const details = await Promise.all(batch.map((t) => getThread(token, t.id)));
    results.push(...details);
  }
  return results;
}

// Fetch all emails for a section using threads (1 row per thread, includes count)
// When existingEmails is provided, reuses cached data for threads that haven't changed,
// only fetching details for new threads. This dramatically reduces API calls on polling refreshes.
export async function fetchSectionEmails(
  token: string,
  gmailLabel: string | null,
  maxResults = 100,
  existingEmails?: ParsedEmail[],
  excludeLabelIds?: string[]
): Promise<{ emails: ParsedEmail[]; hasMore: boolean }> {
  // Special sentinels
  const isAllMail = gmailLabel === 'all';
  const isDone = gmailLabel === 'done';
  const isSnoozed = gmailLabel === 'snoozed';
  const resolvedLabel = isSnoozed ? await ensureSnoozeLabel(token) : gmailLabel;
  const labelIds = (isAllMail || isDone) ? undefined : resolvedLabel ? [resolvedLabel] : undefined;
  // Labeled sections live outside INBOX (the filter strips INBOX on arrival),
  // so snoozing — which only adds Cleave/Snoozed — leaves the section label
  // intact and the thread reappears on refetch. Exclude snoozed threads from
  // labeled-section queries. Primary uses in:inbox, which already excludes
  // snoozed threads (snoozeThread removes INBOX).
  const query = isDone
    ? '-in:inbox -in:spam -in:trash'
    : isAllMail
      ? 'in:anywhere -in:spam -in:trash'
      : isSnoozed
        ? undefined
        : resolvedLabel
          ? '-label:Cleave-Snoozed'
          : 'in:inbox';

  const { threads, nextPageToken } = await listThreads(token, { labelIds, query, maxResults });
  if (!threads.length) return { emails: [], hasMore: false };

  // Build map of existing emails by threadId to reuse cached data
  const existingMap = new Map<string, ParsedEmail>();
  if (existingEmails) {
    for (const e of existingEmails) existingMap.set(e.threadId, e);
  }

  // Only fetch threads we don't already have. For the snoozed view, also re-fetch
  // any cached entry missing snoozeUntil (cache from before the field existed).
  const newThreads = existingEmails
    ? threads.filter((t) => {
        const cached = existingMap.get(t.id);
        if (!cached) return true;
        if (isSnoozed && !cached.snoozeUntil) return true;
        return false;
      })
    : threads;

  const newDetails = newThreads.length > 0 ? await batchGetThreads(token, newThreads) : [];
  const newParsed = new Map<string, ParsedEmail>();
  for (const t of newDetails) newParsed.set(t.id, parseThread(t));

  // Merge: use new data for new threads, reuse existing for known threads
  let parsed = threads.map((t) => newParsed.get(t.id) ?? existingMap.get(t.id)!);

  // For Done view, filter out emails that still have a Cleave section label
  if (isDone && excludeLabelIds?.length) {
    const excludeSet = new Set(excludeLabelIds);
    parsed = parsed.filter((e) => !e.labelIds.some((id) => excludeSet.has(id)));
  }

  // Snoozed: soonest return first. Otherwise: latest message date first.
  if (isSnoozed) {
    parsed.sort((a, b) => {
      const da = a.snoozeUntil ? new Date(a.snoozeUntil).getTime() : Infinity;
      const db = b.snoozeUntil ? new Date(b.snoozeUntil).getTime() : Infinity;
      return da - db;
    });
  } else {
    parsed.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });
  }
  return { emails: parsed, hasMore: !!nextPageToken };
}

// Search emails across all mail with a free-text query
export async function searchEmails(
  token: string,
  query: string,
  maxResults = 10
): Promise<ParsedEmail[]> {
  const { messages } = await listMessages(token, { query, maxResults });
  if (!messages.length) return [];

  const details = await Promise.all(messages.map((m) => getMessage(token, m.id)));
  return details.map(parseEmail);
}

// Search threads across all mail with a free-text query (returns thread-level results)
export async function searchThreads(
  token: string,
  query: string,
  maxResults = 15
): Promise<ParsedEmail[]> {
  const { threads } = await listThreads(token, { query, maxResults });
  if (!threads.length) return [];
  const details = await batchGetThreads(token, threads);
  return details.map(parseThread);
}

// Windows-1252 chars (0x80–0x9F) that map to Unicode code points outside Latin-1.
// Reverse map: Unicode code point → original Windows-1252 byte value.
const WIN1252_TO_BYTE: Record<number, number> = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84,
  0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88,
  0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C,
  0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93,
  0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B,
  0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F,
};

// Fix mojibake: UTF-8 bytes that were misinterpreted as Windows-1252 (possibly twice).
// e.g. "ó" → "Ã³" (single) → "ÃƒÂ³" (double)
function fixMojibake(str: string): string {
  function hasSuspiciousChars(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c >= 0x80 && c <= 0xFF) return true;
      if (c in WIN1252_TO_BYTE) return true;
    }
    return false;
  }

  if (!hasSuspiciousChars(str)) return str;

  function tryDecode(s: string): string | null {
    try {
      const bytes = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code <= 0xFF) {
          bytes[i] = code;
        } else {
          const byte = WIN1252_TO_BYTE[code];
          if (byte === undefined) return null;
          bytes[i] = byte;
        }
      }
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }

  const once = tryDecode(str);
  if (once === null) return str;
  if (hasSuspiciousChars(once)) {
    const twice = tryDecode(once);
    if (twice !== null) return twice;
  }
  return once;
}

// Decode RFC 2047 encoded-words in email headers (=?charset?encoding?text?=)
function decodeRfc2047(value: string): string {
  return value.replace(
    /=\?([^?]+)\?(B|Q)\?([^?]*)\?=/gi,
    (_, charset: string, encoding: string, text: string) => {
      let bytes: Uint8Array;
      if (encoding.toUpperCase() === 'B') {
        const binary = atob(text);
        bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      } else {
        // Quoted-Printable: underscores are spaces, =XX is hex
        const raw = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (__, hex) =>
          String.fromCharCode(parseInt(hex, 16))
        );
        bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      }
      try {
        return new TextDecoder(charset).decode(bytes);
      } catch {
        return new TextDecoder('utf-8').decode(bytes);
      }
    }
  );
}

// Decode HTML entities (&#39; &amp; &lt; etc.) that Gmail bakes into snippets and text bodies
function decodeHtmlEntities(str: string): string {
  if (!str.includes('&')) return str;
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

// Decode base64url to UTF-8 string
function decodeBase64url(data: string): string {
  try {
    const binary = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

// Recursively extract text/html and text/plain from a payload
function extractBodyFromPayload(payload: GmailMessagePayload): { html: string | null; text: string | null } {
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return { html: decodeBase64url(payload.body.data), text: null };
  }
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return { html: null, text: decodeHtmlEntities(decodeBase64url(payload.body.data)) };
  }
  if (payload.parts) {
    let html: string | null = null;
    let text: string | null = null;
    for (const part of payload.parts) {
      const result = extractBodyFromPayload(part);
      if (result.html) html = result.html;
      if (result.text && !text) text = result.text;
    }
    return { html, text };
  }
  return { html: null, text: null };
}

// Encode a string to base64url (handles UTF-8)
function toBase64url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Encode a Uint8Array to standard base64 (NOT url-safe), wrapped at 76 chars per RFC 2045.
// Chunks the array to avoid "Maximum call stack size exceeded" via String.fromCharCode(...big).
function bytesToBase64Wrapped(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk) as unknown as number[]);
  }
  const b64 = btoa(binary);
  return b64.replace(/(.{76})/g, '$1\r\n');
}

// RFC 2047 encode a header value if it contains non-ASCII characters (e.g. unicode filenames).
function encodeHeaderWordIfNeeded(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

// Send an email via Gmail API (RFC 2822, base64url encoded)
export async function sendMessage(
  token: string,
  opts: {
    to: string; cc?: string; bcc?: string; subject: string;
    body: string; html?: string; threadId?: string;
    inReplyTo?: string; references?: string;
    attachments?: Array<{ filename: string; mimeType: string; data: Uint8Array }>;
  }
): Promise<void> {
  let message: string;

  const headers = [`To: ${opts.to}`];
  if (opts.cc) headers.push(`Cc: ${opts.cc}`);
  if (opts.bcc) headers.push(`Bcc: ${opts.bcc}`);
  headers.push(`Subject: ${opts.subject}`);
  if (opts.inReplyTo) headers.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) headers.push(`References: ${opts.references}`);

  const hasAttachments = !!(opts.attachments && opts.attachments.length > 0);
  const rand = () => Math.random().toString(36).slice(2);

  if (hasAttachments) {
    const mixedBoundary = `----=_MixedPart_${Date.now()}_${rand()}`;
    const altBoundary = `----=_AltPart_${Date.now()}_${rand()}`;

    const lines: string[] = [
      ...headers,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      `--${mixedBoundary}`,
    ];

    if (opts.html) {
      lines.push(
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        '',
        `--${altBoundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        '',
        opts.body,
        '',
        `--${altBoundary}`,
        'Content-Type: text/html; charset=UTF-8',
        '',
        opts.html,
        '',
        `--${altBoundary}--`,
      );
    } else {
      lines.push('Content-Type: text/plain; charset=UTF-8', '', opts.body);
    }

    for (const att of opts.attachments!) {
      const encodedName = encodeHeaderWordIfNeeded(att.filename);
      lines.push(
        '',
        `--${mixedBoundary}`,
        `Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${encodedName}"`,
        `Content-Disposition: attachment; filename="${encodedName}"`,
        'Content-Transfer-Encoding: base64',
        '',
        bytesToBase64Wrapped(att.data),
      );
    }

    lines.push('', `--${mixedBoundary}--`);
    message = lines.join('\r\n');
  } else if (opts.html) {
    // Multipart message with both plain text and HTML
    const boundary = `----=_Part_${Date.now()}_${rand()}`;
    message = [
      ...headers,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      opts.body,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      opts.html,
      '',
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    message = [
      ...headers,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      opts.body,
    ].join('\r\n');
  }

  const raw = toBase64url(message);

  await gmailFetch(token, '/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw, ...(opts.threadId ? { threadId: opts.threadId } : {}) }),
  });
}

// Fetch full message body (HTML preferred, falls back to plain text) + attachments + To header
export async function getMessageBody(
  token: string,
  messageId: string
): Promise<{ html: string | null; text: string | null; attachments: Attachment[]; to: string; cc: string }> {
  const res = await gmailFetch(token, `/messages/${messageId}?format=full`);
  const msg: GmailMessage = await res.json();
  const headers = msg.payload?.headers ?? [];
  const toHeader = headers.find((h) => h.name.toLowerCase() === 'to')?.value ?? '';
  const ccHeader = headers.find((h) => h.name.toLowerCase() === 'cc')?.value ?? '';
  return {
    ...extractBodyFromPayload(msg.payload),
    attachments: extractAttachments(messageId, msg.payload),
    to: fixMojibake(decodeRfc2047(toHeader)),
    cc: fixMojibake(decodeRfc2047(ccHeader)),
  };
}

// Fetch attachment data by ID
export async function getAttachment(
  token: string,
  messageId: string,
  attachmentId: string
): Promise<string> {
  const res = await gmailFetch(token, `/messages/${messageId}/attachments/${attachmentId}`);
  const data = await res.json();
  return data.data; // base64url-encoded
}

// Recursively extract attachment metadata from a message payload
function extractAttachments(messageId: string, payload: GmailMessagePayload): Attachment[] {
  const attachments: Attachment[] = [];
  function walk(part: GmailMessagePayload) {
    // Skip inline images (they have Content-ID and are rendered inside the HTML body)
    const hasContentId = (part.headers ?? []).some((h) => h.name.toLowerCase() === 'content-id');
    if (hasContentId && part.mimeType.startsWith('image/')) {
      if (part.parts) part.parts.forEach(walk);
      return;
    }
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size,
        attachmentId: part.body.attachmentId,
        messageId,
      });
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  return attachments;
}

export type IcsRef = { data: string } | { attachmentId: string; messageId: string };

// Find the first text/calendar or application/ics part in a payload, regardless of filename.
// Exchange-generated invites deliver the ICS as an inline text/calendar part with no filename,
// which extractAttachments skips. This walks the tree and returns either the inline base64url
// data or an attachment reference the caller can fetch.
function extractIcsRef(messageId: string, payload: GmailMessagePayload): IcsRef | null {
  let found: IcsRef | null = null;
  function walk(part: GmailMessagePayload) {
    if (found) return;
    const mime = (part.mimeType || '').toLowerCase();
    const isIcs = mime.startsWith('text/calendar') || mime === 'application/ics' || (part.filename?.toLowerCase().endsWith('.ics') ?? false);
    if (isIcs) {
      if (part.body?.data) {
        found = { data: part.body.data };
        return;
      }
      if (part.body?.attachmentId) {
        found = { attachmentId: part.body.attachmentId, messageId };
        return;
      }
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  return found;
}

// --- Inline (CID) image resolution ---

interface InlineImage {
  contentId: string;
  mimeType: string;
  data?: string;
  attachmentId?: string;
  messageId: string;
}

function extractInlineImages(messageId: string, payload: GmailMessagePayload): InlineImage[] {
  const images: InlineImage[] = [];
  function walk(part: GmailMessagePayload) {
    const cidHeader = (part.headers ?? []).find((h) => h.name.toLowerCase() === 'content-id');
    if (cidHeader && part.mimeType.startsWith('image/')) {
      const contentId = cidHeader.value.replace(/^<|>$/g, '');
      images.push({
        contentId,
        mimeType: part.mimeType,
        data: part.body?.data ?? undefined,
        attachmentId: part.body?.attachmentId ?? undefined,
        messageId,
      });
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  return images;
}

function base64urlToBase64(data: string): string {
  let b64 = data.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return b64;
}

async function resolveInlineImages(
  token: string,
  html: string,
  inlineImages: InlineImage[]
): Promise<string> {
  // Fetch missing data for images that only have an attachmentId
  const needsFetch = inlineImages.filter((img) => !img.data && img.attachmentId);
  if (needsFetch.length > 0) {
    const fetched = await Promise.all(
      needsFetch.map((img) => getAttachment(token, img.messageId, img.attachmentId!))
    );
    needsFetch.forEach((img, i) => { img.data = fetched[i]; });
  }

  // Build CID → data URI map
  const cidMap = new Map<string, string>();
  for (const img of inlineImages) {
    if (img.data) {
      cidMap.set(img.contentId, `data:${img.mimeType};base64,${base64urlToBase64(img.data)}`);
    }
  }

  // Replace cid: references in the HTML
  return html.replace(/src=["']cid:([^"']+)["']/gi, (match, cid) => {
    const dataUri = cidMap.get(cid);
    return dataUri ? `src="${dataUri}"` : match;
  });
}

// Fetch all messages in a thread with their full bodies
export interface ThreadMessage {
  id: string;
  from: string;
  fromName: string;
  fromEmail: string;
  to: string;
  cc: string;
  date: string;
  /** RFC 2822 Message-ID header (e.g. "<abc@mail.gmail.com>") */
  rfc2822MessageId: string;
  /** RFC 2822 References header (space-separated message IDs) */
  references: string;
  body: { html: string | null; text: string | null };
  attachments: Attachment[];
  /** Gmail label IDs applied to this specific message (e.g. STARRED, UNREAD, IMPORTANT). */
  labelIds: string[];
  /** Reference to an ICS calendar part (if present). May be inline data or an attachment reference. */
  icsRef: IcsRef | null;
}

export async function getThreadMessages(
  token: string,
  threadId: string
): Promise<ThreadMessage[]> {
  const res = await gmailFetch(token, `/threads/${threadId}?format=full`);
  const thread: GmailThread = await res.json();
  return Promise.all((thread.messages ?? []).map(async (msg) => {
    const headers = msg.payload?.headers ?? [];
    const get = (name: string) =>
      fixMojibake(decodeRfc2047(headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''));
    const from = get('From');
    const nameMatch = from.match(/^"?([^"<]+)"?\s*<(.+?)>$/);

    const body = extractBodyFromPayload(msg.payload);
    const inlineImages = extractInlineImages(msg.id, msg.payload);
    if (body.html && inlineImages.length > 0) {
      body.html = await resolveInlineImages(token, body.html, inlineImages);
    }

    return {
      id: msg.id,
      from,
      fromName: nameMatch ? nameMatch[1].trim() : from.split('@')[0],
      fromEmail: nameMatch ? nameMatch[2] : from,
      to: get('To'),
      cc: get('Cc'),
      date: get('Date'),
      rfc2822MessageId: get('Message-ID') || get('Message-Id'),
      references: get('References'),
      body,
      attachments: extractAttachments(msg.id, msg.payload),
      labelIds: msg.labelIds ?? [],
      icsRef: extractIcsRef(msg.id, msg.payload),
    };
  }));
}
