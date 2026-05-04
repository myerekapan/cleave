export type RsvpStatus = 'accepted' | 'tentative' | 'declined' | 'needsAction';
export type IcsMethod = 'REQUEST' | 'CANCEL' | 'REPLY' | 'COUNTER' | 'REFRESH' | 'ADD' | 'PUBLISH' | 'DECLINECOUNTER';

export interface ParsedEvent {
  summary: string | null;
  start: Date | null;
  end: Date | null;
  location: string | null;
  organizer: string | null;
  organizerEmail: string | null;
  description: string | null;
  sequence: number;
  image: string | null;
  uid: string | null;
  attendeeStatus: RsvpStatus | null;
  /** Calendar-level METHOD (RFC 5546). REQUEST is a new/updated invite; CANCEL is a cancellation; REPLY is someone else's RSVP. */
  method: IcsMethod | null;
  /** Event-level STATUS. CANCELLED means the event was cancelled (distinct from METHOD:CANCEL). */
  status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED' | null;
}

export function parseIcsFromBase64url(base64url: string): ParsedEvent | null {
  try {
    const b64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return parseIcs(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function parseIcs(ics: string): ParsedEvent {
  // Unfold continuation lines (RFC 5545: CRLF followed by whitespace)
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  const result: ParsedEvent = { summary: null, start: null, end: null, location: null, organizer: null, organizerEmail: null, description: null, sequence: 0, image: null, uid: null, attendeeStatus: null, method: null, status: null };

  let inVEvent = false;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { inVEvent = true; continue; }
    if (line === 'END:VEVENT') { inVEvent = false; continue; }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const nameAndParams = line.slice(0, colonIdx);
    const value = line.slice(colonIdx + 1);

    const semicolonIdx = nameAndParams.indexOf(';');
    const propName = (semicolonIdx === -1 ? nameAndParams : nameAndParams.slice(0, semicolonIdx)).toUpperCase();

    // METHOD lives at VCALENDAR level, not inside VEVENT
    if (!inVEvent) {
      if (propName === 'METHOD') {
        const m = value.trim().toUpperCase();
        if (m === 'REQUEST' || m === 'CANCEL' || m === 'REPLY' || m === 'COUNTER' || m === 'REFRESH' || m === 'ADD' || m === 'PUBLISH' || m === 'DECLINECOUNTER') {
          result.method = m;
        }
      }
      continue;
    }
    const params = semicolonIdx === -1 ? '' : nameAndParams.slice(semicolonIdx + 1);

    switch (propName) {
      case 'SUMMARY':
        result.summary = unescapeIcs(value);
        break;
      case 'DTSTART': {
        const tzidMatch = params.match(/TZID=([^;:]+)/i);
        result.start = parseIcsDate(value, tzidMatch?.[1]);
        break;
      }
      case 'DTEND': {
        const tzidMatch = params.match(/TZID=([^;:]+)/i);
        result.end = parseIcsDate(value, tzidMatch?.[1]);
        break;
      }
      case 'LOCATION':
        result.location = unescapeIcs(value);
        break;
      case 'ORGANIZER': {
        const cnMatch = params.match(/CN=(?:"([^"]+)"|([^;:]+))/i);
        result.organizer = cnMatch ? (cnMatch[1] || cnMatch[2]).trim() : null;
        result.organizerEmail = value.replace(/^mailto:/i, '');
        break;
      }
      case 'IMAGE':
      case 'X-IMAGE':
        if (!result.image) result.image = value;
        break;
      case 'UID':
        result.uid = value;
        break;
      case 'DESCRIPTION':
        result.description = unescapeIcs(value);
        break;
      case 'SEQUENCE':
        result.sequence = parseInt(value, 10) || 0;
        break;
      case 'STATUS': {
        const s = value.trim().toUpperCase();
        if (s === 'CONFIRMED' || s === 'TENTATIVE' || s === 'CANCELLED') result.status = s;
        break;
      }
      case 'ATTENDEE': {
        const partstatMatch = params.match(/PARTSTAT=([^;:]+)/i);
        if (partstatMatch && !result.attendeeStatus) {
          const raw = partstatMatch[1].toUpperCase();
          if (raw === 'ACCEPTED') result.attendeeStatus = 'accepted';
          else if (raw === 'DECLINED') result.attendeeStatus = 'declined';
          else if (raw === 'TENTATIVE') result.attendeeStatus = 'tentative';
          else result.attendeeStatus = 'needsAction';
        }
        break;
      }
    }
  }

  return result;
}

// Microsoft Exchange ships Windows timezone names (e.g. "Eastern Standard Time") instead of
// IANA names. Intl.DateTimeFormat only accepts IANA, so map the common ones. Unknown zones fall
// back to device-local time rather than throwing.
const WINDOWS_TO_IANA: Record<string, string> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'UTC-11': 'Etc/GMT+11',
  'Aleutian Standard Time': 'America/Adak',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Alaskan Standard Time': 'America/Anchorage',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time (Mexico)': 'America/Chihuahua',
  'Mountain Standard Time': 'America/Denver',
  'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time': 'America/Chicago',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time (Mexico)': 'America/Cancun',
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indianapolis',
  'Venezuela Standard Time': 'America/Caracas',
  'Paraguay Standard Time': 'America/Asuncion',
  'Atlantic Standard Time': 'America/Halifax',
  'Central Brazilian Standard Time': 'America/Cuiaba',
  'SA Western Standard Time': 'America/La_Paz',
  'Pacific SA Standard Time': 'America/Santiago',
  'Newfoundland Standard Time': 'America/St_Johns',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Argentina Standard Time': 'America/Buenos_Aires',
  'Greenland Standard Time': 'America/Godthab',
  'Montevideo Standard Time': 'America/Montevideo',
  'Bahia Standard Time': 'America/Bahia',
  'UTC-02': 'Etc/GMT+2',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  'Morocco Standard Time': 'Africa/Casablanca',
  'UTC': 'Etc/UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'Namibia Standard Time': 'Africa/Windhoek',
  'Jordan Standard Time': 'Asia/Amman',
  'GTB Standard Time': 'Europe/Bucharest',
  'Middle East Standard Time': 'Asia/Beirut',
  'Egypt Standard Time': 'Africa/Cairo',
  'Syria Standard Time': 'Asia/Damascus',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'FLE Standard Time': 'Europe/Kiev',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Kaliningrad Standard Time': 'Europe/Kaliningrad',
  'Libya Standard Time': 'Africa/Tripoli',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Arab Standard Time': 'Asia/Riyadh',
  'Belarus Standard Time': 'Europe/Minsk',
  'Russian Standard Time': 'Europe/Moscow',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Russia Time Zone 3': 'Europe/Samara',
  'Mauritius Standard Time': 'Indian/Mauritius',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Caucasus Standard Time': 'Asia/Yerevan',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'West Asia Standard Time': 'Asia/Tashkent',
  'Ekaterinburg Standard Time': 'Asia/Yekaterinburg',
  'Pakistan Standard Time': 'Asia/Karachi',
  'India Standard Time': 'Asia/Calcutta',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Katmandu',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'N. Central Asia Standard Time': 'Asia/Novosibirsk',
  'Myanmar Standard Time': 'Asia/Rangoon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'North Asia Standard Time': 'Asia/Krasnoyarsk',
  'China Standard Time': 'Asia/Shanghai',
  'North Asia East Standard Time': 'Asia/Irkutsk',
  'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth',
  'Taipei Standard Time': 'Asia/Taipei',
  'Ulaanbaatar Standard Time': 'Asia/Ulaanbaatar',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Yakutsk Standard Time': 'Asia/Yakutsk',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Vladivostok Standard Time': 'Asia/Vladivostok',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'UTC+12': 'Etc/GMT-12',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Magadan Standard Time': 'Asia/Magadan',
  'Tonga Standard Time': 'Pacific/Tongatapu',
  'Samoa Standard Time': 'Pacific/Apia',
};

function resolveTzid(tzid: string): string {
  return WINDOWS_TO_IANA[tzid] ?? tzid;
}

function parseIcsDate(value: string, tzid?: string): Date | null {
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!match) return null;
  const [, year, month, day, hour = '0', min = '0', sec = '0', utc] = match;
  if (utc === 'Z') return new Date(Date.UTC(+year, +month - 1, +day, +hour, +min, +sec));

  if (tzid) {
    // The ICS value is a wall-clock time in the given TZID timezone.
    // Compute the timezone's UTC offset at that moment so we can build a correct Date.
    const utcGuess = new Date(Date.UTC(+year, +month - 1, +day, +hour, +min, +sec));
    try {
      const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: resolveTzid(tzid),
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
      });
      const parts = fmt.formatToParts(utcGuess);
      const g = (t: string) => +(parts.find((p) => p.type === t)?.value ?? '0');
      const localAtUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') === 24 ? 0 : g('hour'), g('minute'), g('second'));
      const offsetMs = localAtUtc - utcGuess.getTime();
      return new Date(utcGuess.getTime() - offsetMs);
    } catch {
      // Unknown timezone — fall through to local-time interpretation rather than losing the event.
    }
  }

  // No TZID, no Z — assume device local time
  return new Date(+year, +month - 1, +day, +hour, +min, +sec);
}

function unescapeIcs(value: string): string {
  return value.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

export function formatEventDate(start: Date, end: Date | null): string {
  const dateStr = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const startTime = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!end) return `${dateStr} · ${startTime}`;
  const endTime = end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${dateStr} · ${startTime} – ${endTime}`;
}
