// Data model of a HaxBall room as stored in .hbr2 recordings (version 3).
// Independent FBF implementation written for interoperability with the file
// format; field meanings follow the public stadium (.hbs) format.

export type TeamId = 0 | 1 | 2; // 0 spectators, 1 red, 2 blue

export const TEAM_INFO: Record<TeamId, { name: 'Spectators' | 'Red' | 'Blue'; side: number; kickoffMask: number; cGroup: number }> = {
  0: { name: 'Spectators', side: 0, kickoffMask: -1, cGroup: 0 },
  1: { name: 'Red', side: -1, kickoffMask: 8, cGroup: 2 },
  2: { name: 'Blue', side: 1, kickoffMask: 16, cGroup: 4 },
};

export function teamFromByte(value: number): TeamId {
  return value === 1 ? 1 : value === 2 ? 2 : 0;
}

export function otherTeam(team: TeamId): TeamId {
  return team === 1 ? 2 : team === 2 ? 1 : 0;
}

// Collision flags (cMask / cGroup)
export const CF = { ball: 1, red: 2, blue: 4, redKO: 8, blueKO: 16, wall: 32, kick: 64, score: 128 } as const;

export type Disc = {
  x: number; y: number;
  vx: number; vy: number;
  gx: number; gy: number;
  radius: number;
  bCoef: number;
  invMass: number;
  damping: number;
  color: number;
  cMask: number;
  cGroup: number;
};

export type Vertex = { x: number; y: number; bCoef: number; cMask: number; cGroup: number };

export type Segment = {
  v0: Vertex; v1: Vertex;
  v0Index: number; v1Index: number;
  bias: number;
  /** Curve factor: Infinity for a straight segment. */
  curveF: number;
  color: number;
  vis: boolean;
  bCoef: number;
  cMask: number;
  cGroup: number;
  // derived
  nx: number; ny: number;
  cx: number; cy: number; r: number;
  t0x: number; t0y: number; t1x: number; t1y: number;
};

export type Plane = { nx: number; ny: number; dist: number; bCoef: number; cMask: number; cGroup: number };
export type Goal = { x0: number; y0: number; x1: number; y1: number; team: TeamId };
export type Joint = { d0: number; d1: number; min: number; max: number; strength: number; color: number };

export type PlayerPhysics = {
  bCoef: number; invMass: number; damping: number;
  acceleration: number; kickingAcceleration: number; kickingDamping: number;
  kickStrength: number; gx: number; gy: number; cGroup: number; radius: number; kickback: number;
};

export type Stadium = {
  name: string;
  /** Index of a built-in stadium, or 255 for a custom one. */
  defaultIndex: number;
  bgType: number; bgWidth: number; bgHeight: number; kickOffRadius: number; cornerRadius: number; bgColor: number; goalLine: number;
  width: number; height: number; spawnDistance: number;
  playerPhysics: PlayerPhysics;
  maxViewWidth: number; cameraFollow: number; canBeStored: boolean; fullKickoffReset: boolean;
  vertexes: Vertex[]; segments: Segment[]; planes: Plane[]; goals: Goal[]; discs: Disc[]; joints: Joint[];
  redSpawn: { x: number; y: number }[]; blueSpawn: { x: number; y: number }[];
};

export type TeamColors = { angle: number; text: number; colors: number[] };

export type Player = {
  id: number;
  name: string;
  admin: boolean;
  spawnIndex: number;
  avatar: string | null;
  headerAvatar: string | null;
  desynced: boolean;
  country: string | null;
  unknown1: number;
  input: number;
  kicking: boolean;
  kickRateCounter: number;
  kickCooldown: number;
  team: TeamId;
  disc: Disc | null;
};

export type Game = {
  discs: Disc[];
  pauseTimer: number;
  time: number;
  red: number;
  blue: number;
  phase: number; // 0 kickoff, 1 playing, 2 goal celebration, 3 game ending
  timer: number;
  kickoffTeam: TeamId;
  scoreLimit: number;
  timeLimit: number;
  stadium: Stadium;
};

export type Room = {
  name: string | null;
  teamsLocked: boolean;
  scoreLimit: number;
  timeLimit: number;
  kickRateMax: number;
  kickRateRate: number;
  kickRateMin: number;
  stadium: Stadium;
  game: Game | null;
  players: Player[];
  colors: [TeamColors | null, TeamColors, TeamColors];
};

export function newDisc(): Disc {
  return { x: 0, y: 0, vx: 0, vy: 0, gx: 0, gy: 0, radius: 10, bCoef: 0.5, invMass: 1, damping: 0.99, color: 0xffffff, cMask: 63, cGroup: 63 };
}

export function cloneDisc(d: Disc): Disc {
  return { ...d };
}

export function defaultPlayerPhysics(): PlayerPhysics {
  return { bCoef: 0.5, invMass: 0.5, damping: 0.96, acceleration: 0.1, kickingAcceleration: 0.07, kickingDamping: 0.96, kickStrength: 5, gx: 0, gy: 0, cGroup: 0, radius: 15, kickback: 0 };
}

/** Precomputes the collision geometry of a segment (normal for straight ones, circle for curved ones). */
export function prepareSegment(s: Segment): void {
  if (Number.isFinite(s.curveF)) {
    const hx = 0.5 * (s.v1.x - s.v0.x);
    const hy = 0.5 * (s.v1.y - s.v0.y);
    const k = s.curveF;
    s.cx = s.v0.x + hx - hy * k;
    s.cy = s.v0.y + hy + hx * k;
    const dx = s.v0.x - s.cx;
    const dy = s.v0.y - s.cy;
    s.r = Math.sqrt(dx * dx + dy * dy);
    s.t0x = -(s.v0.y - s.cy);
    s.t0y = s.v0.x - s.cx;
    s.t1x = -(s.cy - s.v1.y);
    s.t1y = s.cx - s.v1.x;
    if (k <= 0) {
      s.t0x = -s.t0x; s.t0y = -s.t0y;
      s.t1x = -s.t1x; s.t1y = -s.t1y;
    }
  } else {
    const ax = s.v0.x - s.v1.x;
    const ay = -(s.v0.y - s.v1.y);
    const len = Math.sqrt(ay * ay + ax * ax);
    s.nx = ay / len;
    s.ny = ax / len;
  }
}

export function newSegment(v0: Vertex, v1: Vertex, v0Index: number, v1Index: number): Segment {
  return {
    v0, v1, v0Index, v1Index, bias: 0, curveF: Infinity, color: 0, vis: true, bCoef: 1, cMask: 63, cGroup: 32,
    nx: 0, ny: 0, cx: 0, cy: 0, r: 0, t0x: 0, t0y: 0, t1x: 0, t1y: 0,
  };
}

const MIN_CURVE = 0.17435839227423353;
const MAX_CURVE = 5.934119456780721;

/** Sets the curve of a segment from an angle in degrees (used by the built-in stadiums). */
export function setCurve(s: Segment, degrees: number): void {
  let a = degrees * 0.017453292519943295;
  if (a < 0) {
    a = -a;
    const v = s.v0; s.v0 = s.v1; s.v1 = v;
    const i = s.v0Index; s.v0Index = s.v1Index; s.v1Index = i;
    s.bias = -s.bias;
  }
  if (a > MIN_CURVE && a < MAX_CURVE) s.curveF = 1 / Math.tan(a / 2);
}
