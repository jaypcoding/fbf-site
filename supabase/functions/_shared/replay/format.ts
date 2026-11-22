// Decoder of HaxBall .hbr2 recordings (format version 3). Independent FBF
// implementation written for interoperability with the file format.
//
// Layout: "HBR2" | u32 version | u32 total frames | raw DEFLATE block. The
// inflated block holds the goal markers of the replay timeline, the full room
// state at the first frame, and the action log (frame delta, author, action).
import { Reader, ReplayError } from './binary.ts';
import { inflateRaw, type InflateBudget } from './inflate.ts';
import {
  defaultPlayerPhysics, newDisc, newSegment, prepareSegment, teamFromByte,
  type Disc, type Game, type Player, type PlayerPhysics, type Room, type Stadium, type TeamColors, type TeamId, type Vertex,
} from './model.ts';
import { builtInStadium } from './defaultStadiums.ts';

export const HBR2_SIGNATURE = 0x48425232; // "HBR2"
export const SUPPORTED_VERSIONS = [3] as const;

export type ReplayHeader = { signature: string; version: number; totalFrames: number; bytes: number };

export type ReplayAction =
  | { type: 'announcement'; text: string; color: number; style: number; sound: number }
  | { type: 'chatIndicator'; value: number }
  | { type: 'checksum'; data: Uint8Array }
  | { type: 'input'; input: number }
  | { type: 'chat'; text: string }
  | { type: 'join'; id: number; name: string | null; country: string | null; avatar: string | null }
  | { type: 'kick'; id: number; reason: string | null; ban: boolean }
  | { type: 'startGame' }
  | { type: 'stopGame' }
  | { type: 'pause'; paused: boolean }
  | { type: 'limit'; which: number; value: number }
  | { type: 'stadium'; stadium: Stadium }
  | { type: 'team'; id: number; team: TeamId }
  | { type: 'teamsLock'; value: boolean }
  | { type: 'admin'; id: number; value: boolean }
  | { type: 'autoTeams' }
  | { type: 'desync'; value: boolean }
  | { type: 'pings'; values: number[] }
  | { type: 'avatar'; value: string | null }
  | { type: 'teamColors'; team: TeamId; colors: TeamColors }
  | { type: 'reorder'; toTop: boolean; ids: number[] }
  | { type: 'kickRate'; min: number; rate: number; burst: number }
  | { type: 'headerAvatar'; value: string | null; id: number }
  | { type: 'discProps'; id: number; isPlayer: boolean; floats: (number | null)[]; ints: (number | null)[] };

export type ReplayEvent = { frame: number; by: number; action: ReplayAction };

export type DecodedReplay = {
  header: ReplayHeader;
  markers: { frame: number; kind: number }[];
  room: Room;
  events: ReplayEvent[];
};

export type DecodeLimits = { maxFrames: number; maxInflatedBytes: number; maxEvents: number; maxFileBytes: number };

export const DEFAULT_LIMITS: DecodeLimits = {
  maxFileBytes: 20 * 1024 * 1024, // real 2h recordings are well under 2 MB
  maxFrames: 4 * 60 * 60 * 60, // 4 h of play at 60 frames per second
  maxInflatedBytes: 64 * 1024 * 1024,
  maxEvents: 2_000_000,
};

export function readHeader(bytes: Uint8Array): ReplayHeader {
  if (bytes.byteLength === 0) throw new ReplayError('empty_file', 'O arquivo está vazio');
  if (bytes.byteLength < 12) throw new ReplayError('bad_signature', 'O arquivo não é uma gravação .hbr2 do HaxBall');
  const r = new Reader(bytes);
  const signature = r.u32();
  if (signature !== HBR2_SIGNATURE) throw new ReplayError('bad_signature', 'O arquivo não é uma gravação .hbr2 do HaxBall (assinatura inválida)');
  const version = r.u32();
  const totalFrames = r.u32();
  return { signature: 'HBR2', version, totalFrames, bytes: bytes.byteLength };
}

function readColor(r: Reader): TeamColors {
  const angle = r.u8();
  const text = r.i32();
  const n = r.u8();
  if (n > 3) throw new ReplayError('malformed', 'Cores de equipe inválidas');
  const colors: number[] = [];
  for (let i = 0; i < n; i++) colors.push(r.i32());
  return { angle, text, colors };
}

function readDisc(r: Reader): Disc {
  const d = newDisc();
  d.x = r.f64(); d.y = r.f64();
  d.vx = r.f64(); d.vy = r.f64();
  d.gx = r.f64(); d.gy = r.f64();
  d.radius = r.f64();
  d.bCoef = r.f64();
  d.invMass = r.f64();
  d.damping = r.f64();
  d.color = r.u32();
  d.cMask = r.i32();
  d.cGroup = r.i32();
  return d;
}

function readPlayerPhysics(r: Reader): PlayerPhysics {
  const p = defaultPlayerPhysics();
  p.bCoef = r.f64();
  p.invMass = r.f64();
  p.damping = r.f64();
  p.acceleration = r.f64();
  p.kickingAcceleration = r.f64();
  p.kickingDamping = r.f64();
  p.kickStrength = r.f64();
  p.gx = r.f64(); p.gy = r.f64();
  p.cGroup = r.i32();
  p.radius = r.f64();
  p.kickback = r.f64();
  return p;
}

function readPoints(r: Reader): { x: number; y: number }[] {
  const n = r.u8();
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ x: r.f64(), y: r.f64() });
  return out;
}

export function readStadium(r: Reader): Stadium {
  const index = r.u8();
  if (index !== 255) {
    const builtIn = builtInStadium(index);
    if (!builtIn) throw new ReplayError('malformed', `Estádio padrão desconhecido (${index})`);
    return builtIn;
  }
  const name = r.nstr() ?? '';
  const bgType = r.i32();
  const bgWidth = r.f64();
  const bgHeight = r.f64();
  const kickOffRadius = r.f64();
  const cornerRadius = r.f64();
  const goalLine = r.f64();
  const bgColor = r.i32();
  const width = r.f64();
  const height = r.f64();
  const spawnDistance = r.f64();
  const playerPhysics = readPlayerPhysics(r);
  const maxViewWidth = r.u16();
  const cameraFollow = r.u8();
  const canBeStored = r.bool();
  const fullKickoffReset = r.bool();
  const vertexes: Vertex[] = [];
  for (let i = 0, n = r.u8(); i < n; i++) {
    vertexes.push({ x: r.f64(), y: r.f64(), bCoef: r.f64(), cMask: r.i32(), cGroup: r.i32() });
  }
  const segments = [];
  for (let i = 0, n = r.u8(); i < n; i++) {
    const flags = r.u8();
    const i0 = r.u8();
    const i1 = r.u8();
    const v0 = vertexes[i0];
    const v1 = vertexes[i1];
    if (!v0 || !v1) throw new ReplayError('malformed', 'Segmento do estádio aponta para um vértice inexistente');
    const s = newSegment(v0, v1, i0, i1);
    s.bias = flags & 1 ? r.f64() : 0;
    s.curveF = flags & 2 ? r.f64() : Infinity;
    s.color = flags & 4 ? r.i32() : 0;
    s.vis = (flags & 8) !== 0;
    s.bCoef = r.f64();
    s.cMask = r.i32();
    s.cGroup = r.i32();
    segments.push(s);
  }
  const planes = [];
  for (let i = 0, n = r.u8(); i < n; i++) {
    planes.push({ nx: r.f64(), ny: r.f64(), dist: r.f64(), bCoef: r.f64(), cMask: r.i32(), cGroup: r.i32() });
  }
  const goals = [];
  for (let i = 0, n = r.u8(); i < n; i++) {
    goals.push({ x0: r.f64(), y0: r.f64(), x1: r.f64(), y1: r.f64(), team: teamFromByte(r.i8()) });
  }
  const discs: Disc[] = [];
  for (let i = 0, n = r.u8(); i < n; i++) discs.push(readDisc(r));
  const joints = [];
  for (let i = 0, n = r.u8(); i < n; i++) {
    joints.push({ d0: r.u8(), d1: r.u8(), min: r.f64(), max: r.f64(), strength: r.f64(), color: r.i32() });
  }
  const redSpawn = readPoints(r);
  const blueSpawn = readPoints(r);
  for (const s of segments) prepareSegment(s);
  return {
    name, defaultIndex: 255, bgType, bgWidth, bgHeight, kickOffRadius, cornerRadius, bgColor, goalLine,
    width, height, spawnDistance, playerPhysics, maxViewWidth, cameraFollow, canBeStored, fullKickoffReset,
    vertexes, segments, planes, goals, discs, joints, redSpawn, blueSpawn,
  };
}

function readRoom(r: Reader): Room {
  const name = r.nstr();
  const teamsLocked = r.bool();
  const scoreLimit = r.i32();
  const timeLimit = r.i32();
  const kickRateMax = r.i16();
  const kickRateRate = r.u8();
  const kickRateMin = r.u8();
  const stadium = readStadium(r);
  let game: Game | null = null;
  if (r.bool()) {
    const discs: Disc[] = [];
    for (let i = 0, n = r.u8(); i < n; i++) discs.push(readDisc(r));
    game = {
      discs,
      timer: r.i32(),
      phase: r.i32(),
      red: r.i32(),
      blue: r.i32(),
      time: r.f64(),
      pauseTimer: r.i32(),
      kickoffTeam: teamFromByte(r.i8()),
      scoreLimit,
      timeLimit,
      stadium,
    };
  }
  const players: Player[] = [];
  for (let i = 0, n = r.u8(); i < n; i++) {
    const admin = r.bool();
    const spawnIndex = r.i32();
    const avatar = r.nstr();
    const headerAvatar = r.nstr();
    const desynced = r.bool();
    const country = r.nstr();
    const unknown1 = r.i32();
    const pname = r.nstr() ?? 'Player';
    const input = r.i32();
    const id = r.varint();
    const kicking = r.bool();
    const kickRateCounter = r.i16();
    const kickCooldown = r.u8();
    const team = teamFromByte(r.i8());
    const discIndex = r.i16();
    const disc = discIndex >= 0 && game ? game.discs[discIndex] ?? null : null;
    players.push({ id, name: pname, admin, spawnIndex, avatar, headerAvatar, desynced, country, unknown1, input, kicking, kickRateCounter, kickCooldown, team, disc });
  }
  const red = readColor(r);
  const blue = readColor(r);
  return { name, teamsLocked, scoreLimit, timeLimit, kickRateMax, kickRateRate, kickRateMin, stadium, game, players, colors: [null, red, blue] };
}

async function readAction(r: Reader, type: number, budget: InflateBudget): Promise<ReplayAction> {
  switch (type) {
    case 0: {
      const text = r.str();
      if (text.length > 1000) throw new ReplayError('malformed', 'Mensagem longa demais na gravação');
      return { type: 'announcement', text, color: r.i32(), style: r.u8(), sound: r.u8() };
    }
    case 1: return { type: 'chatIndicator', value: r.u8() };
    case 2: return { type: 'checksum', data: r.bytes(r.varint()) };
    case 3: return { type: 'input', input: r.u32() };
    case 4: {
      const text = r.str();
      if (text.length > 140) throw new ReplayError('malformed', 'Mensagem de chat longa demais na gravação');
      return { type: 'chat', text };
    }
    case 5: return { type: 'join', id: r.i32(), name: r.nstr(), country: r.nstr(), avatar: r.nstr() };
    case 6: return { type: 'kick', id: r.i32(), reason: r.nstr(), ban: r.bool() };
    case 7: return { type: 'startGame' };
    case 8: return { type: 'stopGame' };
    case 9: return { type: 'pause', paused: r.bool() };
    case 10: return { type: 'limit', which: r.i32(), value: r.i32() };
    case 11: {
      const size = r.u16();
      const inflated = await inflateRaw(r.bytes(size), budget);
      return { type: 'stadium', stadium: readStadium(new Reader(inflated)) };
    }
    case 12: return { type: 'team', id: r.i32(), team: teamFromByte(r.i8()) };
    case 13: return { type: 'teamsLock', value: r.bool() };
    case 14: return { type: 'admin', id: r.i32(), value: r.bool() };
    case 15: return { type: 'autoTeams' };
    case 16: return { type: 'desync', value: r.bool() };
    case 17: {
      const values: number[] = [];
      for (let i = 0, n = r.varint(); i < n; i++) values.push(r.varint());
      return { type: 'pings', values };
    }
    case 18: {
      const v = r.nstr();
      return { type: 'avatar', value: v == null ? null : v.slice(0, 2) };
    }
    case 19: {
      const team = teamFromByte(r.i8());
      return { type: 'teamColors', team, colors: readColor(r) };
    }
    case 20: {
      const toTop = r.bool();
      const ids: number[] = [];
      for (let i = 0, n = r.u8(); i < n; i++) ids.push(r.i32());
      return { type: 'reorder', toTop, ids };
    }
    case 21: return { type: 'kickRate', min: r.i32(), rate: r.i32(), burst: r.i32() };
    case 22: {
      const v = r.nstr();
      return { type: 'headerAvatar', value: v == null ? null : v.slice(0, 2), id: r.i32() };
    }
    case 23: {
      const id = r.i32();
      const isPlayer = r.bool();
      let flags = r.u16();
      const floats: (number | null)[] = [];
      for (let i = 0; i < 10; i++) { floats.push(flags & 1 ? r.f32() : null); flags >>>= 1; }
      const ints: (number | null)[] = [];
      for (let i = 0; i < 3; i++) { ints.push(flags & 1 ? r.i32() : null); flags >>>= 1; }
      return { type: 'discProps', id, isPlayer, floats, ints };
    }
    default:
      throw new ReplayError('malformed', `Tipo de ação desconhecido na gravação (${type})`);
  }
}

/** Decodes a whole .hbr2 file. Throws ReplayError with a clear message for invalid or unsupported files. */
export async function decodeReplay(bytes: Uint8Array, limits: DecodeLimits = DEFAULT_LIMITS): Promise<DecodedReplay> {
  if (bytes.byteLength > limits.maxFileBytes) throw new ReplayError('too_large', 'O arquivo é maior que o limite permitido');
  const header = readHeader(bytes);
  if (!(SUPPORTED_VERSIONS as readonly number[]).includes(header.version)) {
    // HaxBall has only used small version numbers; anything else is a damaged header
    if (header.version === 0 || header.version > 100) throw new ReplayError('bad_signature', 'O arquivo não é uma gravação .hbr2 válida (cabeçalho corrompido)');
    throw new ReplayError('unsupported_version', `Versão de gravação não suportada (${header.version}); o FBF lê a versão 3 (.hbr2)`);
  }
  if (header.totalFrames > limits.maxFrames) throw new ReplayError('too_long', 'A gravação é mais longa que o limite permitido');
  const budget: InflateBudget = { remaining: limits.maxInflatedBytes };
  const body = await inflateRaw(bytes.subarray(12), budget);
  const r = new Reader(body);
  const markers: { frame: number; kind: number }[] = [];
  let frame = 0;
  for (let i = 0, n = r.u16(); i < n; i++) {
    frame += r.varint();
    markers.push({ frame, kind: r.u8() });
  }
  const room = readRoom(r);
  const events: ReplayEvent[] = [];
  frame = 0;
  while (r.remaining > 0) {
    frame += r.varint();
    const by = r.u16();
    const type = r.u8();
    const action = await readAction(r, type, budget);
    events.push({ frame, by, action });
    if (events.length > limits.maxEvents) throw new ReplayError('too_many_events', 'A gravação tem ações demais para ser analisada');
  }
  return { header, markers, room, events };
}
