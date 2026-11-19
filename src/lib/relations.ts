// PostgREST returns many-to-one embeds (e.g. `season:season_id ( … )`) as a
// single object, and one-to-many embeds as arrays. Code that assumed arrays for
// many-to-one relations silently read `undefined`; this accepts both shapes.
export function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
