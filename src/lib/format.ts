// Date formatting in Brasília time, so every visitor sees the official schedule
// regardless of the device time zone.
const TIME_ZONE = 'America/Sao_Paulo';

export function formatMatchDate(iso: string | null | undefined): string {
  if (!iso) return 'Data a definir';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Data a definir';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date).replace(/\.,?/g, ',').replace(/,\s*,/g, ',');
}

// Accepts both timestamps and plain `date` columns (YYYY-MM-DD). A plain date is
// a calendar day: parsing it with `new Date()` would mean midnight UTC, which is
// still the previous day in Brazil.
export function formatLongDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const plainDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(plainDate ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: plainDate ? 'UTC' : TIME_ZONE,
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
