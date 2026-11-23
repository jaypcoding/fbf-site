// MVP historical simulation (Phase 4a). Runs the proposed formula and weight
// variations over:
//   (A) official finished matches (JSON from official_matches.sql, read only);
//   (B) a local corpus of real .hbr2 recordings (full participation).
// Writes a markdown report. Nothing is written to any database.
//
//   node --experimental-strip-types scripts/mvp/simulate.mts <official.json> <replays dir> <report.md>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeMvp, PROPOSED_WEIGHTS, type MvpInput, type MvpWeights, type Side } from '../../src/lib/stats/mvp.ts';
import { analyzeReplay } from '../../src/lib/replay/analyze.ts';

const [officialPath, replaysDir, reportPath] = process.argv.slice(2);
if (!officialPath || !replaysDir || !reportPath) { console.error('uso: simulate.mts <official.json> <replays dir> <report.md>'); process.exit(1); }

const VARIANTS: { key: string; label: string; weights: MvpWeights }[] = [
  { key: 'V0', label: 'Proposta (gol 3, assist. 2, GK +1/2 min, vitória 2, contra −3)', weights: PROPOSED_WEIGHTS },
  { key: 'V1', label: 'Vitória +1', weights: { ...PROPOSED_WEIGHTS, win: 1 } },
  { key: 'V2', label: 'Sem bônus de vitória', weights: { ...PROPOSED_WEIGHTS, win: 0 } },
  { key: 'V3', label: 'Gol 2 (= assistência)', weights: { ...PROPOSED_WEIGHTS, goal: 2 } },
  { key: 'V4', label: 'GK +1 a cada 3 min', weights: { ...PROPOSED_WEIGHTS, keeperBlockSeconds: 180 } },
  { key: 'V5', label: 'GK +1 por minuto', weights: { ...PROPOSED_WEIGHTS, keeperBlockSeconds: 60 } },
  { key: 'V6', label: 'Gol contra −2', weights: { ...PROPOSED_WEIGHTS, ownGoal: -2 } },
];

type Sample = {
  source: 'oficial' | 'replay';
  label: string;
  input: MvpInput;
  names: Record<string, string>;
  role: Record<string, 'Goleiro' | 'Volante' | 'Pivô' | 'GK (estimado)' | 'linha' | '?'>;
  keeperSource: 'súmula' | 'cadastro' | 'estimado' | 'ausente';
  partialParticipation: boolean;
  notes: string[];
};

const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- (A) official
const official = JSON.parse(readFileSync(officialPath, 'utf8')) as {
  matches: { id: string; competition: string; round: string; home: string; away: string; homeTeamId: string; awayTeamId: string; score: { home: number; away: number }; penalties: { home: number | null; away: number | null }; durationSeconds: number | null; goals: { seconds: number; teamId: string; playerId: string | null; ownGoal: boolean; assistId: string | null }[]; keepers: { playerId: string; teamId: string; start: number; end: number }[] }[];
  players: Record<string, { nickname: string; position: string }>;
};
const keeperNicks = new Map<string, string>();
for (const [id, p] of Object.entries(official.players)) if (p.position === 'Goleiro') keeperNicks.set(norm(p.nickname), id);

const samples: Sample[] = [];
for (const m of official.matches) {
  const side = (teamId: string): Side => (teamId === m.homeTeamId ? 'home' : 'away');
  const participants = new Map<string, Side>();
  const goals = m.goals.map((g) => {
    const s = side(g.teamId);
    if (g.playerId) participants.set(g.playerId, s);
    if (g.assistId) participants.set(g.assistId, s);
    return { seconds: g.seconds, scorerSide: s, scorerId: g.playerId, ownGoal: g.ownGoal, assistId: g.assistId };
  });
  const keeperSpells = m.keepers.map((k) => { participants.set(k.playerId, side(k.teamId)); return { playerId: k.playerId, side: side(k.teamId), start: k.start, end: k.end }; });
  const names: Record<string, string> = {}; const role: Sample['role'] = {};
  for (const id of participants.keys()) { names[id] = official.players[id]?.nickname ?? id.slice(0, 8); role[id] = (official.players[id]?.position as Sample['role'][string]) ?? '?'; }
  const notes: string[] = ['participação conhecida só por gols, assistências e goleiro (sem escalação registrada)'];
  if (m.goals.length > 0 && m.goals.every((g) => !g.playerId && g.seconds === 0)) notes.push('resultado sem autor no segundo 0 (provável W.O.): sem dados para MVP');
  if (!m.keepers.length) notes.push('sem goleiro registrado na súmula');
  if (m.penalties.home !== null) notes.push('decidida nos pênaltis (tratada pelo placar do tempo normal)');
  samples.push({
    source: 'oficial', label: `${m.competition} · ${m.round}: ${m.home} ${m.score.home}×${m.score.away} ${m.away}`,
    input: { durationSeconds: m.durationSeconds ?? 840, score: m.score, participants: [...participants].map(([playerId, s]) => ({ playerId, side: s })), goals, keeperSpells },
    names, role, keeperSource: m.keepers.length ? 'súmula' : 'ausente', partialParticipation: true, notes,
  });
}

// ---------------------------------------------------------------- (B) replays
const files = readdirSync(replaysDir).filter((f) => /\.hbr2$/i.test(f)).sort();
let replayGames = 0; let replaySkipped = 0;
for (const f of files) {
  let analysis: any;
  try { analysis = await analyzeReplay(new Uint8Array(readFileSync(join(replaysDir, f)))); } catch { replaySkipped++; continue; }
  for (const seg of analysis.segments as any[]) {
    const duration = (seg.playingTicks ?? 0) / 60;
    if (duration < 300 || !seg.players?.length) { replaySkipped++; continue; }
    replayGames++;
    const id = (p: any) => `${f}#${seg.index}#${p.key}`;
    const byName = new Map<string, any>(); for (const p of seg.players) byName.set(p.name, p);
    const participants: { playerId: string; side: Side }[] = [];
    const names: Record<string, string> = {}; const role: Sample['role'] = {};
    const meanX = new Map<string, number>();
    for (const p of seg.players) {
      const ticks = (p.ticksRed ?? 0) + (p.ticksBlue ?? 0);
      if (ticks < 60 * 60) continue; // at least one minute on the pitch
      const s: Side = (p.ticksRed ?? 0) >= (p.ticksBlue ?? 0) ? 'home' : 'away';
      participants.push({ playerId: id(p), side: s });
      names[id(p)] = p.name; role[id(p)] = 'linha';
      meanX.set(id(p), p.sumX / Math.max(1, ticks));
    }
    // goalkeeper of each side: a registered FBF goalkeeper by nickname, else the player closest to his own goal (red defends the left)
    const keeperSpells: MvpInput['keeperSpells'] = [];
    let keeperSource: Sample['keeperSource'] = 'cadastro';
    for (const s of ['home', 'away'] as Side[]) {
      const sideP = participants.filter((p) => p.side === s);
      const registered = sideP.filter((p) => keeperNicks.has(norm(names[p.playerId])));
      let gk = registered.length === 1 ? registered[0] : null;
      if (!gk && sideP.length) {
        keeperSource = 'estimado';
        gk = [...sideP].sort((a, b) => (s === 'home' ? meanX.get(a.playerId)! - meanX.get(b.playerId)! : meanX.get(b.playerId)! - meanX.get(a.playerId)!))[0];
      }
      if (gk) { keeperSpells.push({ playerId: gk.playerId, side: s, start: 0, end: duration }); role[gk.playerId] = registered.length === 1 ? 'Goleiro' : 'GK (estimado)'; }
    }
    const goals = (seg.goals as any[]).map((g) => {
      const benefit: Side = g.team === 1 ? 'home' : 'away';
      const scorerSide: Side = g.ownGoal ? (benefit === 'home' ? 'away' : 'home') : benefit;
      const scorer = g.scorer ? byName.get(g.scorer) : null;
      const assist = g.assist && !g.ownGoal ? byName.get(g.assist) : null;
      return { seconds: g.time, scorerSide, scorerId: scorer ? id(scorer) : null, ownGoal: !!g.ownGoal, assistId: assist ? id(assist) : null };
    });
    const score = Array.isArray(seg.score) ? { home: seg.score[0], away: seg.score[1] } : { home: seg.score.red, away: seg.score.blue };
    samples.push({
      source: 'replay', label: `${f} (jogo ${seg.index + 1}): ${score.home}×${score.away}, ${Math.round(duration / 60)} min`,
      input: { durationSeconds: duration, score, participants, goals, keeperSpells },
      names, role, keeperSource, partialParticipation: false,
      notes: keeperSource === 'estimado' ? ['goleiro estimado pela posição média (sem cadastro correspondente)'] : [],
    });
  }
}

// ---------------------------------------------------------------- metrics
type Out = ReturnType<typeof computeMvp>;
const run = (w: MvpWeights) => samples.map((s) => computeMvp(s.input, w));
const results = new Map(VARIANTS.map((v) => [v.key, run(v.weights)]));
const base = results.get('V0')!;

function roleOf(s: Sample, id: string, r: Out) {
  const isKeeper = s.input.keeperSpells.some((k) => k.playerId === id);
  if (isKeeper) return 'goleiro (na partida)';
  const pos = s.role[id];
  if (pos === 'Pivô') return 'pivô';
  if (pos === 'Volante') return 'volante';
  if (pos === 'Goleiro') return 'goleiro cadastrado jogando na linha';
  return s.source === 'replay' ? 'linha (replay)' : 'desconhecida';
}

function summary(src: Sample['source'] | 'todas', key: string) {
  const rs = results.get(key)!;
  const idx = samples.map((s, i) => i).filter((i) => src === 'todas' || samples[i].source === src);
  let lostMvp = 0;
  const roles = new Map<string, number>(); let ties = 0; let none = 0; let mvpSlots = 0; let topScorerNotMvp = 0; let keeperMvp = 0; let changed = 0;
  const players = new Set<string>(); let totalTop = 0;
  for (const i of idx) {
    const s = samples[i]; const r = rs[i];
    for (const l of r.lines) players.add(l.playerId);
    if (!r.mvps.length) { none++; continue; }
    if (r.mvps.length > 1) ties++;
    totalTop += r.top ?? 0;
    const winnerSide = s.input.score.home > s.input.score.away ? 'home' : s.input.score.away > s.input.score.home ? 'away' : null;
    if (winnerSide && r.mvps.some((id) => r.lines.find((l) => l.playerId === id)!.side !== winnerSide)) lostMvp++;
    for (const id of r.mvps) { mvpSlots++; const ro = roleOf(s, id, r); roles.set(ro, (roles.get(ro) ?? 0) + 1); if (ro === 'goleiro (na partida)') keeperMvp++; }
    const maxGoals = Math.max(...r.lines.map((l) => l.goals));
    const scorers = r.lines.filter((l) => l.goals === maxGoals && maxGoals > 0).map((l) => l.playerId);
    if (scorers.length && !scorers.some((x) => r.mvps.includes(x))) topScorerNotMvp++;
    if (key !== 'V0' && JSON.stringify([...r.mvps].sort()) !== JSON.stringify([...base[i].mvps].sort())) changed++;
  }
  return { lostMvp, partidas: idx.length, jogadores: players.size, ties, none, mvpSlots, roles, topScorerNotMvp, keeperMvp, changed, avgTop: idx.length - none ? totalTop / (idx.length - none) : 0 };
}

const lines: string[] = [];
const P = (s = '') => lines.push(s);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const nOf = (src: Sample['source']) => samples.filter((s) => s.source === src).length;
P('# Simulação histórica do MVP (relatório completo, uso interno)');
P();
P(`Gerado em ${new Date().toISOString()}. Fórmula de referência: ${VARIANTS[0].label}.`);
P();
P(`- (A) Partidas oficiais encerradas: **${nOf('oficial')}** (participação parcial: só quem marcou, assistiu ou foi goleiro).`);
P(`- (B) Jogos de replays reais (≥ 5 min de bola rolando): **${nOf('replay')}** de ${files.length} arquivos (${replaySkipped} trechos curtos ou ilegíveis ignorados).`);
P();
for (const src of ['oficial', 'replay'] as const) {
  const s0 = summary(src, 'V0');
  P(`## ${src === 'oficial' ? '(A) Partidas oficiais' : '(B) Replays reais'} — fórmula proposta`);
  P();
  P(`| Métrica | Valor |`); P(`|---|---:|`);
  P(`| Partidas avaliadas | ${s0.partidas} |`);
  P(`| Jogadores avaliados | ${s0.jogadores} |`);
  P(`| Partidas com MVP compartilhado (empate) | ${s0.ties} (${pct(s0.ties, s0.partidas)}) |`);
  P(`| Partidas sem MVP (ninguém com pontuação positiva) | ${s0.none} |`);
  P(`| Pontuação média do MVP | ${s0.avgTop.toFixed(1)} |`);
  P(`| MVP não foi o maior artilheiro | ${s0.topScorerNotMvp} (${pct(s0.topScorerNotMvp, s0.partidas - s0.none)}) |`);
  P(`| MVP goleiro (na partida) | ${s0.keeperMvp} de ${s0.mvpSlots} MVPs |`);
  P(`| Partidas com MVP da equipe derrotada | ${s0.lostMvp} |`);
  P();
  P('Distribuição dos MVPs por função:'); P();
  for (const [r, n] of [...s0.roles].sort((a, b) => b[1] - a[1])) P(`- ${r}: ${n} (${pct(n, s0.mvpSlots)})`);
  P();
  P('Variações de pesos (comparadas com a proposta):'); P();
  P('| Variação | MVP muda em | Empates | MVP goleiro | MVP ≠ artilheiro |'); P('|---|---:|---:|---:|---:|');
  for (const v of VARIANTS) { const s = summary(src, v.key); P(`| ${v.key} — ${v.label} | ${v.key === 'V0' ? '—' : `${s.changed} (${pct(s.changed, s.partidas)})`} | ${s.ties} | ${s.keeperMvp} | ${s.topScorerNotMvp} |`); }
  P();
}

// MVP leaderboard (official)
P('## (A) Quem seria MVP nas partidas oficiais (proposta)'); P();
P('| Partida | MVP | Pontos | Detalhe | Observações |'); P('|---|---|---:|---|---|');
samples.forEach((s, i) => {
  if (s.source !== 'oficial') return;
  const r = base[i];
  const det = r.mvps.map((id) => { const l = r.lines.find((x) => x.playerId === id)!; return `${l.goals}G ${l.assists}A ${l.keeperBlocks}×GK ${l.won ? 'V' : ''} ${l.ownGoals ? `${l.ownGoals}GC` : ''}`.trim(); }).join(' / ');
  P(`| ${s.label} | ${r.mvps.map((id) => s.names[id]).join(', ') || '—'} | ${r.top ?? '—'} | ${det} | ${s.notes.join('; ')} |`);
});
P();

// examples
const examples = (pred: (s: Sample, r: Out) => boolean, max = 6) => samples.map((s, i) => [s, base[i]] as const).filter(([s, r]) => pred(s, r)).slice(0, max);
P('## Exemplos: maior artilheiro não foi MVP'); P();
for (const [s, r] of examples((s, r) => { const mg = Math.max(...r.lines.map((l) => l.goals)); return r.mvps.length > 0 && mg > 0 && !r.lines.filter((l) => l.goals === mg).some((l) => r.mvps.includes(l.playerId)); })) {
  const mg = Math.max(...r.lines.map((l) => l.goals)); const top = r.lines.find((l) => l.goals === mg)!; const mvp = r.lines.find((l) => l.playerId === r.mvps[0])!;
  P(`- ${s.label}: MVP **${s.names[mvp.playerId]}** (${mvp.total} pts: ${mvp.goals}G ${mvp.assists}A ${mvp.keeperBlocks}×GK) × artilheiro ${s.names[top.playerId]} (${top.total} pts: ${top.goals}G ${top.assists}A${top.ownGoals ? ` ${top.ownGoals}GC` : ''}${top.won ? '' : ', sem vitória'})`);
}
P();
P('## Exemplos: goleiro MVP'); P();
for (const [s, r] of examples((s, r) => r.mvps.some((id) => s.input.keeperSpells.some((k) => k.playerId === id)))) {
  const l = r.lines.find((x) => s.input.keeperSpells.some((k) => k.playerId === x.playerId) && r.mvps.includes(x.playerId))!;
  P(`- ${s.label}: **${s.names[l.playerId]}** (${s.role[l.playerId]}) ${l.total} pts — ${l.keeperBlocks} blocos de 2 min sem sofrer gol em ${Math.round(l.keeperSeconds / 60)} min no gol, ${l.goals}G ${l.assists}A${l.won ? ', vitória' : ''}`);
}
P();
P('## Partidas com dados insuficientes ou ressalvas'); P();
for (const s of samples.filter((x) => x.source === 'oficial')) P(`- ${s.label}: ${s.notes.join('; ')}`);
const est = samples.filter((x) => x.keeperSource === 'estimado').length;
P(`- Replays: goleiro estimado pela posição em ${est} de ${nOf('replay')} jogos (sem cadastro de goleiro correspondente).`);
writeFileSync(reportPath, lines.join('\n'));

// console digest
for (const src of ['oficial', 'replay'] as const) {
  const s = summary(src, 'V0');
  console.log(`[${src}] partidas=${s.partidas} jogadores=${s.jogadores} empates=${s.ties} semMVP=${s.none} mvpGoleiro=${s.keeperMvp}/${s.mvpSlots} mvp≠artilheiro=${s.topScorerNotMvp} mvpDerrotado=${s.lostMvp} média=${s.avgTop.toFixed(1)} funções=${JSON.stringify(Object.fromEntries(s.roles))}`);
  for (const v of VARIANTS.slice(1)) { const x = summary(src, v.key); console.log(`   ${v.key} ${v.label}: muda=${x.changed} empates=${x.ties} gk=${x.keeperMvp} ≠art=${x.topScorerNotMvp}`); }
}
console.log('relatório:', reportPath);
