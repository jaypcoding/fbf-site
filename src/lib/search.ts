// Case- and accent-insensitive search used by the public directories.
export function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim();
}

export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = normalizeSearch(query);
  if (!needle) return true;
  return fields.some((field) => field != null && normalizeSearch(field).includes(needle));
}
