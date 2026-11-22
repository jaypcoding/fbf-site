// Builds small synthetic .hbr2 recordings for automated tests (no real
// players or chat involved). Uses a built-in stadium (Classic by default).
import { deflateRawSync } from 'node:zlib';

class Writer {
  constructor() { this.bytes = []; }
  u8(v) { this.bytes.push(v & 255); }
  bool(v) { this.u8(v ? 1 : 0); }
  i8(v) { this.u8(v < 0 ? 256 + v : v); }
  u16(v) { this.u8(v >> 8); this.u8(v); }
  i16(v) { this.u16(v < 0 ? 65536 + v : v); }
  u32(v) { this.u8(v >>> 24); this.u8(v >>> 16); this.u8(v >>> 8); this.u8(v); }
  i32(v) { this.u32(v >>> 0); }
  varint(v) {
    v >>>= 0;
    do { let b = v & 127; v >>>= 7; if (v) b |= 128; this.u8(b); } while (v);
  }
  raw(s) { for (const b of Buffer.from(s, 'utf8')) this.u8(b); }
  nstr(s) { if (s == null) this.varint(0); else { this.varint(Buffer.byteLength(s) + 1); this.raw(s); } }
  str(s) { this.varint(Buffer.byteLength(s)); this.raw(s); }
  out() { return Buffer.from(this.bytes); }
}

const TEAM = { spec: 0, red: 1, blue: 2 };

/** Encodes an action payload (type number + bytes) as the game does. */
export const action = {
  join: (id, name) => ({ type: 5, write: (w) => { w.i32(id); w.nstr(name); w.nstr('br'); w.nstr(null); } }),
  team: (id, team) => ({ type: 12, write: (w) => { w.i32(id); w.i8(TEAM[team]); } }),
  start: () => ({ type: 7, write: () => {} }),
  stop: () => ({ type: 8, write: () => {} }),
  input: (bits) => ({ type: 3, write: (w) => w.u32(bits) }),
  limit: (which, value) => ({ type: 10, write: (w) => { w.i32(which); w.i32(value); } }),
  chat: (text) => ({ type: 4, write: (w) => w.str(text) }),
};
export const INPUT = { up: 1, down: 2, left: 4, right: 8, kick: 16 };

/**
 * events: [{ frame, by, action }] (by 0 = host). The room starts empty, with
 * the given built-in stadium, score/time limits and no game in progress.
 */
export function buildReplay({ totalFrames, events, stadiumIndex = 0, scoreLimit = 3, timeLimit = 3, version = 3, roomName = 'Sala de teste' }) {
  const body = new Writer();
  body.u16(0); // timeline markers
  // room state
  body.nstr(roomName);
  body.bool(false); // teams lock
  body.i32(scoreLimit);
  body.i32(timeLimit);
  body.i16(600); // kick rate max
  body.u8(2); // kick rate rate
  body.u8(0); // kick rate min
  body.u8(stadiumIndex);
  body.bool(false); // no game in progress
  body.u8(0); // players
  for (let t = 0; t < 2; t++) { body.u8(0); body.i32(0xffffff); body.u8(1); body.i32(t ? 0x0000ff : 0xff0000); }
  // actions
  let last = 0;
  for (const e of [...events].sort((a, b) => a.frame - b.frame)) {
    body.varint(e.frame - last);
    last = e.frame;
    body.u16(e.by ?? 0);
    body.u8(e.action.type);
    e.action.write(body);
  }
  const compressed = deflateRawSync(body.out());
  const head = new Writer();
  head.raw('HBR2');
  head.u32(version);
  head.u32(totalFrames);
  return new Uint8Array(Buffer.concat([head.out(), compressed]));
}

/**
 * A short game on the Classic stadium: "Atacante" (red) runs to the ball and
 * kicks it straight into the blue goal while "Defensor" (blue) moves away.
 */
export function goalScenario({ stopAt = 900, totalFrames = 1000 } = {}) {
  return buildReplay({
    totalFrames,
    events: [
      { frame: 0, action: action.join(1, 'Atacante') },
      { frame: 0, action: action.join(2, 'Defensor') },
      { frame: 0, action: action.team(1, 'red') },
      { frame: 0, action: action.team(2, 'blue') },
      { frame: 1, action: action.start() },
      { frame: 2, by: 1, action: action.input(INPUT.right | INPUT.kick) },
      { frame: 2, by: 2, action: action.input(INPUT.up) },
      { frame: stopAt, action: action.stop() },
    ],
  });
}
