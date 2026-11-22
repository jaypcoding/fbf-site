// Match statistics collected while the engine replays a recording.
//
// Definitions of kick, pass, assist, possession and shot on target follow the
// Haxball Replay Analyzer (https://github.com/haxball-replay-analyzer, file
// packages/replay-core/src/stats/football.js, MIT License, Copyright (c) 2020
// kpias760), ported to this engine:
//   - kick: a player presses kick within reach of the ball;
//   - pass: a kick followed by a kick of a different team-mate in the same play
//     (a play starts at kick-off and restarts after each goal);
//   - goal author: the last kicker of the play (a kicker of the other team means
//     an own goal; no kick in the play means an unknown author);
//   - assist: the previous different kicker, when he is from the scoring team;
//   - possession: playing ticks counted for the team of the last kicker;
//   - shot on target: a kick whose free flight (ball damping and gravity, no
//     bounces) crosses the opponent's goal line between the posts.
// FBF additions (documented in docs/sumula-replay.md): last touch at the goal
// (authorship check), attempts ("finalizações": free flight reaches the
// opponent's end line within one goal width beside the posts), per-player
// possession, heat-map grids, average position and goal/shot/pass locations.
import { TEAM_INFO, type Disc, type Game, type Player, type Room, type Stadium, type TeamId } from './model.ts';
import type { EngineListener } from './engine.ts';

export const STATS_DEFINITION = 'fbf-stats-1';

const SHOT_MAX_TICKS = 1200;
const SHOT_MIN_SPEED = 0.01;
const TOUCH_TOLERANCE = 0.1;
export const HEAT_COLS = 42;

type GoalLine = { x0: number; y0: number; x1: number; y1: number; team: TeamId };

function crossing(ax: number, ay: number, bx: number, by: number, g: GoalLine): { x: number; y: number } | null {
  const kx = bx - ax, ky = by - ay;
  if ((0 < -(g.y0 - ay) * kx + (g.x0 - ax) * ky) === (0 < -(g.y1 - ay) * kx + (g.x1 - ax) * ky)) return null;
  const ex = g.x1 - g.x0, ey = g.y1 - g.y0;
  if ((0 < -(ay - g.y0) * ex + (ax - g.x0) * ey) === (0 < -(by - g.y0) * ex + (bx - g.x0) * ey)) return null;
  const den = kx * ey - ky * ex;
  const s = den === 0 ? 0 : ((g.x0 - ax) * ey - (g.y0 - ay) * ex) / den;
  return { x: ax + s * kx, y: ay + s * ky };
}

/** Free flight of the ball after a kick; returns where it crosses one of the target lines. */
export function flightTarget(ball: { x: number; y: number; vx: number; vy: number }, damping: number, gx: number, gy: number, targets: GoalLine[]): { x: number; y: number } | null {
  if (targets.length === 0) return null;
  let x = ball.x, y = ball.y, vx = ball.vx, vy = ball.vy;
  const still = gx === 0 && gy === 0;
  for (let t = 0; t < SHOT_MAX_TICKS; t++) {
    const nx = x + vx, ny = y + vy;
    for (const g of targets) {
      const hit = crossing(x, y, nx, ny, g);
      if (hit) return hit;
    }
    x = nx; y = ny;
    vx = (vx + gx) * damping;
    vy = (vy + gy) * damping;
    if (still && vx * vx + vy * vy < SHOT_MIN_SPEED * SHOT_MIN_SPEED) break;
  }
  return null;
}

export type Point = [number, number];

export type HeatGrid = { cols: number; rows: number; cells: number[] };

export type SegmentPlayer = {
  key: string;
  name: string;
  country: string | null;
  ids: number[];
  ticksRed: number;
  ticksBlue: number;
  goals: number;
  assists: number;
  ownGoals: number;
  kicks: number;
  passes: number;
  shots: number;
  shotsOnTarget: number;
  possessionTicks: number;
  touches: number;
  sumX: number;
  sumY: number;
  heat: HeatGrid;
};

export type SegmentGoal = {
  time: number; // game clock, seconds
  frame: number;
  team: 1 | 2; // scoring side
  scorer: string | null;
  assist: string | null;
  ownGoal: boolean;
  lastTouch: string | null;
  ball: Point;
  shotFrom: Point | null;
};

export type TeamTotals = { kicks: number; passes: number; shots: number; shotsOnTarget: number; possessionTicks: number; goals: number };

export type StadiumSketch = {
  name: string;
  width: number; height: number;
  bgWidth: number; bgHeight: number; kickOffRadius: number;
  goals: { x0: number; y0: number; x1: number; y1: number; team: TeamId }[];
  /** Visible lines: [x0, y0, x1, y1, curveDegrees] */
  lines: [number, number, number, number, number][];
  playerRadius: number;
  ballRadius: number;
};

export type Segment = {
  index: number;
  startFrame: number;
  endFrame: number;
  endReason: 'finished' | 'stopped' | 'recording_ended';
  startedMidGame: boolean;
  scoreLimit: number;
  timeLimit: number;
  clockStart: number;
  clockEnd: number;
  playingTicks: number;
  initialScore: [number, number];
  score: [number, number];
  stadium: StadiumSketch;
  goals: SegmentGoal[];
  players: SegmentPlayer[];
  teams: { red: TeamTotals; blue: TeamTotals };
  ballThirds: [number, number, number];
  ballHeat: HeatGrid;
  shots: { key: string; team: 1 | 2; from: Point; to: Point; onTarget: boolean; time: number }[];
  passes: { key: string; team: 1 | 2; from: Point; to: Point; time: number }[];
  teamChanges: { time: number; key: string; team: TeamId }[];
};

const round1 = (v: number) => Math.round(v * 10) / 10;

function sketch(st: Stadium): StadiumSketch {
  const lines: [number, number, number, number, number][] = [];
  for (const s of st.segments) {
    if (!s.vis) continue;
    const curve = Number.isFinite(s.curveF) ? 114.59155902616465 * Math.atan(1 / s.curveF) : 0;
    lines.push([round1(s.v0.x), round1(s.v0.y), round1(s.v1.x), round1(s.v1.y), round1(curve)]);
  }
  return {
    name: st.name,
    width: st.width, height: st.height,
    bgWidth: st.bgWidth, bgHeight: st.bgHeight, kickOffRadius: st.kickOffRadius,
    goals: st.goals.map((g) => ({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, team: g.team })),
    lines,
    playerRadius: st.playerPhysics.radius,
    ballRadius: st.discs[0]?.radius ?? 10,
  };
}

function emptyTotals(): TeamTotals {
  return { kicks: 0, passes: 0, shots: 0, shotsOnTarget: 0, possessionTicks: 0, goals: 0 };
}

function gridSize(st: Stadium): { cols: number; rows: number } {
  const w = st.width > 0 ? st.width : 1;
  const h = st.height > 0 ? st.height : 1;
  return { cols: HEAT_COLS, rows: Math.max(4, Math.round((HEAT_COLS * h) / w)) };
}

function newGrid(size: { cols: number; rows: number }): HeatGrid {
  return { cols: size.cols, rows: size.rows, cells: new Array(size.cols * size.rows).fill(0) };
}

function addHeat(grid: HeatGrid, st: Stadium, x: number, y: number): void {
  const w = st.width > 0 ? st.width : 1;
  const h = st.height > 0 ? st.height : 1;
  let c = Math.floor(((x + w) / (2 * w)) * grid.cols);
  let r = Math.floor(((y + h) / (2 * h)) * grid.rows);
  if (!(c >= 0)) c = 0; else if (c >= grid.cols) c = grid.cols - 1;
  if (!(r >= 0)) r = 0; else if (r >= grid.rows) r = grid.rows - 1;
  grid.cells[r * grid.cols + c]++;
}

type Actor = { key: string; team: TeamId };

export function createStatsCollector() {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  let frame = 0;
  // identity of players inside this recording: the same nick re-entering keeps its key,
  // two people with the same nick at once get "nick (2)"
  const labels = new Map<number, string>();
  let kicker: Actor | null = null;
  let lastKicker: Actor | null = null;
  let lastToucher: Actor | null = null;
  let lastKick: { key: string; team: TeamId; x: number; y: number } | null = null;
  let goalLines: GoalLine[] = [];
  let heatSize = { cols: HEAT_COLS, rows: 20 };

  function label(room: Room, p: Player): string {
    const known = labels.get(p.id);
    if (known !== undefined) return known;
    const taken = new Set<string>();
    for (const other of room.players) {
      if (other.id !== p.id) {
        const l = labels.get(other.id);
        if (l !== undefined) taken.add(l);
      }
    }
    let l = p.name;
    for (let n = 2; taken.has(l); n++) l = `${p.name} (${n})`;
    labels.set(p.id, l);
    return l;
  }

  function playerEntry(room: Room, p: Player): SegmentPlayer {
    const seg = current!;
    const key = label(room, p);
    let entry = seg.players.find((e) => e.key === key);
    if (!entry) {
      entry = {
        key, name: p.name, country: p.country, ids: [], ticksRed: 0, ticksBlue: 0, goals: 0, assists: 0, ownGoals: 0,
        kicks: 0, passes: 0, shots: 0, shotsOnTarget: 0, possessionTicks: 0, touches: 0, sumX: 0, sumY: 0, heat: newGrid(heatSize),
      };
      seg.players.push(entry);
    }
    if (!entry.ids.includes(p.id)) entry.ids.push(p.id);
    return entry;
  }

  function resetPlay(): void {
    kicker = null;
    lastKicker = null;
    lastToucher = null;
    lastKick = null;
  }

  function open(room: Room, game: Game, midGame: boolean): void {
    const st = game.stadium;
    heatSize = gridSize(st);
    goalLines = st.goals.map((g) => ({ x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, team: g.team }));
    current = {
      index: segments.length,
      startFrame: frame,
      endFrame: frame,
      endReason: 'recording_ended',
      startedMidGame: midGame,
      scoreLimit: game.scoreLimit,
      timeLimit: game.timeLimit,
      clockStart: game.time,
      clockEnd: game.time,
      playingTicks: 0,
      initialScore: [game.red, game.blue],
      score: [game.red, game.blue],
      stadium: sketch(st),
      goals: [],
      players: [],
      teams: { red: emptyTotals(), blue: emptyTotals() },
      ballThirds: [0, 0, 0],
      ballHeat: newGrid(heatSize),
      shots: [],
      passes: [],
      teamChanges: [],
    };
    segments.push(current);
    resetPlay();
    for (const p of room.players) if (p.team !== 0) playerEntry(room, p);
  }

  function close(game: Game, reason: Segment['endReason']): void {
    if (!current) return;
    current.endFrame = frame;
    current.endReason = reason;
    current.clockEnd = game.time;
    current.score = [game.red, game.blue];
    current = null;
  }

  const totals = (team: TeamId) => (team === 1 ? current!.teams.red : current!.teams.blue);

  const listener: EngineListener = {
    onGameStart(room, game) {
      open(room, game, false);
    },
    onKickoffReset() {
      resetPlay();
    },
    onKick(room, game, player, ball: Disc, from) {
      if (!current || (player.team !== 1 && player.team !== 2)) return;
      const seg = current;
      const team = player.team;
      const me = playerEntry(room, player);
      me.kicks++;
      totals(team).kicks++;
      const opponentGoals = goalLines.filter((g) => g.team !== team);
      const onTarget = flightTarget({ x: from.x, y: from.y, vx: ball.vx, vy: ball.vy }, ball.damping, ball.gx, ball.gy, opponentGoals);
      let attempt = onTarget;
      if (!attempt) {
        // wider band beside the posts (one goal width each side): attempts off target
        const wide = opponentGoals.map((g) => {
          const dx = g.x1 - g.x0, dy = g.y1 - g.y0;
          return { x0: g.x0 - dx, y0: g.y0 - dy, x1: g.x1 + dx, y1: g.y1 + dy, team: g.team };
        });
        attempt = flightTarget({ x: from.x, y: from.y, vx: ball.vx, vy: ball.vy }, ball.damping, ball.gx, ball.gy, wide);
      }
      if (attempt) {
        me.shots++;
        totals(team).shots++;
        if (onTarget) { me.shotsOnTarget++; totals(team).shotsOnTarget++; }
        seg.shots.push({ key: me.key, team, from: [round1(from.x), round1(from.y)], to: [round1(attempt.x), round1(attempt.y)], onTarget: Boolean(onTarget), time: round1(game.time) });
      }
      if (kicker && kicker.key !== me.key) {
        lastKicker = kicker;
        if (lastKicker.team === team) {
          const passer = seg.players.find((e) => e.key === lastKicker!.key);
          if (passer) passer.passes++;
          totals(team).passes++;
          if (lastKick) seg.passes.push({ key: lastKicker.key, team, from: [round1(lastKick.x), round1(lastKick.y)], to: [round1(from.x), round1(from.y)], time: round1(game.time) });
        }
      }
      kicker = { key: me.key, team };
      lastKick = { key: me.key, team, x: from.x, y: from.y };
    },
    onPlayingTick(room, game) {
      if (!current) return;
      const seg = current;
      seg.playingTicks++;
      const st = game.stadium;
      const ball = game.discs[0];
      // thirds of the field by the ball position (left third is Red's side)
      const third = (st.bgWidth > 0 ? st.bgWidth : st.width) / 3;
      if (ball.x < -third) seg.ballThirds[0]++; else if (ball.x < third) seg.ballThirds[1]++; else seg.ballThirds[2]++;
      addHeat(seg.ballHeat, st, ball.x, ball.y);
      for (const p of room.players) {
        if (!p.disc || (p.team !== 1 && p.team !== 2)) continue;
        const e = playerEntry(room, p);
        if (p.team === 1) e.ticksRed++; else e.ticksBlue++;
        e.sumX += p.disc.x;
        e.sumY += p.disc.y;
        addHeat(e.heat, st, p.disc.x, p.disc.y);
        const dx = p.disc.x - ball.x, dy = p.disc.y - ball.y;
        const reach = p.disc.radius + ball.radius + TOUCH_TOLERANCE;
        if (dx * dx + dy * dy <= reach * reach) {
          if (!lastToucher || lastToucher.key !== e.key) e.touches++;
          lastToucher = { key: e.key, team: p.team };
        }
      }
      if (kicker) {
        totals(kicker.team).possessionTicks++;
        const holder = seg.players.find((e) => e.key === kicker!.key);
        if (holder) holder.possessionTicks++;
      }
    },
    onGoal(room, game, scoringTeam, ball) {
      if (!current || (scoringTeam !== 1 && scoringTeam !== 2)) return;
      const seg = current;
      seg.score = [game.red, game.blue];
      totals(scoringTeam).goals++;
      const goal: SegmentGoal = {
        time: game.time, frame, team: scoringTeam, scorer: null, assist: null, ownGoal: false,
        lastTouch: lastToucher?.key ?? null, ball: [round1(ball.x), round1(ball.y)], shotFrom: null,
      };
      if (kicker) {
        const k = kicker;
        if (k.team === scoringTeam) {
          goal.scorer = k.key;
          if (lastKick) goal.shotFrom = [round1(lastKick.x), round1(lastKick.y)];
          const se = seg.players.find((e) => e.key === k.key);
          if (se) se.goals++;
          if (lastKicker && lastKicker.team === scoringTeam) {
            goal.assist = lastKicker.key;
            const ae = seg.players.find((e) => e.key === lastKicker!.key);
            if (ae) ae.assists++;
          }
        } else {
          goal.scorer = k.key;
          goal.ownGoal = true;
          const se = seg.players.find((e) => e.key === k.key);
          if (se) se.ownGoals++;
        }
      }
      seg.goals.push(goal);
    },
    onGameEnd(room, game) {
      if (current) current.score = [game.red, game.blue];
    },
    onGameStop(room, game, reason) {
      close(game, reason);
    },
    onTeamChange(room, player, team) {
      if (!current) return;
      const e = playerEntry(room, player);
      current.teamChanges.push({ time: round1(room.game?.time ?? 0), key: e.key, team });
    },
    onPlayerJoin(room, player) {
      label(room, player);
    },
  };

  return {
    listener,
    setFrame(f: number) { frame = f; },
    /** Called when the recording starts with a game in progress. */
    openInitial(room: Room) {
      for (const p of room.players) label(room, p);
      if (room.game) open(room, room.game, true);
    },
    finish(room: Room) {
      if (current && room.game) close(room.game, 'recording_ended');
      return segments;
    },
    labelOf(room: Room, p: Player) { return label(room, p); },
  };
}

export function teamName(team: TeamId): string {
  return TEAM_INFO[team].name;
}
