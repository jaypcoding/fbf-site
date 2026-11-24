// Mapa tático dos clubes: pure helpers (no database access).
// The tactical map is the presentation of a club's squad in one season: up to
// three starters placed freely on a court (positions stored as fractions of
// the court, so they never break between screen sizes) and the bench. It is
// NOT a match lineup and never feeds statistics.

export type CourtRole = string; // 1–4 letters/digits; GK, VL and PV by default
export type Starter = { player_id: string; role: CourtRole; x: number; y: number };
export type Formation = { starters: Starter[]; bench: string[] };
export type RosterPlayer = { player_id: string; nickname: string; position: string | null; shirt_number: number | null };

export const MAX_STARTERS = 3;
/** court limits for a player's center (fractions of width/height) */
export const MIN_POS = 0.06;
export const MAX_POS = 0.94;
export const DEFAULT_ROLES: { role: CourtRole; label: string }[] = [
  { role: 'GK', label: 'Goleiro' },
  { role: 'VL', label: 'Volante' },
  { role: 'PV', label: 'Pivô' },
];
/** default spots, attacking up: goalkeeper near our goal, volante in midfield, pivô forward */
const DEFAULT_SPOT: Record<string, { x: number; y: number }> = { GK: { x: 0.5, y: 0.86 }, VL: { x: 0.34, y: 0.56 }, PV: { x: 0.64, y: 0.26 } };

export const clamp = (v: number) => Math.min(MAX_POS, Math.max(MIN_POS, Math.round(v * 10000) / 10000));

export function roleFromPosition(position: string | null): CourtRole {
  const p = (position ?? '').toLowerCase();
  if (p.startsWith('gol')) return 'GK';
  if (p.startsWith('vol') || p.startsWith('fix') || p.startsWith('def')) return 'VL';
  if (p.startsWith('piv') || p.startsWith('ata') || p.startsWith('ala')) return 'PV';
  return 'PV';
}

export function normalizeRole(role: string): CourtRole | null {
  const r = role.trim().toUpperCase();
  return /^[A-Z0-9]{1,4}$/.test(r) ? r : null;
}

export function spotFor(role: CourtRole, taken: { x: number; y: number }[]): { x: number; y: number } {
  const base = DEFAULT_SPOT[role] ?? { x: 0.5, y: 0.5 };
  // nudge sideways if another starter already sits there
  let spot = { ...base };
  for (let i = 0; i < 6 && taken.some((t) => Math.abs(t.x - spot.x) < 0.12 && Math.abs(t.y - spot.y) < 0.08); i++) {
    spot = { x: clamp(base.x + (i % 2 ? -1 : 1) * 0.16 * Math.ceil((i + 1) / 2)), y: base.y };
  }
  return spot;
}

/**
 * The formation to show for a roster. A saved formation is kept as saved,
 * minus players no longer in the roster; roster players not placed yet go to
 * the end of the bench. Without a saved formation nobody is invented: the
 * court starts empty and the whole roster is on the bench.
 */
export function resolveFormation(saved: Formation | null, roster: RosterPlayer[]): Formation {
  const inRoster = new Set(roster.map((r) => r.player_id));
  const starters = (saved?.starters ?? []).filter((s) => inRoster.has(s.player_id)).slice(0, MAX_STARTERS)
    .map((s) => ({ ...s, x: clamp(Number(s.x)), y: clamp(Number(s.y)) }));
  const used = new Set(starters.map((s) => s.player_id));
  const bench: string[] = [];
  for (const id of saved?.bench ?? []) if (inRoster.has(id) && !used.has(id) && !bench.includes(id)) bench.push(id);
  for (const r of roster) if (!used.has(r.player_id) && !bench.includes(r.player_id)) bench.push(r.player_id);
  return { starters, bench };
}

/** A suggestion the editor offers (never saved by itself): one goalkeeper, one volante, one pivô by registered position. */
export function suggestStarters(roster: RosterPlayer[]): Formation {
  const picked: Starter[] = [];
  const free = (r: RosterPlayer) => !picked.some((s) => s.player_id === r.player_id);
  // first, each role with a player registered in that position
  for (const { role } of DEFAULT_ROLES) {
    const p = roster.find((r) => free(r) && roleFromPosition(r.position) === role);
    if (p) picked.push({ player_id: p.player_id, role, ...spotFor(role, picked) });
  }
  // then the roles still open, with whoever is left (keeping his own role when it is still free)
  for (const r of roster) {
    if (picked.length >= MAX_STARTERS || !free(r)) continue;
    const own = roleFromPosition(r.position);
    const role = picked.some((s) => s.role === own) ? DEFAULT_ROLES.map((d) => d.role).find((x) => !picked.some((s) => s.role === x)) ?? own : own;
    picked.push({ player_id: r.player_id, role, ...spotFor(role, picked) });
  }
  picked.sort((a, b) => DEFAULT_ROLES.findIndex((d) => d.role === a.role) - DEFAULT_ROLES.findIndex((d) => d.role === b.role));
  return { starters: picked, bench: roster.map((r) => r.player_id).filter((id) => !picked.some((s) => s.player_id === id)) };
}

// ---- edits (all return a new formation; a player is never in two places)
export function promote(f: Formation, playerId: string, at?: { x: number; y: number }, role?: CourtRole): Formation | null {
  if (f.starters.length >= MAX_STARTERS || f.starters.some((s) => s.player_id === playerId)) return null;
  const freeRole = role ?? DEFAULT_ROLES.map((d) => d.role).find((r) => !f.starters.some((s) => s.role === r)) ?? 'PV';
  const spot = at ? { x: clamp(at.x), y: clamp(at.y) } : spotFor(freeRole, f.starters);
  return { starters: [...f.starters, { player_id: playerId, role: freeRole, ...spot }], bench: f.bench.filter((id) => id !== playerId) };
}
export function demote(f: Formation, playerId: string, index?: number): Formation {
  if (!f.starters.some((s) => s.player_id === playerId)) return f;
  const bench = f.bench.filter((id) => id !== playerId);
  bench.splice(index ?? bench.length, 0, playerId);
  return { starters: f.starters.filter((s) => s.player_id !== playerId), bench };
}
/** a reserve takes the place (and role) of a starter, who goes to the reserve's spot on the bench */
export function swap(f: Formation, starterId: string, reserveId: string): Formation {
  const s = f.starters.find((x) => x.player_id === starterId);
  const benchIndex = f.bench.indexOf(reserveId);
  if (!s || benchIndex < 0) return f;
  const bench = [...f.bench];
  bench[benchIndex] = starterId;
  return { starters: f.starters.map((x) => (x.player_id === starterId ? { ...x, player_id: reserveId } : x)), bench };
}
export function move(f: Formation, playerId: string, x: number, y: number): Formation {
  return { ...f, starters: f.starters.map((s) => (s.player_id === playerId ? { ...s, x: clamp(x), y: clamp(y) } : s)) };
}
export function setRole(f: Formation, playerId: string, role: CourtRole): Formation {
  return { ...f, starters: f.starters.map((s) => (s.player_id === playerId ? { ...s, role } : s)) };
}
export function reorderBench(f: Formation, playerId: string, delta: number): Formation {
  const i = f.bench.indexOf(playerId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= f.bench.length) return f;
  const bench = [...f.bench];
  [bench[i], bench[j]] = [bench[j], bench[i]];
  return { ...f, bench };
}
export const sameFormation = (a: Formation, b: Formation) => JSON.stringify(a) === JSON.stringify(b);

// ---- avatars
export type AvatarSymbol = 'initial' | 'number' | 'ball' | 'glove' | 'star' | 'shield' | 'crown' | 'bolt' | 'flame' | 'target';
export type AvatarStyle = 'solid' | 'ring' | 'split';
export type AvatarConfig = { background: string; border: string; symbol: AvatarSymbol; label: string; show_number: boolean; style: AvatarStyle };
export const AVATAR_SYMBOLS: { value: AvatarSymbol; label: string }[] = [
  { value: 'initial', label: 'Inicial' }, { value: 'number', label: 'Número' }, { value: 'ball', label: 'Bola' },
  { value: 'glove', label: 'Luva' }, { value: 'star', label: 'Estrela' }, { value: 'shield', label: 'Escudo' },
  { value: 'crown', label: 'Coroa' }, { value: 'bolt', label: 'Raio' }, { value: 'flame', label: 'Chama' }, { value: 'target', label: 'Alvo' },
];
export const AVATAR_STYLES: { value: AvatarStyle; label: string }[] = [
  { value: 'solid', label: 'Sólido' }, { value: 'ring', label: 'Anel' }, { value: 'split', label: 'Dividido' },
];
/** palette in the FBF identity (amber/orange family plus contrasting club colors) */
export const AVATAR_COLORS = ['#c2560f', '#f2a35e', '#ffd166', '#f3ebe0', '#2e2219', '#111111', '#1f7a3a', '#0a7ea4', '#3a5bd9', '#7b3fbf', '#b42318', '#ffffff'];
const DEFAULT_COLORS = ['#c2560f', '#2e2219', '#0a7ea4', '#1f7a3a', '#7b3fbf', '#b42318'];

export function initials(nickname: string): string {
  const clean = nickname.replace(/[^\p{L}\p{N} ]/gu, '').trim();
  if (!clean) return '?';
  const parts = clean.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 2)).toUpperCase();
}

export function defaultAvatar(player: Pick<RosterPlayer, 'player_id' | 'nickname' | 'position'>): AvatarConfig {
  let h = 0;
  for (const c of player.player_id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return {
    background: DEFAULT_COLORS[h % DEFAULT_COLORS.length], border: '#f3ebe0',
    symbol: roleFromPosition(player.position) === 'GK' ? 'glove' : 'initial', label: initials(player.nickname), show_number: true, style: 'solid',
  };
}

/** readable text color on a background (WCAG relative luminance) */
export function inkOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  return L > 0.4 ? '#1d1712' : '#ffffff';
}
