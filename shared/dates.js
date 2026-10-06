// Shared Grist date parsing and Vladivostok wall-clock conversion.
// This lightweight classic script is safe to load without the grouped-table DOM.
const LOCALE = 'en-US';

// Grist Date/DateTime values arrive as epoch seconds (UTC), ISO text, or wrappers.
const DATE_EPOCH_MIN = 315532800;    // 1980-01-01T00:00:00Z
const DATE_EPOCH_MAX = 4102444800;   // 2100-01-01T00:00:00Z

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(\s*(Z|[+-]\d{2}:?\d{2}))?)?$/i;

// ISO string → UTC epoch seconds, or null if invalid / out of range.
// Tolerant of import / copy-paste artifacts: invisible characters are
// stripped first (soft hyphen, Mongolian vowel separator, ZWSP/ZWNJ/ZWJ,
// LRM/RLM, bidi embedding/override/isolate controls, deprecated format
// chars, word joiner, BOM), then whitespace runs (non-breaking,
// multiple…) are normalized to a single space.
function parseIsoDateSec(v) {
  if (typeof v !== 'string') return null;
  let s = v
    .replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, '') // invisible / format characters
    .trim()
    .replace(/\s+/g, ' ');                    // multiple / non-breaking spaces
  if (!ISO_DATE_RE.test(s)) return null;
  s = s.replace(' ', 'T');                       // "YYYY-MM-DD HH:mm" → strict ISO
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) s += 'Z'; // no timezone → UTC
  const ms = Date.parse(s);
  if (isNaN(ms)) return null;
  const sec = ms / 1000;
  if (sec < DATE_EPOCH_MIN || sec > DATE_EPOCH_MAX) return null;
  return sec;
}

// Date-like value → epoch seconds. Besides primitive strings, Grist may
// provide cell values through an object wrapper whose String(value) is the
// ISO representation. Keep the ISO parser strict so ordinary objects are
// never mistaken for dates.
function parseDateValueSec(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseIsoDateSec(v);
  if (v != null && typeof v === 'object') {
    if (v instanceof Date) {
      const ms = v.getTime();
      if (!isNaN(ms)) {
        const sec = ms / 1000;
        return sec >= DATE_EPOCH_MIN && sec <= DATE_EPOCH_MAX ? sec : null;
      }
      return null;
    }
    return parseIsoDateSec(String(v));
  }
  return null;
}

// Date-like value (epoch number, ISO string, or wrapper) → epoch seconds.
function toEpochSec(v) {
  return parseDateValueSec(v);
}

// Render a parsed UTC instant without leaking Grist's transport format
// (epoch seconds or an ISO string) into the table. Date-only/midnight values
// stay compact; DateTime values retain their hours and minutes.
function formatUtcDateSec(sec) {
  const d = new Date(sec * 1000);
  const date = d.toISOString().slice(0, 10);
  const hh = d.getUTCHours(), mm = d.getUTCMinutes(), ss = d.getUTCSeconds();
  return hh === 0 && mm === 0 && ss === 0
    ? date
    : `${date} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Reuse one native formatter. Storage remains UTC; wall-clock dates below
// are calendar coordinates, not instants. Date-only columns never use this.
const DISPLAY_TIME_ZONE = 'Asia/Vladivostok';
const DATE_TIME_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateTimeWallFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_TIME_ZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function dateTimeWallDate(sec = Date.now() / 1000) {
  const parts = Object.fromEntries(dateTimeWallFormatter.formatToParts(new Date(sec * 1000))
    .map(part => [part.type, part.value]));
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day,
    +parts.hour, +parts.minute, +parts.second));
}
function formatDateTimeSec(sec) {
  const date = dateTimeWallDate(sec);
  const text = date.toISOString().slice(0, 16).replace('T', ' ');
  return `${text} (${DATE_TIME_WEEKDAYS[date.getUTCDay()]})`;
}
function parseDateTimeWallSec(text) {
  // The displayed weekday is a decoration; pasted dates still use their
  // actual calendar value and explicit offset, when present.
  const normalized = String(text)
    .replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, '')
    .trim().replace(/\s+/g, ' ')
    .replace(/ \((?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\)$/i, '');
  const wallSec = parseIsoDateSec(normalized);
  if (wallSec == null) return null;
  // Explicit offsets represent instants already; only timezone-free text
  // from the picker or clipboard is interpreted in Vladivostok.
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) return wallSec;
  let instant = wallSec;
  for (let attempt = 0; attempt < 3; attempt++) {
    const difference = wallSec - dateTimeWallDate(instant).getTime() / 1000;
    if (!difference) return instant;
    instant += difference;
  }
  return null; // A nonexistent local time at a historical clock transition.
}
