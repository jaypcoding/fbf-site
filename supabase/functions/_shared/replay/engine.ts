// Deterministic simulation of a HaxBall room, frame by frame, used to rebuild
// what happened in a recording (positions, kicks, goals). Independent FBF
// implementation of the published game rules and stadium physics. Floating
// point operations keep the game's order so results match the recording.
import {
  TEAM_INFO, cloneDisc, newDisc,
  type Disc, type Game, type Player, type Room, type Stadium, type TeamId,
} from './model.ts';
import type { ReplayEvent } from './format.ts';

export type EngineListener = {
  onGameStart?(room: Room, game: Game): void;
  onTickStart?(room: Room, game: Game): void;
  onKick?(room: Room, game: Game, player: Player, ball: Disc, from: { x: number; y: number }): void;
  onPlayingTick?(room: Room, game: Game): void;
  onGoal?(room: Room, game: Game, scoringTeam: TeamId, ball: Disc): void;
  onKickoffReset?(room: Room, game: Game): void;
  onGameEnd?(room: Room, game: Game, reason: 'limit'): void;
  onGameStop?(room: Room, game: Game, reason: 'stopped' | 'finished'): void;
  onTeamChange?(room: Room, player: Player, team: TeamId): void;
  onPlayerJoin?(room: Room, player: Player): void;
  onPlayerLeave?(room: Room, player: Player): void;
};

const FRAME_TIME = 0.016666666666666666;

function findPlayer(room: Room, id: number): Player | null {
  for (const p of room.players) if (p.id === id) return p;
  return null;
}

/** The host (id 0) and admins may run admin actions. */
function isAdmin(room: Room, id: number): boolean {
  if (id === 0) return true;
  const p = findPlayer(room, id);
  return p != null && p.admin;
}

function removeItem<T>(list: T[], item: T): void {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

function copyDiscInto(src: Disc, dst: Disc): void {
  dst.x = src.x; dst.y = src.y;
  dst.vx = src.vx; dst.vy = src.vy;
  dst.gx = src.gx; dst.gy = src.gy;
  dst.radius = src.radius; dst.bCoef = src.bCoef; dst.invMass = src.invMass; dst.damping = src.damping;
  dst.color = src.color; dst.cMask = src.cMask; dst.cGroup = src.cGroup;
}

export class Engine {
  room: Room;
  listener: EngineListener;

  constructor(room: Room, listener: EngineListener = {}) {
    this.room = room;
    this.listener = listener;
  }

  // ---------------------------------------------------------------- players
  private resetPlayerDisc(game: Game, player: Player): void {
    if (player.team === 0) {
      player.disc = null;
      return;
    }
    player.input = 0;
    let disc = player.disc;
    if (disc == null) {
      disc = newDisc();
      player.disc = disc;
      game.discs.push(disc);
    }
    const pp = game.stadium.playerPhysics;
    disc.color = 0;
    disc.radius = pp.radius;
    disc.invMass = pp.invMass;
    disc.damping = pp.damping;
    disc.bCoef = pp.bCoef;
    disc.cMask = 39;
    disc.cGroup = TEAM_INFO[player.team].cGroup | pp.cGroup;
    const spawns = player.team === 1 ? game.stadium.redSpawn : game.stadium.blueSpawn;
    if (spawns.length === 0) {
      disc.x = TEAM_INFO[player.team].side * game.stadium.width;
      disc.y = 0;
    } else {
      const s = spawns[spawns.length - 1];
      disc.x = s.x;
      disc.y = s.y;
    }
    disc.vx = 0;
    disc.vy = 0;
    disc.gx = pp.gx;
    disc.gy = pp.gy;
  }

  private setTeam(player: Player, team: TeamId): void {
    const room = this.room;
    if (player.team === team) return;
    player.team = team;
    removeItem(room.players, player);
    room.players.push(player);
    const game = room.game;
    if (game) {
      if (player.disc) {
        removeItem(game.discs, player.disc);
        player.disc = null;
      }
      this.resetPlayerDisc(game, player);
      let index = 0;
      for (let free = false; !free;) {
        index++;
        free = true;
        for (const other of room.players) {
          if (other !== player && other.team === player.team && other.spawnIndex === index) { free = false; break; }
        }
      }
      player.spawnIndex = index;
    }
    this.listener.onTeamChange?.(room, player, team);
  }

  private kickoffReset(game: Game): void {
    const room = this.room;
    game.phase = 0;
    const stadiumDiscs = game.stadium.discs;
    const count = game.stadium.fullKickoffReset ? stadiumDiscs.length : 1;
    for (let i = 0; i < count; i++) copyDiscInto(stadiumDiscs[i], game.discs[i]);
    const counts = [0, 0, 0];
    for (const player of room.players) {
      this.resetPlayerDisc(game, player);
      const team = player.team;
      if (team === 0) continue;
      const disc = player.disc!;
      const st = game.stadium;
      let k = counts[team];
      const spawns = team === 1 ? st.redSpawn : st.blueSpawn;
      if (spawns.length === 0) {
        let l = (k + 1) >> 1;
        if ((k & 1) === 0) l = -l;
        disc.x = st.spawnDistance * TEAM_INFO[team].side;
        disc.y = 55 * l;
      } else {
        if (k >= spawns.length) k = spawns.length - 1;
        disc.x = spawns[k].x;
        disc.y = spawns[k].y;
      }
      counts[team]++;
      player.spawnIndex = counts[team];
    }
  }

  private startGame(): void {
    const room = this.room;
    if (room.game) return;
    for (const p of room.players) { p.disc = null; p.spawnIndex = 0; }
    const game: Game = {
      discs: room.stadium.discs.map(cloneDisc),
      pauseTimer: 0, time: 0, red: 0, blue: 0, phase: 0, timer: 0, kickoffTeam: 1,
      scoreLimit: room.scoreLimit, timeLimit: room.timeLimit, stadium: room.stadium,
    };
    room.game = game;
    this.kickoffReset(game);
    this.listener.onGameStart?.(room, game);
  }

  private endGame(reason: 'stopped' | 'finished'): void {
    const room = this.room;
    const game = room.game;
    if (!game) return;
    room.game = null;
    for (const p of room.players) { p.disc = null; p.spawnIndex = 0; }
    this.listener.onGameStop?.(room, game, reason);
  }

  // ---------------------------------------------------------------- actions
  apply(event: ReplayEvent): void {
    const room = this.room;
    const by = event.by;
    const a = event.action;
    switch (a.type) {
      case 'input': {
        const p = findPlayer(room, by);
        if (p) {
          if ((p.input & 16) === 0 && (a.input & 16) !== 0) p.kicking = true;
          p.input = a.input;
        }
        break;
      }
      case 'join':
        if (by === 0) {
          const p: Player = {
            id: a.id, name: a.name ?? 'Player', admin: false, spawnIndex: 0, avatar: a.avatar, headerAvatar: null,
            desynced: false, country: a.country, unknown1: 0, input: 0, kicking: false, kickRateCounter: 0, kickCooldown: 0, team: 0, disc: null,
          };
          room.players.push(p);
          this.listener.onPlayerJoin?.(room, p);
        }
        break;
      case 'kick':
        if (a.id !== 0 && isAdmin(room, by)) {
          const p = findPlayer(room, a.id);
          if (p) {
            removeItem(room.players, p);
            if (room.game && p.disc) removeItem(room.game.discs, p.disc);
            this.listener.onPlayerLeave?.(room, p);
          }
        }
        break;
      case 'startGame':
        if (isAdmin(room, by)) this.startGame();
        break;
      case 'stopGame':
        if (isAdmin(room, by)) this.endGame('stopped');
        break;
      case 'pause': {
        const game = room.game;
        if (game && isAdmin(room, by)) {
          if (a.paused) game.pauseTimer = 120;
          else if (game.pauseTimer === 120) game.pauseTimer = 119;
        }
        break;
      }
      case 'limit':
        if (isAdmin(room, by) && room.game == null) {
          const v = a.value < 0 ? 0 : a.value > 99 ? 99 : a.value;
          if (a.which === 0) room.scoreLimit = v;
          else if (a.which === 1) room.timeLimit = v;
        }
        break;
      case 'stadium':
        if (isAdmin(room, by) && room.game == null) room.stadium = a.stadium;
        break;
      case 'team': {
        const target = findPlayer(room, a.id);
        if (target) {
          const author = findPlayer(room, by);
          const allowed = isAdmin(room, by) || (target === author && !room.teamsLocked && room.game == null);
          if (allowed) this.setTeam(target, a.team);
        }
        break;
      }
      case 'teamsLock':
        if (isAdmin(room, by)) room.teamsLocked = a.value;
        break;
      case 'admin':
        if (isAdmin(room, by)) {
          const target = findPlayer(room, a.id);
          if (target && target.id !== 0 && target.admin !== a.value) target.admin = a.value;
        }
        break;
      case 'autoTeams':
        if (isAdmin(room, by)) {
          const specs: Player[] = [];
          let red = 0, blue = 0;
          for (const p of room.players) {
            if (p.team === 0) specs.push(p);
            if (p.team === 1) red++; else if (p.team === 2) blue++;
          }
          if (specs.length !== 0) {
            if (blue === red) {
              if (specs.length >= 2) { this.setTeam(specs[0], 1); this.setTeam(specs[1], 2); }
            } else this.setTeam(specs[0], blue > red ? 1 : 2);
          }
        }
        break;
      case 'desync': {
        const p = findPlayer(room, by);
        if (p) p.desynced = a.value;
        break;
      }
      case 'avatar': {
        const p = findPlayer(room, by);
        if (p) p.avatar = a.value;
        break;
      }
      case 'headerAvatar': {
        const p = findPlayer(room, a.id);
        if (p && by === 0) p.headerAvatar = a.value;
        break;
      }
      case 'teamColors':
        if (isAdmin(room, by) && a.team !== 0) room.colors[a.team] = a.colors;
        break;
      case 'reorder':
        if (by === 0) {
          const byId = new Map<number, Player>();
          for (const p of room.players) byId.set(p.id, p);
          const listed: Player[] = [];
          for (const id of a.ids) {
            const p = byId.get(id);
            if (p) { byId.delete(id); listed.push(p); }
          }
          const rest = [...byId.values()];
          room.players = a.toTop ? listed.concat(rest) : rest.concat(listed);
        }
        break;
      case 'kickRate':
        if (isAdmin(room, by)) {
          room.kickRateMin = a.min < 0 ? 0 : a.min > 255 ? 255 : a.min;
          room.kickRateRate = a.rate < 0 ? 0 : a.rate > 255 ? 255 : a.rate;
          const burst = a.burst < 0 ? 0 : a.burst > 100 ? 100 : a.burst;
          room.kickRateMax = room.kickRateRate * burst;
        }
        break;
      case 'pings':
        break;
      case 'discProps': {
        const game = room.game;
        if (by === 0 && game) {
          let disc: Disc | null | undefined;
          if (a.isPlayer) {
            const p = findPlayer(room, a.id);
            if (!p) break;
            disc = p.disc;
          } else disc = game.discs[a.id];
          if (disc) {
            const f = a.floats;
            if (f[0] != null) disc.x = f[0];
            if (f[1] != null) disc.y = f[1];
            if (f[2] != null) disc.vx = f[2];
            if (f[3] != null) disc.vy = f[3];
            if (f[4] != null) disc.gx = f[4];
            if (f[5] != null) disc.gy = f[5];
            if (f[6] != null) disc.radius = f[6];
            if (f[7] != null) disc.bCoef = f[7];
            if (f[8] != null) disc.invMass = f[8];
            if (f[9] != null) disc.damping = f[9];
            const n = a.ints;
            if (n[0] != null) disc.color = n[0];
            if (n[1] != null) disc.cMask = n[1];
            if (n[2] != null) disc.cGroup = n[2];
          }
        }
        break;
      }
      default:
        break; // chat, announcements, checksums and indicators do not change the game
    }
  }

  // ---------------------------------------------------------------- physics
  tick(): void {
    const game = this.room.game;
    if (game) this.stepGame(game);
  }

  private stepGame(game: Game): void {
    const room = this.room;
    if (game.pauseTimer > 0) {
      if (game.pauseTimer < 120) game.pauseTimer--;
      return;
    }
    this.listener.onTickStart?.(room, game);
    const players = room.players;
    const pp = game.stadium.playerPhysics;
    for (const player of players) {
      const pd = player.disc;
      if (pd == null) continue;
      if ((player.input & 16) === 0) player.kicking = false;
      if (player.kickCooldown > 0) player.kickCooldown--;
      if (player.kickRateCounter < room.kickRateMax) player.kickRateCounter++;
      if (player.kicking && player.kickCooldown <= 0 && player.kickRateCounter >= 0) {
        let kicked = false;
        for (const d of game.discs) {
          if ((d.cGroup & 64) === 0 || d === pd) continue;
          const dx = d.x - pd.x;
          const dy = d.y - pd.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist - d.radius - pd.radius < 4) {
            const from = { x: d.x, y: d.y };
            const nx = dx / dist;
            const ny = dy / dist;
            const ks = pp.kickStrength;
            d.vx = d.vx + nx * ks * d.invMass;
            d.vy = d.vy + ny * ks * d.invMass;
            const kb = -pp.kickback;
            pd.vx = pd.vx + nx * kb * pd.invMass;
            pd.vy = pd.vy + ny * kb * pd.invMass;
            this.listener.onKick?.(room, game, player, d, from);
            kicked = true;
          }
        }
        if (kicked) {
          player.kicking = false;
          player.kickCooldown = room.kickRateMin;
          player.kickRateCounter -= room.kickRateRate;
        }
      }
      const input = player.input;
      let mx = 0, my = 0;
      if (input & 1) my--;
      if (input & 2) my++;
      if (input & 4) mx--;
      if (input & 8) mx++;
      if (mx !== 0 && my !== 0) {
        const len = Math.sqrt(mx * mx + my * my);
        mx /= len;
        my /= len;
      }
      const acc = player.kicking ? pp.kickingAcceleration : pp.acceleration;
      pd.vx += mx * acc;
      pd.vy += my * acc;
      pd.damping = player.kicking ? pp.kickingDamping : pp.damping;
    }
    // positions of scoring discs before the step (goal line crossing)
    const scoring: number[] = [];
    const oldX: number[] = [];
    const oldY: number[] = [];
    for (let i = 0; i < game.discs.length; i++) {
      const d = game.discs[i];
      if ((d.cGroup & 128) !== 0) { scoring.push(i); oldX.push(d.x); oldY.push(d.y); }
    }
    stepWorld(game.discs, game.stadium);

    if (game.phase === 0) {
      const mask = 39 | TEAM_INFO[game.kickoffTeam].kickoffMask;
      for (const p of players) if (p.disc) p.disc.cMask = mask;
      const ball = game.discs[0];
      if (ball.vx * ball.vx + ball.vy * ball.vy > 0) game.phase = 1;
    } else if (game.phase === 1) {
      game.time += FRAME_TIME;
      this.listener.onPlayingTick?.(room, game);
      for (const p of players) if (p.disc) p.disc.cMask = 39;
      let goalTeam: TeamId = 0;
      for (let i = 0; i < scoring.length; i++) {
        const d = game.discs[scoring[i]];
        goalTeam = goalCrossed(game.stadium, d.x, d.y, oldX[i], oldY[i]);
        if (goalTeam !== 0) break;
      }
      if (goalTeam !== 0) {
        game.phase = 2;
        game.timer = 150;
        game.kickoffTeam = goalTeam;
        if (goalTeam === 1) game.blue++; else game.red++;
        const scoringTeam: TeamId = goalTeam === 1 ? 2 : 1;
        this.listener.onGoal?.(room, game, scoringTeam, game.discs[0]);
      } else if (game.timeLimit > 0 && game.time >= 60 * game.timeLimit && game.red !== game.blue) {
        this.finish(game);
      }
    } else if (game.phase === 2) {
      game.timer--;
      if (game.timer <= 0) {
        if ((game.scoreLimit > 0 && (game.red >= game.scoreLimit || game.blue >= game.scoreLimit))
          || (game.timeLimit > 0 && game.time >= 60 * game.timeLimit && game.red !== game.blue)) {
          this.finish(game);
        } else {
          this.kickoffReset(game);
          this.listener.onKickoffReset?.(room, game);
        }
      }
    } else if (game.phase === 3) {
      game.timer--;
      if (game.timer <= 0 && room.game != null) this.endGame('finished');
    }
  }

  private finish(game: Game): void {
    game.timer = 300;
    game.phase = 3;
    this.listener.onGameEnd?.(this.room, game, 'limit');
  }
}

/** Team whose goal the segment (x,y)→(px,py) crossed, or 0. */
export function goalCrossed(st: Stadium, x: number, y: number, px: number, py: number): TeamId {
  for (const g of st.goals) {
    const kx = px - x;
    const ky = py - y;
    if ((0 < -(g.y0 - y) * kx + (g.x0 - x) * ky) === (0 < -(g.y1 - y) * kx + (g.x1 - x) * ky)) continue;
    const ex = g.x1 - g.x0;
    const ey = g.y1 - g.y0;
    if ((0 < -(y - g.y0) * ex + (x - g.x0) * ey) === (0 < -(py - g.y0) * ex + (px - g.x0) * ey)) continue;
    return g.team;
  }
  return 0;
}

function collideDiscs(c: Disc, f: Disc): void {
  let dx = c.x - f.x;
  let dy = c.y - f.y;
  let e = f.radius + c.radius;
  let dist = dx * dx + dy * dy;
  if (0 < dist && dist <= e * e) {
    dist = Math.sqrt(dist);
    dx = dx / dist;
    dy = dy / dist;
    let ratio = c.invMass / (c.invMass + f.invMass);
    e = e - dist;
    let push = e * ratio;
    c.x = c.x + dx * push;
    c.y = c.y + dy * push;
    e -= push;
    f.x = f.x - dx * e;
    f.y = f.y - dy * e;
    let rel = dx * (c.vx - f.vx) + dy * (c.vy - f.vy);
    if (0 > rel) {
      rel *= c.bCoef * f.bCoef + 1;
      ratio *= rel;
      c.vx = c.vx - dx * ratio;
      c.vy = c.vy - dy * ratio;
      push = rel - ratio;
      f.vx = f.vx + dx * push;
      f.vy = f.vy + dy * push;
    }
  }
}

function collideSegment(c: Disc, s: Stadium['segments'][number]): void {
  let nx: number, ny: number, d: number;
  if (!Number.isFinite(s.curveF)) {
    const bx = s.v0.x, by = s.v0.y;
    const ex = s.v1.x, ey = s.v1.y;
    const sx = ex - bx;
    const sy = ey - by;
    const px = c.x - ex;
    const py = c.y - ey;
    if (0 >= (c.x - bx) * sx + (c.y - by) * sy || 0 <= px * sx + py * sy) return;
    nx = s.nx;
    ny = s.ny;
    d = nx * px + ny * py;
  } else {
    const bx = c.x - s.cx;
    const by = c.y - s.cy;
    if ((0 < s.t0x * bx + s.t0y * by && 0 < s.t1x * bx + s.t1y * by) === (0 >= s.curveF)) return;
    const len = Math.sqrt(bx * bx + by * by);
    if (0 === len) return;
    d = len - s.r;
    nx = bx / len;
    ny = by / len;
  }
  let bias = s.bias;
  if (0 === bias) {
    if (0 > d) { d = -d; nx = -nx; ny = -ny; }
  } else {
    if (0 > bias) { bias = -bias; d = -d; nx = -nx; ny = -ny; }
    if (d < -bias) return;
  }
  if (d >= c.radius) return;
  d = c.radius - d;
  c.x = c.x + nx * d;
  c.y = c.y + ny * d;
  let v = nx * c.vx + ny * c.vy;
  if (0 > v) {
    v *= c.bCoef * s.bCoef + 1;
    c.vx = c.vx - nx * v;
    c.vy = c.vy - ny * v;
  }
}

export function stepWorld(discs: Disc[], st: Stadium): void {
  for (const d of discs) {
    d.x = d.x + d.vx * 1;
    d.y = d.y + d.vy * 1;
    d.vx = (d.vx + d.gx) * d.damping;
    d.vy = (d.vy + d.gy) * d.damping;
  }
  const n = discs.length;
  for (let i = 0; i < n; i++) {
    const c = discs[i];
    for (let j = i + 1; j < n; j++) {
      const f = discs[j];
      if ((f.cMask & c.cGroup) !== 0 && (f.cGroup & c.cMask) !== 0) collideDiscs(c, f);
    }
    if (c.invMass !== 0) {
      for (const p of st.planes) {
        if ((p.cMask & c.cGroup) === 0 || (p.cGroup & c.cMask) === 0) continue;
        let g = p.dist - (p.nx * c.x + p.ny * c.y) + c.radius;
        if (0 < g) {
          c.x = c.x + p.nx * g;
          c.y = c.y + p.ny * g;
          g = c.vx * p.nx + c.vy * p.ny;
          if (0 > g) {
            g *= c.bCoef * p.bCoef + 1;
            c.vx = c.vx - p.nx * g;
            c.vy = c.vy - p.ny * g;
          }
        }
      }
      for (const s of st.segments) {
        if ((s.cMask & c.cGroup) !== 0 && (s.cGroup & c.cMask) !== 0) collideSegment(c, s);
      }
      for (const v of st.vertexes) {
        if ((v.cMask & c.cGroup) === 0 || (v.cGroup & c.cMask) === 0) continue;
        let gx = c.x - v.x;
        let gy = c.y - v.y;
        let l = gx * gx + gy * gy;
        if (0 < l && l <= c.radius * c.radius) {
          l = Math.sqrt(l);
          gx = gx / l;
          gy = gy / l;
          l = c.radius - l;
          c.x = c.x + gx * l;
          c.y = c.y + gy * l;
          l = gx * c.vx + gy * c.vy;
          if (0 > l) {
            l *= c.bCoef * v.bCoef + 1;
            c.vx = c.vx - gx * l;
            c.vy = c.vy - gy * l;
          }
        }
      }
    }
  }
  for (let iter = 0; iter < 2; iter++) {
    for (const j of st.joints) stepJoint(j, discs);
  }
}

function stepJoint(j: Stadium['joints'][number], discs: Disc[]): void {
  const b = discs[j.d0];
  const a = discs[j.d1];
  if (b == null || a == null) return;
  let ex = b.x - a.x;
  let ey = b.y - a.y;
  let f = Math.sqrt(ex * ex + ey * ey);
  if (0 >= f) return;
  ex /= f;
  ey /= f;
  let d = b.invMass / (b.invMass + a.invMass);
  if (d !== d) d = 0.5;
  let g: number, k: number;
  if (j.min >= j.max) { g = j.min; k = 0; }
  else if (f <= j.min) { g = j.min; k = 1; }
  else if (f >= j.max) { g = j.max; k = -1; }
  else return;
  f = g - f;
  if (Number.isFinite(j.strength)) {
    d = j.strength * f * 0.5;
    ex *= d;
    ey *= d;
    b.vx = b.vx + ex * b.invMass;
    b.vy = b.vy + ey * b.invMass;
    a.vx = a.vx + -ex * a.invMass;
    a.vy = a.vy + -ey * a.invMass;
  } else {
    g = f * d;
    b.x = b.x + ex * g * 0.5;
    b.y = b.y + ey * g * 0.5;
    f -= g;
    a.x = a.x - ex * f * 0.5;
    a.y = a.y - ey * f * 0.5;
    f = ex * (b.vx - a.vx) + ey * (b.vy - a.vy);
    if (0 >= f * k) {
      d *= f;
      b.vx = b.vx - ex * d;
      b.vy = b.vy - ey * d;
      d = f - d;
      a.vx = a.vx + ex * d;
      a.vy = a.vy + ey * d;
    }
  }
}

/** Runs the whole recording through the engine. */
export function runReplay(room: Room, events: ReplayEvent[], totalFrames: number, listener: EngineListener, onFrame?: (frame: number) => void): Engine {
  const engine = new Engine(room, listener);
  let next = 0;
  for (let frame = 0; frame < totalFrames; frame++) {
    while (next < events.length && events[next].frame === frame) engine.apply(events[next++]);
    // events stamped before the current frame never happen in valid files; skip them defensively
    while (next < events.length && events[next].frame < frame) next++;
    engine.tick();
    onFrame?.(frame + 1);
  }
  return engine;
}
