// Built-in HaxBall stadiums (Classic, Easy, Small, Big, Rounded, Hockey...),
// referenced by index in recordings instead of being stored in the file.
// Geometry follows the published stadium definitions of the game.
import {
  defaultPlayerPhysics, newDisc, newSegment, prepareSegment, setCurve,
  type Disc, type Plane, type Segment, type Stadium, type TeamId, type Vertex,
} from './model.ts';

function vertex(x: number, y: number, cMask = 63, cGroup = 32, bCoef = 1): Vertex {
  return { x, y, cMask, cGroup, bCoef };
}

function plane(nx: number, ny: number, dist: number, bCoef = 1, cMask = 63): Plane {
  return { nx, ny, dist, bCoef, cMask, cGroup: 32 };
}

function ballDisc(): Disc {
  const d = newDisc();
  d.color = 16777215; d.cMask = 63; d.cGroup = 193; d.radius = 10; d.damping = 0.99; d.invMass = 1; d.bCoef = 0.5;
  return d;
}

type Builder = { st: Stadium };

function empty(name: string, width: number, height: number): Stadium {
  return {
    name, defaultIndex: 0, bgType: 1, bgWidth: 0, bgHeight: 0, kickOffRadius: 0, cornerRadius: 0, bgColor: 7441498, goalLine: 0,
    width, height, spawnDistance: 0, playerPhysics: defaultPlayerPhysics(), maxViewWidth: 0, cameraFollow: 0, canBeStored: true, fullKickoffReset: false,
    vertexes: [], segments: [], planes: [], goals: [], discs: [ballDisc()], joints: [], redSpawn: [], blueSpawn: [],
  };
}

function seg(b: Builder, v0: Vertex, v1: Vertex): Segment {
  return newSegment(v0, v1, b.st.vertexes.indexOf(v0), b.st.vertexes.indexOf(v1));
}

// Goal posts and net of one side.
function goalSide(b: Builder, x: number, dir: number, goalY: number, color: number, team: TeamId, cMask = 1, cGroup = 32): void {
  const st = b.st;
  const top = vertex(x + 8 * dir, -goalY);
  const bottom = vertex(x + 8 * dir, goalY);
  const backTop = vertex(top.x + 22 * dir, top.y + 22);
  const backBottom = vertex(bottom.x + 22 * dir, bottom.y - 22);
  const start = st.vertexes.length;
  st.vertexes.push(top, bottom, backTop, backBottom);
  for (let i = start; i < st.vertexes.length; i++) { st.vertexes[i].cMask = cMask; st.vertexes[i].cGroup = cGroup; st.vertexes[i].bCoef = 0.1; }
  const s1 = seg(b, top, backTop); setCurve(s1, 90 * dir);
  const s2 = seg(b, backBottom, backTop);
  const s3 = seg(b, backBottom, bottom); setCurve(s3, 90 * dir);
  const segStart = st.segments.length;
  st.segments.push(s1, s2, s3);
  for (let i = segStart; i < st.segments.length; i++) { st.segments[i].cMask = cMask; st.segments[i].cGroup = cGroup; st.segments[i].bCoef = 0.1; }
  for (const y of [-goalY, goalY]) {
    const post = newDisc();
    post.x = x; post.y = y; post.invMass = 0; post.radius = 8; post.color = color;
    st.discs.push(post);
  }
  st.goals.push({ x0: x, y0: -goalY, x1: x, y1: goalY, team });
}

// Kickoff barrier (centre line and circle).
function kickoffBarrier(b: Builder, radius: number, height: number): void {
  const st = b.st;
  const mk = (y: number) => vertex(0, y, 6, 24, 0.1);
  const a = mk(-height), c = mk(-radius), d = mk(radius), e = mk(height);
  st.vertexes.push(a, c, d, e);
  const g = seg(b, a, c); g.cGroup = 24; g.cMask = 6; g.vis = false; g.bCoef = 0.1;
  const k = seg(b, d, e); k.cGroup = 24; k.cMask = 6; k.vis = false; k.bCoef = 0.1;
  const l = seg(b, c, d); l.cGroup = 8; l.cMask = 6; l.vis = false; setCurve(l, 180); l.bCoef = 0.1;
  const h = seg(b, d, c); h.cGroup = 16; h.cMask = 6; h.vis = false; setCurve(h, 180); h.bCoef = 0.1;
  st.segments.push(g, k, l, h);
}

// Rounded corners of the field.
function corners(b: Builder, w: number, h: number, r: number): void {
  if (r <= 0) return;
  const st = b.st;
  const v = (x: number, y: number) => vertex(x, y, 0);
  const d = v(-w + r, -h), e = v(-w, -h + r), f = v(-w + r, h), g = v(-w, h - r);
  const k = v(w - r, h), l = v(w, h - r), hh = v(w - r, -h), m = v(w, -h + r);
  st.vertexes.push(d, e, f, g, k, l, hh, m);
  const mkSeg = (a: Vertex, c: Vertex, curve: number) => { const s = seg(b, a, c); s.cMask = 1; s.vis = false; s.bCoef = 1; setCurve(s, curve); return s; };
  st.segments.push(mkSeg(d, e, -90), mkSeg(f, g, 90), mkSeg(k, l, -90), mkSeg(hh, m, 90));
}

function classicLike(name: string, width: number, height: number, bgWidth: number, bgHeight: number, goalY: number, kickOff: number, corner = 0): Stadium {
  const st = empty(name, width, height);
  const b: Builder = { st };
  st.bgType = 1; st.bgWidth = bgWidth; st.bgHeight = bgHeight; st.kickOffRadius = kickOff; st.cornerRadius = corner;
  st.spawnDistance = Math.min(0.75 * bgWidth, 400);
  st.planes.push(plane(0, 1, -height, 0), plane(0, -1, -height, 0), plane(1, 0, -width, 0), plane(-1, 0, -width, 0));
  goalSide(b, bgWidth, 1, goalY, 13421823, 2);
  goalSide(b, -bgWidth, -1, goalY, 16764108, 1);
  kickoffBarrier(b, kickOff, height);
  st.planes.push(plane(0, 1, -bgHeight, 1, 1), plane(0, -1, -bgHeight, 1, 1));
  const v = (x: number, y: number) => vertex(x, y, 0);
  const p1 = v(-bgWidth, -bgHeight), p2 = v(bgWidth, -bgHeight), p3 = v(bgWidth, -goalY), p4 = v(bgWidth, goalY);
  const p5 = v(bgWidth, bgHeight), p6 = v(-bgWidth, bgHeight), p7 = v(-bgWidth, goalY), p8 = v(-bgWidth, -goalY);
  st.vertexes.push(p1, p2, p3, p4, p5, p6, p7, p8);
  for (const [a, c] of [[p2, p3], [p4, p5], [p6, p7], [p8, p1]] as const) { const s = seg(b, a, c); s.cMask = 1; s.vis = false; st.segments.push(s); }
  corners(b, bgWidth, bgHeight, corner);
  for (const s of st.segments) prepareSegment(s);
  return st;
}

function hockeyLike(name: string, width: number, height: number, bgWidth: number, bgHeight: number, goalY: number, goalLine: number, kickOff: number, corner: number): Stadium {
  const st = empty(name, width, height);
  const b: Builder = { st };
  st.bgType = 2; st.bgWidth = bgWidth; st.bgHeight = bgHeight; st.kickOffRadius = kickOff; st.cornerRadius = corner; st.goalLine = goalLine;
  st.spawnDistance = Math.min(0.75 * (bgWidth - goalLine), 400);
  st.planes.push(plane(0, 1, -height, 0), plane(0, -1, -height, 0), plane(1, 0, -width, 0), plane(-1, 0, -width, 0));
  goalSide(b, bgWidth - goalLine, 1, goalY, 13421823, 2, 63);
  goalSide(b, -bgWidth + goalLine, -1, goalY, 16764108, 1, 63);
  kickoffBarrier(b, kickOff, height);
  st.planes.push(plane(0, 1, -bgHeight, 1, 1), plane(0, -1, -bgHeight, 1, 1), plane(1, 0, -bgWidth, 1, 1), plane(-1, 0, -bgWidth, 1, 1));
  corners(b, bgWidth, bgHeight, corner);
  for (const s of st.segments) prepareSegment(s);
  return st;
}

let cache: Stadium[] | null = null;

function all(): Stadium[] {
  if (!cache) {
    cache = [
      classicLike('Classic', 420, 200, 370, 170, 64, 75),
      classicLike('Easy', 420, 200, 370, 170, 90, 75),
      classicLike('Small', 420, 200, 320, 130, 55, 70),
      classicLike('Big', 600, 270, 550, 240, 80, 80),
      classicLike('Rounded', 420, 200, 370, 170, 64, 75, 75),
      hockeyLike('Hockey', 420, 204, 398, 182, 68, 120, 75, 100),
      hockeyLike('Big Hockey', 600, 270, 550, 240, 90, 160, 75, 150),
      classicLike('Big Easy', 600, 270, 550, 240, 95, 80),
      classicLike('Big Rounded', 600, 270, 550, 240, 80, 75, 100),
      classicLike('Huge', 750, 350, 700, 320, 100, 80),
    ];
    cache.forEach((s, i) => { s.defaultIndex = i; });
  }
  return cache;
}

export function builtInStadium(index: number): Stadium | null {
  return all()[index] ?? null;
}
