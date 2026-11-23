// Hall da Fama: pure functions (no database access).
//
// - suggestPodium: what the official data says about the champion, runner-up
//   and third place of a season, from its LAST stage. It is only a suggestion
//   for the admin, who confirms it (the confirmed honour is what the site
//   shows). It reuses the same rules as the rest of the site: the knockout
//   winner rules (resolveMatchWinner / resolveAggregateWinner) and the
//   standings order (sortStandings with the stage's tie-breakers).
// - seasonTopScorers: the top scorer(s) of a season from the official totals
//   (player_season_summary), ties shared.
// - titleTable: how many titles each team has, from the published honours.
import { resolveAggregateWinner, resolveMatchWinner } from './competitionFormats.ts';
import { sortStandings, type StandingsRow } from './standings.ts';

export type HonourKind = 'CHAMPION' | 'RUNNER_UP' | 'THIRD_PLACE' | 'AWARD' | 'TOP_SCORER';
export type PodiumStage = { id: string; stage_order: number; tie_breakers: string[] };
export type PodiumRound = { id: string; stage_id: string; phase_type: string; bracket_round: number | null; name: string };
export type PodiumMatch = {
  id: string; round_id: string; status: string; series_id: string | null; series_leg: number;
  home_team_id: string | null; away_team_id: string | null;
  home_score: number | null; away_score: number | null; home_penalty_score: number | null; away_penalty_score: number | null;
  home_source_outcome?: 'WINNER' | 'LOSER' | null; away_source_outcome?: 'WINNER' | 'LOSER' | null;
};
export type Podium = {
  basis: 'FINAL' | 'STANDINGS' | null;
  champion: string | null; runnerUp: string | null; third: string | null;
  /** why there is no (complete) suggestion, in plain Portuguese */
  notes: string[];
};

type Series = { teams: [string, string]; legs: PodiumMatch[] };

function seriesOf(matches: PodiumMatch[]): Series[] {
  const groups = new Map<string, PodiumMatch[]>();
  for (const m of matches) {
    const key = m.series_id ?? m.id;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.values()].map((legs) => {
    const sorted = [...legs].sort((a, b) => a.series_leg - b.series_leg);
    return { teams: [sorted[0].home_team_id ?? '', sorted[0].away_team_id ?? ''] as [string, string], legs: sorted };
  });
}

/** Winner and loser of a finished series; null while undecided. */
export function seriesResult(s: Series): { winner: string; loser: string } | null {
  if (!s.teams[0] || !s.teams[1]) return null;
  if (s.legs.some((m) => m.status !== 'FINISHED' || m.home_score === null || m.away_score === null)) return null;
  const results = s.legs.map((m) => ({
    homeTeamId: m.home_team_id ?? '', awayTeamId: m.away_team_id ?? '',
    homeScore: m.home_score ?? 0, awayScore: m.away_score ?? 0,
    homePenaltyScore: m.home_penalty_score, awayPenaltyScore: m.away_penalty_score,
  }));
  const winner = results.length === 1 ? resolveMatchWinner(results[0]) : resolveAggregateWinner(s.teams[0], s.teams[1], results, results[results.length - 1]);
  if (!winner) return null;
  return { winner, loser: winner === s.teams[0] ? s.teams[1] : s.teams[0] };
}

export function suggestPodium(stages: PodiumStage[], rounds: PodiumRound[], matches: PodiumMatch[], standings: StandingsRow[]): Podium {
  const empty: Podium = { basis: null, champion: null, runnerUp: null, third: null, notes: [] };
  const last = [...stages].sort((a, b) => b.stage_order - a.stage_order)[0];
  if (!last) return { ...empty, notes: ['A temporada não tem fases cadastradas.'] };
  const stageRounds = rounds.filter((r) => r.stage_id === last.id);
  const knockout = stageRounds.filter((r) => r.phase_type === 'KNOCKOUT' && r.bracket_round !== null);

  if (knockout.length > 0) {
    const finalRound = Math.max(...knockout.map((r) => r.bracket_round as number));
    const roundIds = new Set(knockout.filter((r) => r.bracket_round === finalRound).map((r) => r.id));
    const series = seriesOf(matches.filter((m) => roundIds.has(m.round_id)));
    // the third-place series is fed by the LOSERS of the semi-finals
    const isThird = (s: Series) => s.legs.some((m) => m.home_source_outcome === 'LOSER' || m.away_source_outcome === 'LOSER')
      || s.legs.some((m) => /terceiro/i.test(knockout.find((r) => r.id === m.round_id)?.name ?? ''));
    const finals = series.filter((s) => !isThird(s));
    const thirds = series.filter(isThird);
    if (finals.length !== 1) return { ...empty, basis: 'FINAL', notes: [finals.length === 0 ? 'A final ainda não foi cadastrada.' : 'A última rodada do mata-mata tem mais de um confronto.'] };
    const final = seriesResult(finals[0]);
    const third = thirds.length === 1 ? seriesResult(thirds[0]) : null;
    const notes: string[] = [];
    if (!final) notes.push('A final ainda não terminou ou não tem vencedor definido.');
    if (thirds.length === 1 && !third) notes.push('A disputa do terceiro lugar ainda não terminou.');
    return { basis: 'FINAL', champion: final?.winner ?? null, runnerUp: final?.loser ?? null, third: third?.winner ?? null, notes };
  }

  const rows = standings.filter((r) => r.stage_id === last.id);
  if (rows.some((r) => r.stage_group_id)) return { ...empty, basis: 'STANDINGS', notes: ['A última fase tem grupos: o campeão precisa ser informado pela organização.'] };
  const stageMatchIds = new Set(stageRounds.map((r) => r.id));
  const stageMatches = matches.filter((m) => stageMatchIds.has(m.round_id) && m.status !== 'CANCELLED');
  if (rows.length < 2) return { ...empty, basis: 'STANDINGS', notes: ['A classificação da última fase ainda não tem equipes suficientes.'] };
  if (stageMatches.length === 0 || stageMatches.some((m) => m.status !== 'FINISHED')) {
    return { ...empty, basis: 'STANDINGS', notes: ['Ainda há partidas da última fase sem resultado.'] };
  }
  const sorted = sortStandings(rows, last.tie_breakers);
  const notes: string[] = [];
  // a tie on every criterion except the name is not a decision
  const decisive = last.tie_breakers.filter((c) => c !== 'TEAM_NAME');
  const sameNumbers = (a: StandingsRow, b: StandingsRow) => decisive.every((c) => {
    if (c === 'GOAL_DIFF') return a.goals_for - a.goals_against === b.goals_for - b.goals_against;
    const key = ({ POINTS: 'points', WINS: 'wins', DRAWS: 'draws', LOSSES: 'losses', GOALS_FOR: 'goals_for', GOALS_AGAINST: 'goals_against' } as Record<string, keyof StandingsRow>)[c];
    return !key || a[key] === b[key];
  });
  if (sorted.length >= 2 && sameNumbers(sorted[0], sorted[1])) notes.push('As duas primeiras equipes estão empatadas em todos os critérios: confirme o campeão com a organização.');
  return { basis: 'STANDINGS', champion: sorted[0]?.team_id ?? null, runnerUp: sorted[1]?.team_id ?? null, third: sorted[2]?.team_id ?? null, notes };
}

export type ScorerRow = { player_id: string; season_id: string; team_id: string; goals: number };
export type SeasonTopScorers = { seasonId: string; goals: number; players: { playerId: string; teamIds: string[] }[] };

/** Top scorer(s) of each season (sum over the teams of the player in that season); ties shared; seasons without goals left out. */
export function seasonTopScorers(rows: ScorerRow[], seasonIds: Set<string>): SeasonTopScorers[] {
  const perSeason = new Map<string, Map<string, { goals: number; teamIds: string[] }>>();
  for (const r of rows) {
    if (!seasonIds.has(r.season_id)) continue;
    const players = perSeason.get(r.season_id) ?? new Map();
    const p = players.get(r.player_id) ?? { goals: 0, teamIds: [] };
    p.goals += r.goals;
    if (r.goals > 0 && !p.teamIds.includes(r.team_id)) p.teamIds.push(r.team_id);
    players.set(r.player_id, p);
    perSeason.set(r.season_id, players);
  }
  const out: SeasonTopScorers[] = [];
  for (const [seasonId, players] of perSeason) {
    const top = Math.max(0, ...[...players.values()].map((p) => p.goals));
    if (top <= 0) continue;
    out.push({ seasonId, goals: top, players: [...players.entries()].filter(([, p]) => p.goals === top).map(([playerId, p]) => ({ playerId, teamIds: p.teamIds })) });
  }
  return out;
}

/** team_id: a registered team; team_name: a team of an edition before the system that is no longer registered */
export type PublishedHonour = { season_id: string; kind: HonourKind; team_id: string | null; team_name?: string | null };
export type TitleLine = { key: string; teamId: string | null; teamName: string | null; titles: number; runnerUps: number; thirds: number };

// Titles per team. A registered team adds up its titles in the system and
// before it; a team known only by name (before the system) is counted by
// that name (case and spaces ignored).
export function titleTable(honours: PublishedHonour[]): TitleLine[] {
  const m = new Map<string, TitleLine>();
  for (const h of honours) {
    if (h.kind !== 'CHAMPION' && h.kind !== 'RUNNER_UP' && h.kind !== 'THIRD_PLACE') continue;
    const name = h.team_name?.trim() || null;
    const key = h.team_id ?? (name ? `name:${name.toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')}` : null);
    if (!key) continue;
    const line = m.get(key) ?? { key, teamId: h.team_id, teamName: h.team_id ? null : name, titles: 0, runnerUps: 0, thirds: 0 };
    if (h.kind === 'CHAMPION') line.titles += 1;
    if (h.kind === 'RUNNER_UP') line.runnerUps += 1;
    if (h.kind === 'THIRD_PLACE') line.thirds += 1;
    m.set(key, line);
  }
  return [...m.values()].sort((a, b) => b.titles - a.titles || b.runnerUps - a.runnerUps || b.thirds - a.thirds);
}
