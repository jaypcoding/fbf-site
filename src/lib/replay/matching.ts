// Matching of recording nicknames to registered FBF players.
// Only safe matches are automatic: the exact nickname (ignoring case and
// repeated spaces) or a saved alias, among the players of the two teams of the
// match. Anything else is a suggestion that the administrator must confirm.

export type RosterPlayer = { playerId: string; seasonTeamId: string; nickname: string; position: string };
export type PlayerAlias = { playerId: string; alias: string };

export type MatchCandidate = { playerId: string; seasonTeamId: string; nickname: string; via: 'nickname' | 'alias' };

export type NickResolution =
  | { status: 'matched'; playerId: string; seasonTeamId: string; via: 'nickname' | 'alias' | 'manual' }
  | { status: 'ambiguous'; candidates: MatchCandidate[] }
  | { status: 'unknown'; suggestions: MatchCandidate[] }
  | { status: 'ignored' }
  | { status: 'unidentified' };

export function normalizeNick(nick: string): string {
  return nick.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "nick (2)" marks a second person using the same nickname at the same time in the recording. */
export function isDuplicateLabel(key: string): boolean {
  return /\s\(\d+\)$/.test(key);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

export function resolveNick(
  key: string,
  name: string,
  roster: RosterPlayer[],
  aliases: PlayerAlias[],
  decision: string | undefined,
  duplicatedInRecording: boolean,
): NickResolution {
  if (decision === 'ignore') return { status: 'ignored' };
  if (decision === 'none') return { status: 'unidentified' };
  if (decision) {
    const player = roster.find((r) => r.playerId === decision);
    if (player) return { status: 'matched', playerId: player.playerId, seasonTeamId: player.seasonTeamId, via: 'manual' };
  }
  const n = normalizeNick(name);
  const candidates: MatchCandidate[] = [];
  for (const r of roster) {
    if (normalizeNick(r.nickname) === n) candidates.push({ playerId: r.playerId, seasonTeamId: r.seasonTeamId, nickname: r.nickname, via: 'nickname' });
  }
  for (const a of aliases) {
    if (normalizeNick(a.alias) !== n) continue;
    for (const r of roster) {
      if (r.playerId === a.playerId && !candidates.some((c) => c.playerId === r.playerId && c.seasonTeamId === r.seasonTeamId)) {
        candidates.push({ playerId: r.playerId, seasonTeamId: r.seasonTeamId, nickname: r.nickname, via: 'alias' });
      }
    }
  }
  const distinctPlayers = new Set(candidates.map((c) => c.playerId));
  if (candidates.length === 1 && !duplicatedInRecording && !isDuplicateLabel(key)) {
    const c = candidates[0];
    return { status: 'matched', playerId: c.playerId, seasonTeamId: c.seasonTeamId, via: c.via };
  }
  if (candidates.length > 0 && (distinctPlayers.size > 1 || candidates.length > 1 || duplicatedInRecording || isDuplicateLabel(key))) {
    return { status: 'ambiguous', candidates };
  }
  // suggestions only (never automatic): containment or small edit distance
  const suggestions: MatchCandidate[] = [];
  for (const r of roster) {
    const rn = normalizeNick(r.nickname);
    if (!rn) continue;
    const close = (rn.length >= 3 && (n.includes(rn) || rn.includes(n))) || levenshtein(rn, n) <= Math.max(1, Math.floor(Math.min(rn.length, n.length) / 4));
    if (close) suggestions.push({ playerId: r.playerId, seasonTeamId: r.seasonTeamId, nickname: r.nickname, via: 'nickname' });
  }
  return { status: 'unknown', suggestions: suggestions.slice(0, 5) };
}
