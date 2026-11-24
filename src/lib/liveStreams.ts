// Global mini player: which transmissions are on the air (pure functions).
// Source of truth, from the existing registrations only:
//   1. streamers marked "Ao vivo" by an admin (streamers.is_live);
//   2. streamers linked to a match whose status is LIVE (as before).
// A streamer appears once, even when both are true.
import { isValidChannel, type StreamPlatform } from './streaming.ts';

export type LiveStreamer = { id: string; display_name: string; platform: StreamPlatform; channel: string; is_live?: boolean; live_since?: string | null };
export type LiveMatchInfo = { matchId: string; homeName: string; awayName: string; homeScore: number | null; awayScore: number | null };
export type LiveEntry = { key: string; streamer: LiveStreamer; match: LiveMatchInfo | null; since: string | null };

export type LiveMatchRow = {
  id: string; home_score: number | null; away_score: number | null;
  home_team: { team: { name: string } | null } | null;
  away_team: { team: { name: string } | null } | null;
  match_streamers: { streamer: LiveStreamer | null }[];
};

/** Merge both sources: one entry per streamer, invalid channels left out, oldest on the air first. */
export function mergeLiveStreams(liveStreamers: LiveStreamer[], liveMatches: LiveMatchRow[]): LiveEntry[] {
  const byId = new Map<string, LiveEntry>();
  for (const s of liveStreamers) {
    if (!s.is_live || !isValidChannel(s.platform, s.channel)) continue;
    byId.set(s.id, { key: s.id, streamer: s, match: null, since: s.live_since ?? null });
  }
  for (const m of liveMatches) {
    const match: LiveMatchInfo = {
      matchId: m.id, homeName: m.home_team?.team?.name || '—', awayName: m.away_team?.team?.name || '—',
      homeScore: m.home_score, awayScore: m.away_score,
    };
    for (const link of m.match_streamers ?? []) {
      const s = link.streamer;
      if (!s || !isValidChannel(s.platform, s.channel)) continue;
      const cur = byId.get(s.id);
      byId.set(s.id, cur ? { ...cur, match: cur.match ?? match } : { key: s.id, streamer: s, match, since: null });
    }
  }
  return [...byId.values()].sort((a, b) => (a.since ?? '9999').localeCompare(b.since ?? '9999') || a.streamer.display_name.localeCompare(b.streamer.display_name, 'pt-BR'));
}

/** The transmission to show: the one chosen if still on the air, otherwise the first. */
export function pickActive(entries: LiveEntry[], selectedKey: string | null): LiveEntry | null {
  return entries.find((e) => e.key === selectedKey) ?? entries[0] ?? null;
}

/** A light signature: the list only changes (and React only re-renders) when this changes. */
export const signature = (entries: LiveEntry[]) => entries.map((e) => `${e.key}:${e.streamer.platform}:${e.streamer.channel}:${e.streamer.display_name}:${e.match ? `${e.match.homeScore}-${e.match.awayScore}` : ''}`).join('|');
