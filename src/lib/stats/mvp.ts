// MVP of a match from the official sheet data (pure, deterministic).
//
// STATUS: proposal under evaluation. The weights below are the formula
// suggested by the FBF and are NOT official until approved after the
// historical simulation (docs/expansao/04-mvp-simulacao.md). Nothing in the
// site shows MVPs yet.
//
// Inputs come only from official data: goals (with scorer, assist and own
// goal flag), goalkeeper spells and the players who took part in the match.
// Penalty shootout goals are not part of the input (as in the official views).

export type Side = 'home' | 'away';

export type MvpWeights = {
  goal: number;            // per goal (own goals never count as goals)
  assist: number;          // per valid assist
  keeperBlockSeconds: number; // length of a complete clean block as goalkeeper
  keeperBlockPoints: number;  // points per complete clean block
  win: number;             // to every participant of the winning side
  ownGoal: number;         // per own goal (negative)
};

export const PROPOSED_WEIGHTS: MvpWeights = { goal: 3, assist: 2, keeperBlockSeconds: 120, keeperBlockPoints: 1, win: 2, ownGoal: -3 };

export type MvpGoal = {
  seconds: number;          // match second of the goal
  scorerSide: Side;         // side of the player who touched last (own goal: his own side)
  scorerId: string | null;
  ownGoal: boolean;
  assistId: string | null;  // already validated by the official rules
};

export type MvpKeeperSpell = { playerId: string; side: Side; start: number; end: number };

export type MvpInput = {
  durationSeconds: number;
  score: { home: number; away: number };
  participants: { playerId: string; side: Side }[];
  goals: MvpGoal[];
  keeperSpells: MvpKeeperSpell[];
};

export type MvpLine = {
  playerId: string;
  side: Side;
  goals: number;
  assists: number;
  ownGoals: number;
  keeperSeconds: number;      // time in goal (all spells)
  keeperBlocks: number;
  won: boolean;
  points: { goals: number; assists: number; keeper: number; win: number; ownGoals: number };
  total: number;
};

export type MvpResult = { lines: MvpLine[]; mvps: string[]; top: number | null };

/** Side that benefits from a goal: own goals count for the opponent. */
export const benefitingSide = (g: Pick<MvpGoal, 'scorerSide' | 'ownGoal'>): Side =>
  g.ownGoal ? (g.scorerSide === 'home' ? 'away' : 'home') : g.scorerSide;

/**
 * Clean periods of a goalkeeper spell, split by every goal conceded while he
 * was in goal. Only complete blocks inside an uninterrupted period count.
 */
export function keeperCleanBlocks(spell: MvpKeeperSpell, goals: MvpGoal[], blockSeconds: number): { keeperSeconds: number; blocks: number } {
  const start = Math.max(0, spell.start);
  const end = Math.max(start, spell.end);
  const conceded = goals
    .filter((g) => benefitingSide(g) !== spell.side && g.seconds > start && g.seconds <= end)
    .map((g) => g.seconds)
    .sort((a, b) => a - b);
  let keeperSeconds = 0;
  let blocks = 0;
  let from = start;
  for (const t of [...conceded, end]) {
    const length = Math.max(0, t - from);
    keeperSeconds += length;
    blocks += Math.floor(length / blockSeconds);
    from = t;
  }
  return { keeperSeconds, blocks };
}

export function computeMvp(input: MvpInput, weights: MvpWeights = PROPOSED_WEIGHTS): MvpResult {
  const winner: Side | null = input.score.home > input.score.away ? 'home' : input.score.away > input.score.home ? 'away' : null;
  const lines = new Map<string, MvpLine>();
  const line = (playerId: string, side: Side): MvpLine => {
    let l = lines.get(playerId);
    if (!l) {
      l = { playerId, side, goals: 0, assists: 0, ownGoals: 0, keeperSeconds: 0, keeperBlocks: 0, won: false, points: { goals: 0, assists: 0, keeper: 0, win: 0, ownGoals: 0 }, total: 0 };
      lines.set(playerId, l);
    }
    return l;
  };
  for (const p of input.participants) line(p.playerId, p.side);
  for (const g of input.goals) {
    if (g.scorerId) {
      const l = line(g.scorerId, g.scorerSide);
      if (g.ownGoal) l.ownGoals += 1; else l.goals += 1;
    }
    if (g.assistId && !g.ownGoal) line(g.assistId, g.scorerSide).assists += 1;
  }
  for (const spell of input.keeperSpells) {
    const l = line(spell.playerId, spell.side);
    const r = keeperCleanBlocks(spell, input.goals, weights.keeperBlockSeconds);
    l.keeperSeconds += r.keeperSeconds;
    l.keeperBlocks += r.blocks;
  }
  const participantIds = new Set(input.participants.map((p) => p.playerId));
  for (const l of lines.values()) {
    // the win bonus goes only to players known to have taken part
    l.won = winner !== null && l.side === winner && participantIds.has(l.playerId);
    l.points = {
      goals: l.goals * weights.goal,
      assists: l.assists * weights.assist,
      keeper: l.keeperBlocks * weights.keeperBlockPoints,
      win: l.won ? weights.win : 0,
      ownGoals: l.ownGoals ? l.ownGoals * weights.ownGoal : 0,
    };
    l.total = l.points.goals + l.points.assists + l.points.keeper + l.points.win + l.points.ownGoals;
  }
  const sorted = [...lines.values()].sort((a, b) => b.total - a.total || a.playerId.localeCompare(b.playerId));
  const top = sorted.length ? sorted[0].total : null;
  // shared MVP on a tie; no MVP when nobody scored a positive total
  const mvps = top !== null && top > 0 ? sorted.filter((l) => l.total === top).map((l) => l.playerId) : [];
  return { lines: sorted, mvps, top };
}
