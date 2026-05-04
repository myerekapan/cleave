import { ParsedEvent, RsvpStatus } from './ics';

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';

async function calendarFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${CALENDAR_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

export interface CalendarEventRef {
  eventId: string;
  calendarId: string;
}

/**
 * Find a calendar event by iCalUID, direct ID, or summary+date fallback.
 */
export async function findCalendarEvent(
  token: string,
  iCalUID: string,
  event?: ParsedEvent
): Promise<CalendarEventRef | null> {
  // 1. For native Google Calendar events, try direct access by event ID
  if (iCalUID.endsWith('@google.com')) {
    const eventId = iCalUID.replace('@google.com', '');
    const directRes = await calendarFetch(token, `/calendars/primary/events/${eventId}`);
    if (directRes.ok) return { eventId, calendarId: 'primary' };
  }

  // 2. Try iCalUID search on primary
  const primaryRes = await calendarFetch(
    token,
    `/calendars/primary/events?iCalUID=${encodeURIComponent(iCalUID)}&singleEvents=true`
  );
  if (primaryRes.ok) {
    const data = await primaryRes.json();
    if (data.items?.[0]?.id) return { eventId: data.items[0].id, calendarId: 'primary' };
  }

  // 3. Search all other calendars by iCalUID
  const listRes = await calendarFetch(token, '/users/me/calendarList');
  if (listRes.ok) {
    const list = await listRes.json();
    for (const cal of (list.items ?? []) as { id: string }[]) {
      if (cal.id === 'primary') continue;
      const res = await calendarFetch(
        token,
        `/calendars/${encodeURIComponent(cal.id)}/events?iCalUID=${encodeURIComponent(iCalUID)}&singleEvents=true`
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (data.items?.[0]?.id) return { eventId: data.items[0].id, calendarId: cal.id };
    }
  }

  // 4. Fallback: search by summary + date range (finds ghost events from failed imports)
  if (event?.summary && event?.start) {
    const timeMin = new Date(event.start.getTime() - 60 * 1000).toISOString();
    const timeMax = new Date(event.start.getTime() + 60 * 1000).toISOString();
    const searchRes = await calendarFetch(
      token,
      `/calendars/primary/events?q=${encodeURIComponent(event.summary)}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true`
    );
    if (searchRes.ok) {
      const data = await searchRes.json();
      const match = (data.items ?? []).find((e: { summary?: string }) => e.summary === event.summary);
      if (match?.id) return { eventId: match.id, calendarId: 'primary' };
    }
  }

  return null;
}

/**
 * Import an event into the user's calendar via events.import.
 * Sends full .ics data so the event is properly linked.
 * Falls back to events.insert if import fails.
 */
export async function createCalendarEvent(
  token: string,
  event: ParsedEvent,
  userEmail: string,
  status: RsvpStatus
): Promise<CalendarEventRef> {
  const startDt = event.start ?? new Date();
  const endDt = event.end ?? new Date(startDt.getTime() + 60 * 60 * 1000);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const body: Record<string, unknown> = {
    iCalUID: event.uid,
    summary: event.summary,
    description: event.description ?? undefined,
    status: 'confirmed',
    sequence: event.sequence,
    start: { dateTime: startDt.toISOString(), timeZone: tz },
    end: { dateTime: endDt.toISOString(), timeZone: tz },
    location: event.location ?? undefined,
    organizer: event.organizerEmail
      ? { email: event.organizerEmail, ...(event.organizer ? { displayName: event.organizer } : {}) }
      : undefined,
    // HACK: Always import as "tentative" — importing with "accepted" creates invisible
    // ghost events in Google Calendar. After import, we PATCH to the desired status.
    // This is a workaround; the root cause is unknown. Gmail/Superhuman don't have
    // this issue, likely because they use an internal API or different import flow.
    // TODO: Figure out why events.import with responseStatus "accepted" is invisible
    attendees: [
      ...(event.organizerEmail ? [{ email: event.organizerEmail, organizer: true, responseStatus: 'accepted' }] : []),
      { email: userEmail, responseStatus: 'tentative', self: true },
    ],
    reminders: { useDefault: true },
    transparency: 'opaque',
  };

  const importRes = await calendarFetch(token, '/calendars/primary/events/import', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (importRes.ok) {
    const data = await importRes.json();
    const ref: CalendarEventRef = { eventId: data.id, calendarId: 'primary' };
    // Import always uses tentative to ensure visibility, then patch to desired status
    if (status !== 'tentative') {
      await updateCalendarRsvp(token, ref, userEmail, status);
    }
    return ref;
  }

  // Fallback: find ghost event by summary+date and update it
  const ref = await findCalendarEvent(token, event.uid!, event);
  if (ref) {
    await updateCalendarRsvp(token, ref, userEmail, status);
    return ref;
  }

  // Last resort: events.insert
  const insertRes = await calendarFetch(token, '/calendars/primary/events?sendUpdates=none', {
    method: 'POST',
    body: JSON.stringify({
      summary: event.summary,
      description: event.description ?? undefined,
      status: 'confirmed',
      start: { dateTime: startDt.toISOString(), timeZone: tz },
      end: { dateTime: endDt.toISOString(), timeZone: tz },
      location: event.location ?? undefined,
      attendees: [{ email: userEmail, responseStatus: status }],
      reminders: { useDefault: true },
    }),
  });
  if (!insertRes.ok) {
    const err = await insertRes.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Calendar error ${insertRes.status}`);
  }
  const data = await insertRes.json();
  return { eventId: data.id, calendarId: 'primary' };
}

/**
 * Read the user's current responseStatus for an event from Google Calendar.
 * Returns null if the event or user attendee entry isn't found.
 */
export async function getMyResponseStatus(
  token: string,
  ref: CalendarEventRef,
  userEmail: string
): Promise<RsvpStatus | null> {
  const res = await calendarFetch(token, `/calendars/${encodeURIComponent(ref.calendarId)}/events/${ref.eventId}`);
  if (!res.ok) return null;
  const event = await res.json();
  const attendees = (event.attendees ?? []) as { email: string; responseStatus: string; self?: boolean }[];
  const me = attendees.find((a) => a.self) ?? attendees.find((a) => a.email.toLowerCase() === userEmail.toLowerCase());
  const s = me?.responseStatus;
  if (s === 'accepted' || s === 'declined' || s === 'tentative' || s === 'needsAction') return s;
  return null;
}

export async function updateCalendarRsvp(
  token: string,
  ref: CalendarEventRef,
  userEmail: string,
  status: RsvpStatus
): Promise<void> {
  // GET current event to preserve full attendees list
  const getRes = await calendarFetch(token, `/calendars/${encodeURIComponent(ref.calendarId)}/events/${ref.eventId}`);
  if (!getRes.ok) {
    const err = await getRes.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Failed to fetch event ${getRes.status}`);
  }
  const event = await getRes.json();

  // Update user's status in the attendees list, or add them
  const attendees = (event.attendees ?? []) as { email: string; responseStatus: string }[];
  const userAttendee = attendees.find((a) => a.email.toLowerCase() === userEmail.toLowerCase());
  if (userAttendee) {
    userAttendee.responseStatus = status;
  } else {
    attendees.push({ email: userEmail, responseStatus: status });
  }

  const res = await calendarFetch(token, `/calendars/${encodeURIComponent(ref.calendarId)}/events/${ref.eventId}?sendUpdates=all`, {
    method: 'PATCH',
    body: JSON.stringify({ attendees }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message ?? `Calendar API error ${res.status}`);
  }
}
