// Splits public matches into the "next games" and "latest results" strips.
export type FeedMatch = {
  id: string;
  status: 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
  scheduled_at: string | null;
};

export function buildMatchFeed<T extends FeedMatch>(matches: T[], now: Date, limit = 6) {
  const time = (match: T) => (match.scheduled_at ? Date.parse(match.scheduled_at) : Number.NaN);
  const live = matches.filter((match) => match.status === 'LIVE');
  const upcoming = matches
    .filter((match) => match.status === 'SCHEDULED' && Number.isFinite(time(match)) && time(match) >= now.getTime())
    .sort((a, b) => time(a) - time(b))
    .slice(0, limit);
  const recent = matches
    .filter((match) => match.status === 'FINISHED')
    .sort((a, b) => (Number.isFinite(time(b)) ? time(b) : 0) - (Number.isFinite(time(a)) ? time(a) : 0))
    .slice(0, limit);
  return { live, upcoming, recent };
}
