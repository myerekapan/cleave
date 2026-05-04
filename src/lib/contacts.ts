import { listMessages, getMessageRecipientHeaders } from '@/lib/gmail';
import { parseRecipientHeader, type Recipient } from '@/lib/recipients';

export interface ContactEntry {
  email: string;
  name: string;
  count: number;
  lastSentTs: number;
}

export interface ContactIndex {
  version: 1;
  builtAt: number;
  entries: Record<string, ContactEntry>;
}

const INDEX_VERSION = 1;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const HALF_LIFE_DAYS = 90;
const MAX_MESSAGES = 500;
const PAGE_SIZE = 500;
const FETCH_CONCURRENCY = 6;

function storageKey(userEmail: string): string {
  return `cleave-contacts:${userEmail.toLowerCase()}`;
}

export function getContactIndex(userEmail: string): ContactIndex | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userEmail));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ContactIndex;
    if (parsed?.version !== INDEX_VERSION || !parsed.entries) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeContactIndex(userEmail: string, index: ContactIndex): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(userEmail), JSON.stringify(index));
  } catch {
    // Quota exceeded or storage unavailable — silently drop.
  }
}

function decayScore(entry: ContactEntry, now: number): number {
  const ageDays = Math.max(0, (now - entry.lastSentTs) / (24 * 60 * 60 * 1000));
  return entry.count * Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

export function rankContacts(
  index: ContactIndex | null,
  query: string,
  limit = 8,
): ContactEntry[] {
  if (!index) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const now = Date.now();
  const matches: { entry: ContactEntry; score: number }[] = [];
  for (const entry of Object.values(index.entries)) {
    if (!entry.email.includes(q) && !entry.name.toLowerCase().includes(q)) continue;
    matches.push({ entry, score: decayScore(entry, now) });
  }
  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.entry.lastSentTs - a.entry.lastSentTs;
  });
  return matches.slice(0, limit).map((m) => m.entry);
}

function upsert(
  entries: Record<string, ContactEntry>,
  recipient: Recipient,
  ts: number,
  userEmailLower: string,
) {
  const email = recipient.email.trim().toLowerCase();
  if (!email || email === userEmailLower) return;
  const existing = entries[email];
  if (existing) {
    existing.count += 1;
    if (ts > existing.lastSentTs) existing.lastSentTs = ts;
    if (recipient.name && recipient.name !== email.split('@')[0]) {
      existing.name = recipient.name;
    }
  } else {
    entries[email] = {
      email,
      name: recipient.name || email.split('@')[0],
      count: 1,
      lastSentTs: ts,
    };
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

let building: Promise<ContactIndex> | null = null;

export function buildContactIndex(
  token: string,
  userEmail: string,
): Promise<ContactIndex> {
  if (building) return building;
  building = (async () => {
    const userEmailLower = userEmail.toLowerCase();
    const entries: Record<string, ContactEntry> = {};
    let pageToken: string | undefined;
    let fetched = 0;

    while (fetched < MAX_MESSAGES) {
      const { messages, nextPageToken } = await listMessages(token, {
        labelIds: ['SENT'],
        maxResults: Math.min(PAGE_SIZE, MAX_MESSAGES - fetched),
        pageToken,
      });
      if (!messages.length) break;
      fetched += messages.length;

      const metadata = await runWithConcurrency(messages, FETCH_CONCURRENCY, async (m) => {
        try {
          return await getMessageRecipientHeaders(token, m.id);
        } catch {
          return null;
        }
      });

      for (const meta of metadata) {
        if (!meta) continue;
        const ts = meta.dateMs;
        for (const r of parseRecipientHeader(meta.to)) upsert(entries, r, ts, userEmailLower);
        for (const r of parseRecipientHeader(meta.cc)) upsert(entries, r, ts, userEmailLower);
        for (const r of parseRecipientHeader(meta.bcc)) upsert(entries, r, ts, userEmailLower);
      }

      // Write incrementally so partial progress survives reloads.
      writeContactIndex(userEmail, {
        version: INDEX_VERSION,
        builtAt: Date.now(),
        entries,
      });

      if (!nextPageToken) break;
      pageToken = nextPageToken;
    }

    const index: ContactIndex = {
      version: INDEX_VERSION,
      builtAt: Date.now(),
      entries,
    };
    writeContactIndex(userEmail, index);
    return index;
  })();

  building.finally(() => { building = null; });
  return building;
}

export function ensureContactIndex(token: string, userEmail: string): void {
  const existing = getContactIndex(userEmail);
  if (existing && Date.now() - existing.builtAt < STALE_MS) return;
  buildContactIndex(token, userEmail).catch(() => {
    // Swallow — UI must not block on background indexing.
  });
}

export function recordSentRecipients(
  userEmail: string,
  recipients: Recipient[],
): void {
  if (!recipients.length) return;
  const userEmailLower = userEmail.toLowerCase();
  const index: ContactIndex = getContactIndex(userEmail) ?? {
    version: INDEX_VERSION,
    builtAt: Date.now(),
    entries: {},
  };
  const ts = Date.now();
  for (const r of recipients) upsert(index.entries, r, ts, userEmailLower);
  writeContactIndex(userEmail, index);
}
