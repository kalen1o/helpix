// "30 Sep 2026": a month name is unambiguous for both day-first and month-first readers.
// Built from parts because locales disagree on abbreviations (ICU's en-GB gives "Sept").
const PARTS = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric' })

export function formatDate(iso: string): string {
  const parts = Object.fromEntries(PARTS.formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
  return `${parts.day} ${parts.month} ${parts.year}`
}
