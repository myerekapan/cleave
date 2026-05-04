export interface Recipient {
  name: string;
  email: string;
}

export function parseRecipientHeader(header: string): Recipient[] {
  if (!header.trim()) return [];
  return header.split(',').map((r) => {
    const m = r.trim().match(/^"?([^"<]+)"?\s*<(.+?)>$/);
    if (m) return { name: m[1].trim(), email: m[2].trim() };
    const raw = r.trim();
    return { name: raw.split('@')[0], email: raw };
  }).filter((r) => r.email);
}
