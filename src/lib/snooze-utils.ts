const MONTH_NAMES: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5,
  jul: 6, july: 6, aug: 7, august: 7, sep: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

const DAY_NAMES: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tuesday: 2,
  wed: 3, wednesday: 3, thu: 4, thursday: 4, fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function formatSublabel(date: Date): string {
  const day = date.toLocaleDateString([], { weekday: 'short' }).toUpperCase();
  const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${time}`;
}

export interface SnoozeOption {
  label: string;
  sublabel: string;
  until: Date;
}

export function getSnoozePresets(): SnoozeOption[] {
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat
  const options: SnoozeOption[] = [];

  // Later today — 3 PM (only if before 2 PM so there's meaningful time)
  if (hour < 14) {
    const laterToday = new Date(now);
    laterToday.setHours(15, 0, 0, 0);
    options.push({ label: 'later today', sublabel: formatSublabel(laterToday), until: laterToday });
  }

  // This evening — 6 PM (only if before 5 PM)
  if (hour < 17) {
    const evening = new Date(now);
    evening.setHours(18, 0, 0, 0);
    options.push({ label: 'this evening', sublabel: formatSublabel(evening), until: evening });
  }

  // Tomorrow — 8 AM
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  options.push({ label: 'tomorrow', sublabel: formatSublabel(tomorrow), until: tomorrow });

  // This weekend — Sat 8 AM (only Mon–Fri)
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    const saturday = new Date(now);
    saturday.setDate(saturday.getDate() + (6 - dayOfWeek));
    saturday.setHours(8, 0, 0, 0);
    options.push({ label: 'this weekend', sublabel: formatSublabel(saturday), until: saturday });
  }

  // Next week — Mon 8 AM
  const nextMon = new Date(now);
  nextMon.setDate(nextMon.getDate() + ((8 - dayOfWeek) % 7 || 7));
  nextMon.setHours(8, 0, 0, 0);
  options.push({ label: 'next week', sublabel: formatSublabel(nextMon), until: nextMon });

  // In 2 days — 8 AM
  const in2Days = new Date(now);
  in2Days.setDate(in2Days.getDate() + 2);
  in2Days.setHours(8, 0, 0, 0);
  // Only add if it's meaningfully different from tomorrow and this weekend
  if (!options.some((o) => o.until.toDateString() === in2Days.toDateString())) {
    options.push({ label: 'in 2 days', sublabel: formatSublabel(in2Days), until: in2Days });
  }

  // In 1 week — same time, 7 days from now
  const in1Week = new Date(now);
  in1Week.setDate(in1Week.getDate() + 7);
  in1Week.setMinutes(0, 0, 0);
  // Only add if different from "next week" Monday
  if (in1Week.toDateString() !== nextMon.toDateString()) {
    options.push({ label: 'in 1 week', sublabel: formatSublabel(in1Week), until: in1Week });
  }

  return options;
}

// --- Natural language date parser ---

function parseTime(text: string): { hours: number; minutes: number } | null {
  // "3:30 pm", "3:30pm", "15:30"
  const colonMatch = text.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (colonMatch) {
    let h = parseInt(colonMatch[1], 10);
    const m = parseInt(colonMatch[2], 10);
    const ampm = colonMatch[3]?.toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return { hours: h, minutes: m };
  }
  // "8 am", "8am", "3 pm"
  const simpleMatch = text.match(/(\d{1,2})\s*(am|pm)/i);
  if (simpleMatch) {
    let h = parseInt(simpleMatch[1], 10);
    const ampm = simpleMatch[2].toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return { hours: h, minutes: 0 };
  }
  return null;
}

export function parseSnoozeInput(text: string): Date | null {
  const input = text.trim().toLowerCase();
  if (!input) return null;

  const now = new Date();

  // Relative: "30 min", "1 hour", "3 days", "2 weeks"
  const relMatch = input.match(/^(\d+)\s*(min(?:ute)?s?|h(?:our)?s?|d(?:ay)?s?|w(?:eek)?s?)$/);
  if (relMatch) {
    const n = parseInt(relMatch[1], 10);
    const unit = relMatch[2][0]; // m, h, d, w
    const result = new Date(now);
    if (unit === 'm') result.setMinutes(result.getMinutes() + n);
    else if (unit === 'h') result.setHours(result.getHours() + n);
    else if (unit === 'd') { result.setDate(result.getDate() + n); result.setHours(8, 0, 0, 0); }
    else if (unit === 'w') { result.setDate(result.getDate() + n * 7); result.setHours(8, 0, 0, 0); }
    return result;
  }

  // Check for time component anywhere in input
  const time = parseTime(input);

  // Day name: "monday", "fri", optionally with time "monday 9am"
  for (const [name, dayNum] of Object.entries(DAY_NAMES)) {
    if (input.startsWith(name)) {
      const result = new Date(now);
      let daysAhead = (dayNum - now.getDay() + 7) % 7;
      if (daysAhead === 0) daysAhead = 7; // next occurrence
      result.setDate(result.getDate() + daysAhead);
      result.setHours(time?.hours ?? 8, time?.minutes ?? 0, 0, 0);
      return result;
    }
  }

  // Month + day: "aug 7", "jan 15", optionally with time "aug 7 2pm"
  for (const [name, monthNum] of Object.entries(MONTH_NAMES)) {
    const monthPattern = new RegExp(`^${name}\\s+(\\d{1,2})`);
    const match = input.match(monthPattern);
    if (match) {
      const day = parseInt(match[1], 10);
      const result = new Date(now.getFullYear(), monthNum, day, time?.hours ?? 8, time?.minutes ?? 0, 0);
      if (result <= now) result.setFullYear(result.getFullYear() + 1);
      return result;
    }
  }

  // MM/DD or M/D format: "12/25", "1/5"
  const slashMatch = input.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10) - 1;
    const day = parseInt(slashMatch[2], 10);
    const result = new Date(now.getFullYear(), month, day, time?.hours ?? 8, time?.minutes ?? 0, 0);
    if (result <= now) result.setFullYear(result.getFullYear() + 1);
    return result;
  }

  // "tomorrow" with optional time
  if (input.startsWith('tomorrow')) {
    const result = new Date(now);
    result.setDate(result.getDate() + 1);
    result.setHours(time?.hours ?? 8, time?.minutes ?? 0, 0, 0);
    return result;
  }

  // Bare time only: "8 am", "3:30 pm", "14:00"
  if (time) {
    const result = new Date(now);
    result.setHours(time.hours, time.minutes, 0, 0);
    if (result <= now) result.setDate(result.getDate() + 1);
    return result;
  }

  return null;
}

export function formatParsedDate(date: Date): string {
  return formatSublabel(date);
}
