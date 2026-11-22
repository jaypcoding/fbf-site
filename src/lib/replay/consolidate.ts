// Consolidation of every recording attached to one FBF match into a single
// match sheet ("súmula"). The unit of validation is the MATCH: files are only
// evidence. A file may hold a whole match (two games), one half, a piece of a
// half, or extra games; several files may repeat the same stretch.
//
// Rules (documented in docs/sumula-replay.md):
// - every game ("segment") of every analysed file is a candidate; very short
//   goalless games (< 60 s of play) are left out by default;
// - segments are grouped into HaxBall games: a segment that starts with the
//   clock running and the score of a previous game continues it; a segment
//   that covers the same clock range with the same goals is a repeat;
// - goals are kept once per game (same side and clock time); goals that
//   happened before or between recordings become team goals without author;
// - additive statistics are summed over the pieces of a game that do not
//   overlap; possession uses raw ticks (never an average of percentages);
// - heat maps are summed tick counts in a common frame where the home team
//   attacks to the right (games where home played as Blue are rotated 180°);
// - RED/BLUE are mapped to home/away per game from the identified players,
//   never from the home/away order.
import type { FileAnalysis } from './analyze.ts';
import type { HeatGrid, Point, Segment, StadiumSketch } from './stats.ts';
import { isDuplicateLabel, normalizeNick, resolveNick, type NickResolution, type PlayerAlias, type RosterPlayer } from './matching.ts';

export const SHEET_VERSION = 1;
const SHORT_SEGMENT_TICKS = 60 * 60;
const GOAL_TIME_TOLERANCE = 0.2;
const OVERLAP_TOLERANCE = 5;

export type ReplayFileInput = {
  id: string;
  name: string;
  sha256: string;
  sizeBytes: number;
  lastModified: number | null;
  uploadedAt: string;
  status: 'PENDING' | 'ANALYZED' | 'FAILED';
  error?: string | null;
  usedInOtherMatch?: boolean;
  analysis: FileAnalysis | null;
};

export type MatchInput = { id: string; homeTeamId: string; awayTeamId: string; homeName: string; awayName: string };

export type Side = 'home' | 'away';

export type ReviewDecisions = {
  order?: string[];
  orderConfirmed?: boolean;
  acknowledgeReuse?: string[];
  segments?: Record<string, { include?: boolean; redIs?: Side }>;
  players?: Record<string, string>;
  goals?: Record<string, { scorer?: string; assist?: string; ownGoal?: boolean }>;
  goalkeepers?: { home?: string; away?: string };
};

export type SheetIssue = { level: 'block' | 'warn' | 'info'; code: string; message: string; ref?: string };

export type SheetSegment = {
  key: string;
  fileId: string;
  fileName: string;
  index: number;
  include: boolean;
  includeSource: 'auto' | 'manual';
  excludedReason: string | null;
  gameIndex: number | null;
  role: 'piece' | 'repeat' | null;
  clockStart: number;
  clockEnd: number;
  score: [number, number];
  redIs: Side | null;
  redIsSource: 'auto' | 'manual' | null;
  stadiumName: string;
  players: { key: string; name: string; color: 1 | 2 | null }[];
  goals: number;
  endReason: Segment['endReason'];
  startedMidGame: boolean;
};

export type SheetGame = {
  index: number;
  label: string;
  segmentKeys: string[];
  offsetSeconds: number;
  durationSeconds: number;
  homeGoals: number;
  awayGoals: number;
  redIs: Side | null;
};

export type SheetGoal = {
  key: string;
  gameIndex: number;
  minuteSeconds: number;
  clock: number;
  side: Side;
  teamId: string;
  ownGoal: boolean;
  scorerKey: string | null;
  scorerName: string | null;
  scorerPlayerId: string | null;
  scorerIdent: string | null;
  assistIdent: string | null;
  assistKey: string | null;
  assistName: string | null;
  assistPlayerId: string | null;
  source: 'replay' | 'not_recorded';
  corrected: boolean;
  notes: string[];
  ball: Point | null;
  shotFrom: Point | null;
};

export type PlayerStats = {
  goals: number; assists: number; ownGoals: number; kicks: number; passes: number; shots: number; shotsOnTarget: number;
  possessionTicks: number; touches: number; playedTicks: number;
};

export type SheetPlayer = {
  ref: string;
  key: string;
  ident: string;
  names: string[];
  playerId: string | null;
  seasonTeamId: string | null;
  side: Side | null;
  resolution: NickResolution;
  stats: PlayerStats;
  heat: HeatGrid | null;
  avgX: number | null;
};

export type TeamSheet = { kicks: number; passes: number; shots: number; shotsOnTarget: number; possessionTicks: number; possessionPct: number | null; goals: number };

export type MatchSheet = {
  version: number;
  matchId: string;
  files: { id: string; name: string; sha256: string; status: ReplayFileInput['status']; durationSeconds: number | null; segments: number; error: string | null; orderHint: string | null }[];
  order: { fileIds: string[]; source: 'single' | 'timestamp' | 'sequence' | 'upload' | 'manual'; confirmed: boolean };
  segments: SheetSegment[];
  games: SheetGame[];
  goals: SheetGoal[];
  players: SheetPlayer[];
  teams: { home: TeamSheet; away: TeamSheet };
  score: { home: number; away: number };
  durationSeconds: number;
  ballHeat: HeatGrid | null;
  thirds: [number, number, number];
  shots: { side: Side; ref: string; from: Point; to: Point; onTarget: boolean }[];
  passes: { side: Side; ref: string; from: Point; to: Point }[];
  stadium: StadiumSketch | null;
  goalkeepers: { home: string | null; away: string | null; suggested: { home: string | null; away: string | null } };
  issues: SheetIssue[];
  canConfirm: boolean;
};

export type ConsolidationInput = {
  match: MatchInput;
  roster: RosterPlayer[];
  aliases: PlayerAlias[];
  files: ReplayFileInput[];
  decisions: ReviewDecisions;
};

// ------------------------------------------------------------------ helpers
function emptyStats(): PlayerStats {
  return { goals: 0, assists: 0, ownGoals: 0, kicks: 0, passes: 0, shots: 0, shotsOnTarget: 0, possessionTicks: 0, touches: 0, playedTicks: 0 };
}

function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Date/time written in the file name by HaxBall or by recording bots, if any. */
export function fileNameTimestamp(name: string): number | null {
  let m = /(\d{4})-(\d{2})-(\d{2})-(\d{2})h(\d{2})m(?:-?(\d{2})s)?/.exec(name);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0);
  m = /(\d{2})-(\d{2})-(\d{4})-(\d{2})h(\d{2})m(?:-?(\d{2})s)?/.exec(name);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], m[6] ? +m[6] : 0);
  m = /rec_(\d{13})/.exec(name);
  if (m) return Number(m[1]);
  return null;
}

function sequenceNumber(name: string): { prefix: string; n: number } | null {
  const base = name.replace(/\.hbr2$/i, '');
  const m = /^(.*?)(\d{1,3})$/.exec(base.trim());
  return m ? { prefix: m[1].trim().toLowerCase(), n: Number(m[2]) } : null;
}

function rotateGrid(g: HeatGrid): HeatGrid {
  return { cols: g.cols, rows: g.rows, cells: [...g.cells].reverse() };
}

function addGrid(target: HeatGrid | null, g: HeatGrid): HeatGrid | null {
  if (!target) return { cols: g.cols, rows: g.rows, cells: [...g.cells] };
  if (target.cols !== g.cols || target.rows !== g.rows) return target;
  for (let i = 0; i < g.cells.length; i++) target.cells[i] += g.cells[i];
  return target;
}

const rot = (p: Point, flip: boolean): Point => (flip ? [-p[0], -p[1]] : p);

type Piece = { seg: Segment; sheet: SheetSegment; file: ReplayFileInput };
type GameBuild = { pieces: Piece[]; repeats: Piece[]; start: number; end: number; stadium: string; names: Set<string> };

function namesOf(seg: Segment): Set<string> {
  return new Set(seg.players.filter((p) => p.ticksRed + p.ticksBlue > 0).map((p) => normalizeNick(p.key)));
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / Math.min(a.size, b.size);
}

function scoreAt(pieces: Piece[], clock: number): [number, number] {
  const first = pieces[0].seg;
  const out: [number, number] = [first.initialScore[0], first.initialScore[1]];
  const seen: { team: number; time: number }[] = [];
  for (const p of pieces) {
    for (const g of p.seg.goals) {
      if (g.time > clock + GOAL_TIME_TOLERANCE) continue;
      if (seen.some((s) => s.team === g.team && Math.abs(s.time - g.time) <= GOAL_TIME_TOLERANCE)) continue;
      seen.push({ team: g.team, time: g.time });
      if (g.team === 1) out[0]++; else out[1]++;
    }
  }
  return out;
}

// ------------------------------------------------------------------ main
export function consolidateMatch(input: ConsolidationInput): MatchSheet {
  const { match, roster, aliases, files, decisions } = input;
  const issues: SheetIssue[] = [];
  const issue = (level: SheetIssue['level'], code: string, message: string, ref?: string) => issues.push({ level, code, message, ref });

  // ---- files and order
  const usable = files.filter((f) => f.status === 'ANALYZED' && f.analysis);
  if (files.length === 0) issue('block', 'no_files', 'Nenhuma gravação foi enviada para esta partida.');
  for (const f of files) {
    if (f.status === 'PENDING') issue('block', 'file_pending', `A análise do arquivo "${f.name}" ainda não terminou.`, f.id);
    if (f.status === 'FAILED') issue('block', 'file_failed', `O arquivo "${f.name}" não pôde ser analisado: ${f.error ?? 'erro desconhecido'}. Reprocesse ou remova o arquivo.`, f.id);
    if (f.usedInOtherMatch && !(decisions.acknowledgeReuse ?? []).includes(f.id)) {
      issue('block', 'file_reused', `O arquivo "${f.name}" já foi enviado em outra partida. Confirme que ele pertence a esta partida antes de validar.`, f.id);
    }
  }
  const hints = new Map<string, string | null>();
  let orderSource: MatchSheet['order']['source'] = 'single';
  let ordered = [...usable];
  if (usable.length > 1) {
    const stamps = usable.map((f) => fileNameTimestamp(f.name));
    const seqs = usable.map((f) => sequenceNumber(f.name));
    if (stamps.every((s) => s !== null) && new Set(stamps).size === stamps.length) {
      orderSource = 'timestamp';
      ordered.sort((a, b) => fileNameTimestamp(a.name)! - fileNameTimestamp(b.name)!);
      usable.forEach((f, i) => { const d = new Date(stamps[i]!); hints.set(f.id, `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`); });
    } else if (seqs.every((s) => s !== null) && new Set(seqs.map((s) => s!.prefix)).size === 1 && new Set(seqs.map((s) => s!.n)).size === seqs.length) {
      orderSource = 'sequence';
      ordered.sort((a, b) => sequenceNumber(a.name)!.n - sequenceNumber(b.name)!.n);
      usable.forEach((f, i) => hints.set(f.id, `nº ${seqs[i]!.n}`));
    } else {
      orderSource = 'upload';
      ordered.sort((a, b) => (a.lastModified ?? 0) - (b.lastModified ?? 0) || a.uploadedAt.localeCompare(b.uploadedAt));
    }
  }
  if (decisions.order && decisions.order.length > 0) {
    const pos = new Map(decisions.order.map((id, i) => [id, i]));
    if (usable.every((f) => pos.has(f.id))) {
      ordered = [...usable].sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
      orderSource = 'manual';
    }
  }
  const orderConfirmed = orderSource !== 'upload' || decisions.orderConfirmed === true;

  // ---- player resolution (same nickname, same decision, across files)
  // Two people whose nicks differ only by case/spaces (or are equal: "nick (2)")
  // in the same game are never merged: they keep separate identities and need
  // a manual decision.
  const conflicted = new Set<string>();
  for (const f of usable) for (const s of f.analysis!.segments) {
    const byName = new Map<string, Set<string>>();
    for (const p of s.players) {
      const n = normalizeNick(p.name);
      if (!byName.has(n)) byName.set(n, new Set());
      byName.get(n)!.add(p.key);
    }
    for (const [n, keys] of byName) if (keys.size > 1) conflicted.add(n);
  }
  const ident = (key: string, name: string): string => (conflicted.has(normalizeNick(name)) ? `raw:${key}` : normalizeNick(key));
  const resolutionCache = new Map<string, NickResolution>();
  const resolve = (key: string, name: string): NickResolution => {
    const n = ident(key, name);
    let r = resolutionCache.get(n);
    if (!r) {
      r = resolveNick(key, name, roster, aliases, decisions.players?.[n], conflicted.has(normalizeNick(name)));
      resolutionCache.set(n, r);
    }
    return r;
  };
  const rosterById = new Map(roster.map((r) => [`${r.playerId}|${r.seasonTeamId}`, r]));
  const sideOfTeam = (seasonTeamId: string | null): Side | null => (seasonTeamId === match.homeTeamId ? 'home' : seasonTeamId === match.awayTeamId ? 'away' : null);

  // ---- segments
  const sheetSegments: SheetSegment[] = [];
  const pieces: Piece[] = [];
  for (const f of ordered) {
    for (const seg of f.analysis!.segments) {
      const key = `${f.id}:${seg.index}`;
      const auto = seg.playingTicks >= SHORT_SEGMENT_TICKS || seg.goals.length > 0;
      const decided = decisions.segments?.[key]?.include;
      const include = decided ?? auto;
      const players = seg.players.filter((p) => p.ticksRed + p.ticksBlue > 0).map((p) => ({
        key: p.key, name: p.name, color: (p.ticksRed >= p.ticksBlue ? 1 : 2) as 1 | 2,
      }));
      // RED/BLUE → home/away from identified players
      let redHome = 0, redAway = 0;
      for (const p of seg.players) {
        const total = p.ticksRed + p.ticksBlue;
        if (total === 0) continue;
        const r = resolve(p.key, p.name);
        if (r.status !== 'matched') continue;
        const side = sideOfTeam(r.seasonTeamId);
        const color = p.ticksRed >= p.ticksBlue ? 1 : 2;
        if (!side) continue;
        if ((color === 1 && side === 'home') || (color === 2 && side === 'away')) redHome++; else redAway++;
      }
      let redIs: Side | null = null;
      let redIsSource: SheetSegment['redIsSource'] = null;
      const manualSide = decisions.segments?.[key]?.redIs;
      if (manualSide) { redIs = manualSide; redIsSource = 'manual'; }
      else if (redHome > redAway && redAway === 0) { redIs = 'home'; redIsSource = 'auto'; }
      else if (redAway > redHome && redHome === 0) { redIs = 'away'; redIsSource = 'auto'; }
      else if (redHome !== redAway && Math.max(redHome, redAway) >= 2 * Math.min(redHome, redAway) + 1) {
        redIs = redHome > redAway ? 'home' : 'away'; redIsSource = 'auto';
        if (include) issue('warn', 'side_conflict', `Na gravação "${f.name}" (${fmtClock(seg.clockStart)}–${fmtClock(seg.clockEnd)}) há jogadores identificados nos dois lados contrários; confira as equipes.`, key);
      }
      const sheet: SheetSegment = {
        key, fileId: f.id, fileName: f.name, index: seg.index, include, includeSource: decided === undefined ? 'auto' : 'manual',
        excludedReason: include ? null : decided === false ? 'Excluído pelo administrador' : 'Trecho curto sem gols (menos de 1 minuto de jogo)',
        gameIndex: null, role: null, clockStart: seg.clockStart, clockEnd: seg.clockEnd, score: seg.score, redIs, redIsSource,
        stadiumName: seg.stadium.name, players, goals: seg.goals.length, endReason: seg.endReason, startedMidGame: seg.clockStart > 1 || seg.initialScore[0] + seg.initialScore[1] > 0,
      };
      sheetSegments.push(sheet);
      if (seg.playingTicks === 0 && seg.goals.length === 0) {
        if (include && decided === undefined) { sheet.include = false; sheet.excludedReason = 'Jogo iniciado e encerrado sem bola rolando'; }
        continue;
      }
      if (sheet.include) pieces.push({ seg, sheet, file: f });
      else issue('info', 'segment_excluded', `Trecho de ${fmtClock(seg.clockEnd - seg.clockStart)} em "${f.name}" não entra na súmula (${sheet.excludedReason}).`, key);
      // markers written by the game for goals of this file (cross-check)
    }
    const markerGoals = f.analysis!.goalMarkers.length;
    const fileGoals = f.analysis!.segments.reduce((n, s) => n + s.goals.length, 0);
    if (markerGoals !== fileGoals) {
      issue('warn', 'markers_mismatch', `O arquivo "${f.name}" marca ${markerGoals} gol(s) na linha do tempo, mas a análise encontrou ${fileGoals}. Confira a gravação.`, f.id);
    }
  }
  if (files.length > 0 && usable.length > 0 && pieces.length === 0) {
    issue('block', 'no_segments', 'As gravações não contêm trechos de jogo suficientes para validar esta partida.');
  }

  // ---- group pieces into games
  const games: GameBuild[] = [];
  for (const piece of pieces) {
    const s = piece.seg;
    const names = namesOf(s);
    let target: GameBuild | null = null;
    let repeat = false;
    for (const g of games) {
      if (g.stadium !== s.stadium.name || overlapRatio(g.names, names) < 0.5) continue;
      const overlap = Math.min(g.end, s.clockEnd) - Math.max(g.start, s.clockStart);
      if (overlap > OVERLAP_TOLERANCE) {
        // same clock stretch: must show the same goals in the common window
        const lo = Math.max(g.start, s.clockStart), hi = Math.min(g.end, s.clockEnd);
        const theirs = g.pieces.flatMap((p) => p.seg.goals).filter((x) => x.time >= lo && x.time <= hi);
        const mine = s.goals.filter((x) => x.time >= lo && x.time <= hi);
        const sameGoals = mine.length === theirs.length && mine.every((x) => theirs.some((y) => y.team === x.team && Math.abs(y.time - x.time) <= GOAL_TIME_TOLERANCE));
        const start = scoreAt(g.pieces, s.clockStart);
        if (sameGoals && (s.clockStart <= g.start + 1 ? true : start[0] === s.initialScore[0] && start[1] === s.initialScore[1])) {
          target = g; repeat = true; break;
        }
      } else if (s.clockStart > 1 && s.clockStart >= g.end - OVERLAP_TOLERANCE) {
        const end = scoreAt(g.pieces, g.end);
        if (s.initialScore[0] >= end[0] && s.initialScore[1] >= end[1]) { target = g; break; }
      }
    }
    if (!target) {
      games.push({ pieces: [piece], repeats: [], start: s.clockStart, end: s.clockEnd, stadium: s.stadium.name, names });
      continue;
    }
    const gap = s.clockStart - target.end;
    if (repeat && s.clockEnd - s.clockStart <= target.end - target.start + OVERLAP_TOLERANCE && s.clockStart >= target.start - 1 && s.clockEnd <= target.end + 1) {
      target.repeats.push(piece);
      piece.sheet.role = 'repeat';
      issue('warn', 'overlap', `O trecho ${fmtClock(s.clockStart)}–${fmtClock(s.clockEnd)} de "${piece.file.name}" repete um trecho já coberto por outra gravação; gols e estatísticas dele são contados uma única vez.`, piece.sheet.key);
    } else {
      if (repeat) issue('warn', 'overlap', `A gravação "${piece.file.name}" se sobrepõe a outra no trecho ${fmtClock(Math.max(target.start, s.clockStart))}–${fmtClock(Math.min(target.end, s.clockEnd))}; os gols repetidos são contados uma única vez (pelo tempo do jogo) e as estatísticas individuais desse arquivo não são somadas, para não contar o trecho repetido em dobro.`, piece.sheet.key);
      else if (gap > 1) issue('warn', 'recording_gap', `Há ${fmtClock(gap)} sem gravação entre ${fmtClock(target.end)} e ${fmtClock(s.clockStart)} de um mesmo tempo ("${piece.file.name}").`, piece.sheet.key);
      target.pieces.push(piece);
      target.start = Math.min(target.start, s.clockStart);
      target.end = Math.max(target.end, s.clockEnd);
      for (const n of names) target.names.add(n);
    }
  }

  // ---- side mapping per game (from all of its pieces)
  const sheetGames: SheetGame[] = [];
  const goals: SheetGoal[] = [];
  const playerMap = new Map<string, SheetPlayer>();
  const teams = { home: { kicks: 0, passes: 0, shots: 0, shotsOnTarget: 0, possessionTicks: 0, possessionPct: null as number | null, goals: 0 }, away: { kicks: 0, passes: 0, shots: 0, shotsOnTarget: 0, possessionTicks: 0, possessionPct: null as number | null, goals: 0 } };
  let ballHeat: HeatGrid | null = null;
  const thirds: [number, number, number] = [0, 0, 0];
  const shots: MatchSheet['shots'] = [];
  const passes: MatchSheet['passes'] = [];
  let stadium: StadiumSketch | null = null;
  let offset = 0;
  const labelFor = (i: number, n: number) => (n <= 2 ? `${i + 1}º tempo` : `Período ${i + 1}`);

  games.forEach((g, gi) => {
    g.pieces.sort((a, b) => a.seg.clockStart - b.seg.clockStart);
    const all = [...g.pieces, ...g.repeats];
    // one mapping per game: manual decision on any piece wins, else agreement of pieces
    const manual = all.find((p) => p.sheet.redIsSource === 'manual');
    let redIs: Side | null = manual ? manual.sheet.redIs : null;
    if (!redIs) {
      const autos = new Set(all.map((p) => p.sheet.redIs).filter(Boolean));
      if (autos.size === 1) redIs = [...autos][0] as Side;
    }
    for (const p of all) { p.sheet.gameIndex = gi; if (!p.sheet.role) p.sheet.role = 'piece'; if (redIs && !p.sheet.redIs) { p.sheet.redIs = redIs; p.sheet.redIsSource = 'auto'; } }
    const label = labelFor(gi, games.length);
    if (!redIs) {
      issue('block', 'side_unknown', `${label}: não foi possível identificar com segurança qual equipe jogou de vermelho e qual de azul. Informe o lado das equipes ou identifique os jogadores.`, g.pieces[0].sheet.key);
    }
    const flip = redIs === 'away';
    // while the side is unknown (blocking issue) Red is shown as home provisionally
    const effRed: Side = redIs ?? 'home';
    const sideOfColor = (color: number): Side => (color === 1 ? effRed : effRed === 'home' ? 'away' : 'home');
    const duration = g.end;
    const gameGoals: SheetGoal[] = [];

    // goals: first the not-recorded ones (before the first piece / in gaps)
    const first = g.pieces[0].seg;
    const synth = (count: number, color: 1 | 2, clock: number, why: string) => {
      for (let i = 0; i < count; i++) {
        const side = sideOfColor(color);
        gameGoals.push({
          key: `${g.pieces[0].sheet.key}:nr${color}${clock.toFixed(0)}${i}`, gameIndex: gi, minuteSeconds: 0, clock, side: side ?? 'home',
          teamId: side === 'away' ? match.awayTeamId : match.homeTeamId, ownGoal: false,
          scorerKey: null, scorerName: null, scorerPlayerId: null, scorerIdent: null, assistIdent: null, assistKey: null, assistName: null, assistPlayerId: null,
          source: 'not_recorded', corrected: false, notes: [why], ball: null, shotFrom: null,
        });
      }
    };
    if (first.initialScore[0] + first.initialScore[1] > 0) {
      synth(first.initialScore[0], 1, first.clockStart, 'Gol anterior ao início da gravação (autor desconhecido)');
      synth(first.initialScore[1], 2, first.clockStart, 'Gol anterior ao início da gravação (autor desconhecido)');
      issue('warn', 'recording_started_late', `${label}: a gravação começou aos ${fmtClock(first.clockStart)} com placar ${first.initialScore[0]} × ${first.initialScore[1]} (vermelho × azul); esses gols entram sem autor.`, g.pieces[0].sheet.key);
    } else if (first.clockStart > 1) {
      issue('warn', 'recording_started_late', `${label}: a gravação começou aos ${fmtClock(first.clockStart)} de jogo; o que aconteceu antes não está registrado.`, g.pieces[0].sheet.key);
    }
    const seen: { team: number; time: number }[] = [];
    let running: [number, number] = [first.initialScore[0], first.initialScore[1]];
    let coveredEnd = first.clockStart;
    const statPieces: Piece[] = [];
    for (const p of g.pieces) {
      const s = p.seg;
      if (s !== first && s.clockStart > coveredEnd + 1) {
        const missR = s.initialScore[0] - running[0], missB = s.initialScore[1] - running[1];
        if (missR > 0) synth(missR, 1, s.clockStart, 'Gol em trecho não gravado (autor desconhecido)');
        if (missB > 0) synth(missB, 2, s.clockStart, 'Gol em trecho não gravado (autor desconhecido)');
        running = [running[0] + Math.max(0, missR), running[1] + Math.max(0, missB)];
      }
      // stats only from pieces that add new clock time (no double counting)
      if (s.clockStart >= coveredEnd - OVERLAP_TOLERANCE || statPieces.length === 0) statPieces.push(p);
      s.goals.forEach((goal, idx) => {
        if (seen.some((x) => x.team === goal.team && Math.abs(x.time - goal.time) <= GOAL_TIME_TOLERANCE)) return;
        seen.push({ team: goal.team, time: goal.time });
        if (goal.team === 1) running[0]++; else running[1]++;
        const side = sideOfColor(goal.team);
        const key = `${p.sheet.key}:${idx}`;
        const fix = decisions.goals?.[key];
        const scorerPlayer = (k: string | null) => (k ? s.players.find((x) => x.key === k) : undefined);
        const sp = scorerPlayer(goal.scorer);
        const ap = scorerPlayer(goal.assist);
        const sRes = sp ? resolve(sp.key, sp.name) : null;
        const aRes = ap ? resolve(ap.key, ap.name) : null;
        const notes: string[] = [];
        if (goal.scorer === null) notes.push('Ninguém chutou a bola nesta jogada antes do gol: autor não identificado pela gravação');
        if (goal.lastTouch && goal.scorer && goal.lastTouch !== goal.scorer && !goal.ownGoal) {
          const lt = s.players.find((x) => x.key === goal.lastTouch);
          const ltColor = lt ? (lt.ticksRed >= lt.ticksBlue ? 1 : 2) : null;
          if (ltColor === goal.team) notes.push(`Último toque antes do gol foi de ${goal.lastTouch} (mesma equipe); a gravação credita o último chute a ${goal.scorer}. Confira a autoria.`);
          else if (lt) notes.push(`Desvio de ${goal.lastTouch} antes de entrar.`);
        }
        const entry: SheetGoal = {
          key, gameIndex: gi, minuteSeconds: 0, clock: goal.time, side, teamId: side === 'home' ? match.homeTeamId : match.awayTeamId,
          ownGoal: goal.ownGoal, scorerKey: goal.scorer, scorerName: sp?.name ?? null,
          scorerPlayerId: sRes?.status === 'matched' ? sRes.playerId : null,
          scorerIdent: sp ? ident(sp.key, sp.name) : null, assistIdent: ap ? ident(ap.key, ap.name) : null,
          assistKey: goal.assist, assistName: ap?.name ?? null, assistPlayerId: aRes?.status === 'matched' ? aRes.playerId : null,
          source: 'replay', corrected: false, notes, ball: goal.ball ? rot(goal.ball, flip) : null, shotFrom: goal.shotFrom ? rot(goal.shotFrom, flip) : null,
        };
        if (goal.ownGoal) entry.teamId = side === 'home' ? match.awayTeamId : match.homeTeamId;
        if (fix) {
          entry.corrected = true;
          if (fix.ownGoal !== undefined) entry.ownGoal = fix.ownGoal;
          if (fix.scorer !== undefined) {
            entry.scorerPlayerId = fix.scorer === 'none' ? null : fix.scorer;
            entry.scorerName = fix.scorer === 'none' ? null : roster.find((r) => r.playerId === fix.scorer)?.nickname ?? null;
          }
          if (fix.assist !== undefined) {
            entry.assistPlayerId = fix.assist === 'none' ? null : fix.assist;
            entry.assistName = fix.assist === 'none' ? null : roster.find((r) => r.playerId === fix.assist)?.nickname ?? null;
          }
          entry.teamId = entry.ownGoal ? (side === 'home' ? match.awayTeamId : match.homeTeamId) : (side === 'home' ? match.homeTeamId : match.awayTeamId);
          notes.push('Autoria corrigida pelo administrador');
        }
        if (entry.ownGoal) { entry.assistPlayerId = null; entry.assistName = null; entry.assistKey = null; entry.assistIdent = null; }
        gameGoals.push(entry);
      });
      coveredEnd = Math.max(coveredEnd, s.clockEnd);
    }
    const last = g.pieces.reduce((a, b) => (b.seg.clockEnd >= a.seg.clockEnd ? b : a));
    {
      const red = gameGoals.filter((x) => x.side === effRed).length;
      const blue = gameGoals.length - red;
      if (red !== last.seg.score[0] || blue !== last.seg.score[1]) {
        issue('block', 'score_mismatch', `${label}: os gols consolidados (${red} × ${blue}) não batem com o placar da gravação (${last.seg.score[0]} × ${last.seg.score[1]}, vermelho × azul).`, last.sheet.key);
      }
    }
    for (const goal of gameGoals) goal.minuteSeconds = Math.floor(offset + goal.clock);
    gameGoals.sort((a, b) => a.clock - b.clock);
    goals.push(...gameGoals);
    if (last.seg.endReason !== 'finished' && last.seg.timeLimit > 0 && last.seg.clockEnd < last.seg.timeLimit * 60 - 1) {
      issue('warn', 'game_not_finished', `${label}: a gravação termina aos ${fmtClock(last.seg.clockEnd)}, antes do tempo regulamentar de ${last.seg.timeLimit} min do jogo.`, last.sheet.key);
    }

    // statistics of the game
    for (const p of statPieces) {
      const s = p.seg;
      if (!stadium) stadium = s.stadium;
      thirds[0] += flip ? s.ballThirds[2] : s.ballThirds[0];
      thirds[1] += s.ballThirds[1];
      thirds[2] += flip ? s.ballThirds[0] : s.ballThirds[2];
      ballHeat = addGrid(ballHeat, flip ? rotateGrid(s.ballHeat) : s.ballHeat);
      for (const color of [1, 2] as const) {
        const side = sideOfColor(color);
        if (!side) continue;
        const t = color === 1 ? s.teams.red : s.teams.blue;
        const T = teams[side];
        T.kicks += t.kicks; T.passes += t.passes; T.shots += t.shots; T.shotsOnTarget += t.shotsOnTarget; T.possessionTicks += t.possessionTicks;
      }
      for (const sp of s.players) {
        const played = sp.ticksRed + sp.ticksBlue;
        if (played === 0 && sp.kicks === 0) continue;
        const res = resolve(sp.key, sp.name);
        if (res.status === 'ignored') continue;
        const color = sp.ticksRed >= sp.ticksBlue ? 1 : 2;
        const ref = res.status === 'matched' ? res.playerId : `nick:${ident(sp.key, sp.name)}`;
        let e = playerMap.get(ref);
        if (!e) {
          e = {
            ref, key: sp.key, ident: ident(sp.key, sp.name), names: [], playerId: res.status === 'matched' ? res.playerId : null,
            seasonTeamId: res.status === 'matched' ? res.seasonTeamId : null, side: null, resolution: res,
            stats: emptyStats(), heat: null, avgX: null,
          };
          playerMap.set(ref, e);
        }
        if (!e.names.includes(sp.name)) e.names.push(sp.name);
        const side = sideOfColor(color);
        e.side = e.side ?? (res.status === 'matched' ? sideOfTeam(res.seasonTeamId) : side);
        if (res.status === 'matched' && side && sideOfTeam(res.seasonTeamId) !== side) {
          issue('block', 'player_wrong_team', `${sp.name} está cadastrado em ${sideOfTeam(res.seasonTeamId) === 'home' ? match.homeName : match.awayName}, mas jogou pelo outro lado no ${label}. Corrija a identificação do jogador ou o lado das equipes.`, ident(sp.key, sp.name));
        }
        const st = e.stats;
        st.kicks += sp.kicks; st.passes += sp.passes; st.shots += sp.shots; st.shotsOnTarget += sp.shotsOnTarget;
        st.possessionTicks += sp.possessionTicks; st.touches += sp.touches; st.playedTicks += played;
        const mx = played > 0 ? (flip ? -sp.sumX : sp.sumX) : 0;
        e.avgX = ((e.avgX ?? 0) * (st.playedTicks - played) + mx) / Math.max(1, st.playedTicks);
        e.heat = addGrid(e.heat, flip ? rotateGrid(sp.heat) : sp.heat);
      }
      for (const sh of s.shots) {
        const side = sideOfColor(sh.team);
        const res = s.players.find((x) => x.key === sh.key);
        if (!side || !res) continue;
        const r = resolve(res.key, res.name);
        shots.push({ side, ref: r.status === 'matched' ? r.playerId : `nick:${ident(res.key, res.name)}`, from: rot(sh.from, flip), to: rot(sh.to, flip), onTarget: sh.onTarget });
      }
      for (const ps of s.passes) {
        const side = sideOfColor(ps.team);
        const res = s.players.find((x) => x.key === ps.key);
        if (!side || !res) continue;
        const r = resolve(res.key, res.name);
        passes.push({ side, ref: r.status === 'matched' ? r.playerId : `nick:${ident(res.key, res.name)}`, from: rot(ps.from, flip), to: rot(ps.to, flip) });
      }
    }
    sheetGames.push({
      index: gi, label, segmentKeys: all.map((p) => p.sheet.key), offsetSeconds: Math.round(offset * 10) / 10, durationSeconds: Math.round(duration * 10) / 10,
      homeGoals: gameGoals.filter((x) => x.side === 'home').length, awayGoals: gameGoals.filter((x) => x.side === 'away').length, redIs,
    });
    offset += duration;
  });

  // ---- goals and assists credited to players
  for (const goal of goals) {
    const credit = (playerId: string | null, field: 'goals' | 'assists' | 'ownGoals') => {
      if (!playerId) return;
      const e = playerMap.get(playerId);
      if (e) e.stats[field]++;
    };
    if (goal.ownGoal) credit(goal.scorerPlayerId, 'ownGoals');
    else { credit(goal.scorerPlayerId, 'goals'); credit(goal.assistPlayerId, 'assists'); }
    // unidentified authors still count on their nickname row (shown as not identified)
    if (!goal.scorerPlayerId && goal.scorerKey && !goal.corrected) {
      const e = goal.scorerIdent ? playerMap.get(`nick:${goal.scorerIdent}`) : undefined;
      if (e) e.stats[goal.ownGoal ? 'ownGoals' : 'goals']++;
    }
    if (!goal.assistPlayerId && goal.assistKey && !goal.ownGoal && !goal.corrected) {
      const e = goal.assistIdent ? playerMap.get(`nick:${goal.assistIdent}`) : undefined;
      if (e) e.stats.assists++;
    }
  }

  // ---- player issues
  const players = [...playerMap.values()];
  for (const p of players) {
    const involved = goals.some((g) => !g.corrected && (g.scorerIdent === p.ident || g.assistIdent === p.ident));
    const r = p.resolution;
    const name = p.names.join(' / ');
    if (r.status === 'ambiguous') issue(involved ? 'block' : 'warn', 'player_ambiguous', `O nick "${name}" corresponde a mais de um jogador cadastrado (${r.candidates.map((c) => c.nickname).join(', ')}). Escolha o jogador correto.`, p.ident);
    else if (r.status === 'unknown') issue(involved ? 'block' : 'warn', 'player_unknown', `Um jogador não foi identificado: "${name}" não está no elenco das equipes da partida${r.suggestions.length ? ` (sugestões: ${r.suggestions.map((s) => s.nickname).join(', ')})` : ''}. Associe a um jogador do elenco ou marque como não identificado.`, p.ident);
    else if (r.status === 'unidentified' && involved) issue('warn', 'player_unidentified', `"${name}" ficará sem jogador associado; gols dele entram só para a equipe e assistências dele não são registradas.`, p.ident);
    if (isDuplicateLabel(p.key) || p.ident.startsWith('raw:')) issue('warn', 'duplicate_nick', `Duas pessoas usaram o nick "${p.names[0]}" ao mesmo tempo na gravação; as estatísticas foram mantidas separadas ("${p.key}").`, p.ident);
  }
  for (const g of goals) {
    if (g.corrected && g.scorerPlayerId) {
      const want = g.ownGoal ? (g.side === 'home' ? match.awayTeamId : match.homeTeamId) : g.teamId;
      if (!rosterById.has(`${g.scorerPlayerId}|${want}`)) issue('block', 'goal_invalid_author', `O autor escolhido para o gol aos ${fmtClock(g.minuteSeconds)} não pertence ao elenco da equipe correspondente.`, g.key);
    }
    if (g.assistPlayerId && (g.assistPlayerId === g.scorerPlayerId || !rosterById.has(`${g.assistPlayerId}|${g.teamId}`))) {
      issue('block', 'goal_invalid_assist', `A assistência do gol aos ${fmtClock(g.minuteSeconds)} precisa ser de outro jogador da mesma equipe.`, g.key);
    }
    if (g.assistPlayerId && !g.scorerPlayerId && (g.scorerKey === null || g.corrected || resolutionCache.get(g.scorerIdent ?? '')?.status === 'unidentified')) {
      issue('warn', 'goal_assist_dropped', `O gol aos ${fmtClock(g.minuteSeconds)} ficará sem autor; a assistência dele não será registrada.`, g.key);
    }
    if (g.notes.some((n) => n.startsWith('Último toque'))) issue('warn', 'goal_authorship', `Gol aos ${fmtClock(g.minuteSeconds)}: ${g.notes.find((n) => n.startsWith('Último toque'))}`, g.key);
    if (g.source === 'replay' && g.scorerKey === null && !g.corrected) issue('warn', 'goal_without_author', `O gol aos ${fmtClock(g.minuteSeconds)} não tem autor identificado na gravação; ele entra só para a equipe, a menos que você informe o autor.`, g.key);
  }
  if (!orderConfirmed && sheetGames.length > 1) {
    issue('block', 'order_uncertain', 'Não foi possível determinar a ordem dos arquivos pelos nomes. Confira a ordem (1º tempo, 2º tempo...) e confirme.');
  }

  // ---- totals
  const score = { home: goals.filter((g) => g.side === 'home').length, away: goals.filter((g) => g.side === 'away').length };
  teams.home.goals = score.home;
  teams.away.goals = score.away;
  const possTotal = teams.home.possessionTicks + teams.away.possessionTicks;
  if (possTotal > 0) {
    teams.home.possessionPct = Math.round((teams.home.possessionTicks / possTotal) * 1000) / 10;
    teams.away.possessionPct = Math.round((1000 - teams.home.possessionPct * 10)) / 10;
  }
  const durationSeconds = Math.round(sheetGames.reduce((n, g) => n + g.durationSeconds, 0));

  // ---- goalkeepers: registered goalkeepers (position Goleiro) who played, most minutes first
  const suggestKeeper = (side: Side): string | null => {
    const teamId = side === 'home' ? match.homeTeamId : match.awayTeamId;
    const keepers = players.filter((p) => p.playerId && p.seasonTeamId === teamId && roster.some((r) => r.playerId === p.playerId && r.seasonTeamId === teamId && r.position === 'Goleiro'));
    keepers.sort((a, b) => b.stats.playedTicks - a.stats.playedTicks);
    return keepers[0]?.playerId ?? null;
  };
  const suggested = { home: suggestKeeper('home'), away: suggestKeeper('away') };
  const chosen = {
    home: decisions.goalkeepers?.home !== undefined ? (decisions.goalkeepers.home || null) : suggested.home,
    away: decisions.goalkeepers?.away !== undefined ? (decisions.goalkeepers.away || null) : suggested.away,
  };
  for (const side of ['home', 'away'] as const) {
    const id = chosen[side];
    const teamId = side === 'home' ? match.homeTeamId : match.awayTeamId;
    if (id && !roster.some((r) => r.playerId === id && r.seasonTeamId === teamId && r.position === 'Goleiro')) {
      issue('block', 'goalkeeper_invalid', `O goleiro escolhido para ${side === 'home' ? match.homeName : match.awayName} precisa estar no elenco e cadastrado como Goleiro.`);
    }
    if (!id && pieces.length > 0) issue('info', 'goalkeeper_none', `Nenhum goleiro cadastrado de ${side === 'home' ? match.homeName : match.awayName} foi identificado na gravação; o CS dessa equipe não será registrado.`);
  }

  const fileRows = files.map((f) => ({
    id: f.id, name: f.name, sha256: f.sha256, status: f.status, durationSeconds: f.analysis?.durationSeconds ?? null,
    segments: f.analysis?.segments.length ?? 0, error: f.error ?? null, orderHint: hints.get(f.id) ?? null,
  }));
  const blocking = issues.some((i) => i.level === 'block');
  return {
    version: SHEET_VERSION,
    matchId: match.id,
    files: fileRows,
    order: { fileIds: ordered.map((f) => f.id), source: orderSource, confirmed: orderConfirmed },
    segments: sheetSegments,
    games: sheetGames,
    goals,
    players: players.sort((a, b) => (a.side ?? 'z').localeCompare(b.side ?? 'z') || b.stats.playedTicks - a.stats.playedTicks),
    teams,
    score,
    durationSeconds,
    ballHeat,
    thirds,
    shots,
    passes,
    stadium,
    goalkeepers: { ...chosen, suggested },
    issues,
    canConfirm: !blocking,
  };
}

/** Part of the sheet that becomes official data (what the confirmation writes). */
export function officialPayload(sheet: MatchSheet) {
  return {
    version: sheet.version,
    matchId: sheet.matchId,
    score: sheet.score,
    durationSeconds: sheet.durationSeconds,
    goals: sheet.goals.map((g) => ({
      minute_seconds: g.minuteSeconds,
      team_id: g.teamId,
      player_id: g.scorerPlayerId,
      is_own_goal: g.ownGoal,
      assist_player_id: g.ownGoal || !g.scorerPlayerId ? null : g.assistPlayerId,
      side: g.side,
      source: g.source,
    })),
    goalkeepers: (['home', 'away'] as const).flatMap((side) => {
      const id = sheet.goalkeepers[side];
      if (!id) return [];
      const p = sheet.players.find((x) => x.playerId === id);
      const firstGame = sheet.games.find((g) => p && sheet.segments.some((s) => g.segmentKeys.includes(s.key) && s.players.some((sp) => sp.key === p.key)));
      return [{ side, player_id: id, started_at_seconds: Math.floor(firstGame?.offsetSeconds ?? 0) }];
    }),
    files: sheet.files.filter((f) => f.status === 'ANALYZED').map((f) => f.id),
    aliases: sheet.players
      .filter((p) => p.playerId && p.resolution.status === 'matched' && p.resolution.via === 'manual')
      .flatMap((p) => p.names.map((n) => ({ player_id: p.playerId, alias: n }))),
  };
}

export type OfficialPayload = ReturnType<typeof officialPayload>;

/** Public match report (statistics shown on the match page after confirmation). */
export function publicReport(sheet: MatchSheet, playerNames: Record<string, string>) {
  return {
    version: sheet.version,
    durationSeconds: sheet.durationSeconds,
    score: sheet.score,
    games: sheet.games.map((g) => ({ label: g.label, durationSeconds: g.durationSeconds, home: g.homeGoals, away: g.awayGoals, homeColor: g.redIs === 'home' ? 'red' : g.redIs === 'away' ? 'blue' : null })),
    teams: sheet.teams,
    thirds: sheet.thirds,
    stadium: sheet.stadium,
    ballHeat: sheet.ballHeat,
    goals: sheet.goals.map((g) => ({ minute: g.minuteSeconds, side: g.side, ownGoal: g.ownGoal, playerId: g.scorerPlayerId, assistPlayerId: g.ownGoal || !g.scorerPlayerId ? null : g.assistPlayerId, ball: g.ball, from: g.shotFrom, unknownAuthor: !g.scorerPlayerId })),
    players: sheet.players.filter((p) => p.side).map((p) => ({
      playerId: p.playerId,
      name: p.playerId ? playerNames[p.playerId] ?? p.names[0] : p.names[0],
      identified: Boolean(p.playerId),
      side: p.side,
      stats: p.stats,
      heat: p.heat,
    })),
    shots: sheet.shots.map((s) => ({ side: s.side, playerId: s.ref.startsWith('nick:') ? null : s.ref, from: s.from, to: s.to, onTarget: s.onTarget })),
    passes: sheet.passes.map((s) => ({ side: s.side, playerId: s.ref.startsWith('nick:') ? null : s.ref, from: s.from, to: s.to })),
  };
}

export type PublicReport = ReturnType<typeof publicReport>;

/** Canonical JSON (sorted keys) used for hashing. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
