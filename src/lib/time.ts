export function parseClock(value: string): number | null {
  const trimmed = value.trim();
  const withSeconds = /^(\d{1,3}):([0-5]\d)$/.exec(trimmed);
  if (withSeconds) return parseInt(withSeconds[1], 10) * 60 + parseInt(withSeconds[2], 10);
  if (/^\d{1,3}$/.test(trimmed)) return parseInt(trimmed, 10) * 60;
  return null;
}

export function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
