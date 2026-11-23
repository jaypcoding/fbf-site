// Rankings of players from the official totals (player_season_summary,
// player_match_keeping and, only when the MVP is published, mvp_results). Pure functions: no database access. Ties share the same
// position (1, 1, 3); the display order inside a tie is alphabetical and has
// no meaning. Efficiency rankings need a minimum number of matches.

export const MIN_MATCHES_EFFICIENCY = 5;

export type SummaryRow = {
  player_id: string; competition_id: string; season_id: string; team_id: string;
  matches: number; wins: number; draws: number; losses: number; goals: number; assists: number; own_goals: number; goalkeeper_matches: number;
};
/** one line per goalkeeper per official match (view player_match_keeping) */
export type KeeperMatchRow = { player_id: string; competition_id: string; season_id: string; team_id: string; match_id: string; goals_conceded: number };
/** one line per MVP award (function mvp_results; empty while the MVP is not published) */
export type MvpAwardRow = { player_id: string; competition_id: string; season_id: string; team_id: string; match_id: string };
export type RankingFilter = { competitionIds?: Set<string> | null; seasonId?: string | null; teamId?: string | null };

export type PlayerTotals = {
  playerId: string; teamIds: string[];
  matches: number; wins: number; draws: number; losses: number; goals: number; assists: number; ownGoals: number;
  mvps: number; keeperMatches: number; goalsConceded: number;
};

export type CategoryKey = 'goals' | 'assists' | 'contributions' | 'mvps' | 'matches' | 'wins' | 'pointsPct' | 'goalsPerMatch' | 'assistsPerMatch' | 'contributionsPerMatch' | 'keeperConcededPerMatch' | 'ownGoals';

export type Category = {
  key: CategoryKey; label: string; short: string; unit: [string, string];
  value: (t: PlayerTotals) => number | null;
  /** lower is better (goals conceded) */
  ascending?: boolean;
  efficiency?: boolean;
  informative?: boolean;
  format?: (v: number) => string;
  /** sample used by the minimum (matches, or matches in goal) */
  sample?: (t: PlayerTotals) => number;
  needsMvp?: boolean;
};

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const pct = (v: number) => `${(Math.round(v * 1000) / 10).toLocaleString('pt-BR')}%`;
const per = (v: number) => (Math.round(v * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const CATEGORIES: Category[] = [
  { key: 'goals', label: 'Artilheiros', short: 'Gols', unit: ['gol', 'gols'], value: (t) => t.goals },
  { key: 'assists', label: 'Assistências', short: 'Assist.', unit: ['assistência', 'assistências'], value: (t) => t.assists },
  { key: 'contributions', label: 'Gols + assistências', short: 'G + A', unit: ['participação', 'participações'], value: (t) => t.goals + t.assists },
  { key: 'mvps', label: 'MVPs', short: 'MVPs', unit: ['MVP', 'MVPs'], value: (t) => t.mvps, needsMvp: true },
  { key: 'matches', label: 'Partidas disputadas', short: 'Partidas', unit: ['partida', 'partidas'], value: (t) => t.matches },
  { key: 'wins', label: 'Vitórias', short: 'Vitórias', unit: ['vitória', 'vitórias'], value: (t) => t.wins },
  { key: 'pointsPct', label: 'Aproveitamento', short: 'Aprov.', unit: ['', ''], efficiency: true, format: pct,
    value: (t) => ratio(t.wins * 3 + t.draws, (t.wins + t.draws + t.losses) * 3) },
  { key: 'goalsPerMatch', label: 'Gols por partida', short: 'Gols/J', unit: ['', ''], efficiency: true, format: per, value: (t) => ratio(t.goals, t.matches) },
  { key: 'assistsPerMatch', label: 'Assistências por partida', short: 'Assist./J', unit: ['', ''], efficiency: true, format: per, value: (t) => ratio(t.assists, t.matches) },
  { key: 'contributionsPerMatch', label: 'G + A por partida', short: 'G+A/J', unit: ['', ''], efficiency: true, format: per, value: (t) => ratio(t.goals + t.assists, t.matches) },
  { key: 'keeperConcededPerMatch', label: 'Goleiros: gols sofridos por partida', short: 'Sofr./J', unit: ['', ''], efficiency: true, ascending: true, format: per,
    value: (t) => ratio(t.goalsConceded, t.keeperMatches), sample: (t) => t.keeperMatches },
  { key: 'ownGoals', label: 'Gols contra (informativo)', short: 'Contra', unit: ['gol contra', 'gols contra'], value: (t) => t.ownGoals, informative: true },
];

const inFilter = (r: { competition_id: string; season_id: string; team_id: string }, f: RankingFilter) =>
  (!f.competitionIds || f.competitionIds.has(r.competition_id)) && (!f.seasonId || r.season_id === f.seasonId) && (!f.teamId || r.team_id === f.teamId);

/** Totals per player inside the filter. Each summary row is one player × competition × season × club, so nothing is counted twice. */
export function aggregate(rows: SummaryRow[], keeperRows: KeeperMatchRow[], f: RankingFilter, mvpRows: MvpAwardRow[] = []): Map<string, PlayerTotals> {
  const out = new Map<string, PlayerTotals>();
  const get = (id: string) => {
    let t = out.get(id);
    if (!t) { t = { playerId: id, teamIds: [], matches: 0, wins: 0, draws: 0, losses: 0, goals: 0, assists: 0, ownGoals: 0, mvps: 0, keeperMatches: 0, goalsConceded: 0 }; out.set(id, t); }
    return t;
  };
  for (const r of rows) {
    if (!inFilter(r, f)) continue;
    const t = get(r.player_id);
    t.matches += r.matches; t.wins += r.wins; t.draws += r.draws; t.losses += r.losses;
    t.goals += r.goals; t.assists += r.assists; t.ownGoals += r.own_goals;
    if (!t.teamIds.includes(r.team_id)) t.teamIds.push(r.team_id);
  }
  const seenKeeper = new Set<string>();
  for (const k of keeperRows) {
    if (!inFilter(k, f)) continue;
    const key = `${k.match_id}|${k.player_id}`;
    if (seenKeeper.has(key)) continue; // one line per player per match
    seenKeeper.add(key);
    const t = get(k.player_id);
    // a goal conceded with unknown minute still counts as conceded; the match counts in goal
    t.keeperMatches += 1; t.goalsConceded += k.goals_conceded;
  }
  const seenMvp = new Set<string>();
  for (const m of mvpRows) {
    if (!inFilter(m, f)) continue;
    const key = `${m.match_id}|${m.player_id}`;
    if (seenMvp.has(key)) continue;
    seenMvp.add(key);
    get(m.player_id).mvps += 1;
  }
  return out;
}

export type RankingEntry = { position: number; tied: boolean; totals: PlayerTotals; value: number };
export type Ranking = { entries: RankingEntry[]; belowMinimum: number };

/** Ranking of one category. Players with zero in a counting category are left out. */
export function rank(totals: Map<string, PlayerTotals>, category: Category, nameOf: (id: string) => string, minMatches = MIN_MATCHES_EFFICIENCY): Ranking {
  let belowMinimum = 0;
  const list: { totals: PlayerTotals; value: number }[] = [];
  for (const t of totals.values()) {
    const v = category.value(t);
    if (v === null || Number.isNaN(v)) continue;
    if (category.efficiency) {
      const sample = category.sample ? category.sample(t) : t.matches;
      if (sample <= 0) continue;
      if (sample < minMatches) { belowMinimum += 1; continue; }
    } else if (v <= 0) continue;
    list.push({ totals: t, value: v });
  }
  const sign = category.ascending ? 1 : -1;
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  list.sort((a, b) => (eq(a.value, b.value) ? nameOf(a.totals.playerId).localeCompare(nameOf(b.totals.playerId), 'pt-BR') : sign * (a.value - b.value)));
  const entries: RankingEntry[] = [];
  list.forEach((item, i) => {
    const prev = entries[i - 1];
    const position = prev && eq(prev.value, item.value) ? prev.position : i + 1;
    entries.push({ position, tied: false, totals: item.totals, value: item.value });
  });
  for (const e of entries) e.tied = entries.filter((x) => x.position === e.position).length > 1;
  return { entries, belowMinimum };
}
