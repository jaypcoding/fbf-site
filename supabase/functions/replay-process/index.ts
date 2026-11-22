// Edge Function "replay-process": server-side analysis of match recordings.
//
//   POST { action: "analyze", replay_id }  re-reads the stored .hbr2 file,
//        checks size and SHA-256, analyses it and rebuilds the match sheet;
//   POST { action: "build", match_id }     rebuilds the consolidated sheet of
//        the match from the stored analyses and the saved decisions.
//
// The caller must be signed in and allowed to manage the match (checked with
// the caller's own token). Files are read and results written with the
// service role; the browser never writes analyses or the official sheet.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';
import { analyzeReplay, ANALYZER_VERSION, ReplayError, type FileAnalysis } from '../_shared/replay/analyze.ts';
import { canonicalJson, consolidateMatch, officialPayload, publicReport, sha256Hex, type ReplayFileInput } from '../_shared/replay/consolidate.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

type RosterDb = { season_team_id: string; player: { id: string; nickname: string; position: string } | null };
type ReplayDb = { id: string; original_name: string; sha256: string; size_bytes: number; file_last_modified: string | null; uploaded_at: string; status: ReplayFileInput['status']; error: string | null; analysis: FileAnalysis | null };
type MatchDb = { id: string; status: string; home_team_id: string | null; away_team_id: string | null; home: { team: { name: string } | null } | null; away: { team: { name: string } | null } | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function canManage(user: SupabaseClient, matchId: string): Promise<boolean> {
  const { data, error } = await user.rpc('can_manage_match', { p_match_id: matchId });
  return !error && data === true;
}

async function analyzeFile(service: SupabaseClient, replay: { id: string; storage_path: string; size_bytes: number; sha256: string }): Promise<void> {
  const fail = async (message: string) => {
    await service.from('match_replays').update({ status: 'FAILED', error: message, analysis: null, analyzed_at: new Date().toISOString(), analyzer_version: ANALYZER_VERSION })
      .eq('id', replay.id).neq('status', 'REMOVED');
  };
  const { data: blob, error } = await service.storage.from('match-replays').download(replay.storage_path);
  if (error || !blob) { await fail('O arquivo não foi encontrado no armazenamento privado'); return; }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength !== Number(replay.size_bytes)) { await fail('O arquivo armazenado não tem o tamanho informado no envio'); return; }
  if ((await sha256Hex(bytes)) !== replay.sha256) { await fail('O arquivo armazenado não corresponde ao arquivo enviado (SHA-256 diferente)'); return; }
  let analysis: FileAnalysis;
  try {
    analysis = await analyzeReplay(bytes);
  } catch (e) {
    await fail(e instanceof ReplayError ? e.message : 'Falha inesperada ao analisar a gravação');
    return;
  }
  await service.from('match_replays').update({
    status: 'ANALYZED', error: null, analysis, analyzed_at: new Date().toISOString(), analyzer_version: ANALYZER_VERSION,
    replay_version: analysis.header.version, total_frames: analysis.header.totalFrames, duration_seconds: analysis.durationSeconds,
  }).eq('id', replay.id).neq('status', 'REMOVED');
}

async function buildSheet(service: SupabaseClient, matchId: string) {
  const { data: match, error: matchError } = await service.from('matches')
    .select('id, status, home_team_id, away_team_id, home:home_team_id ( team:team_id ( name ) ), away:away_team_id ( team:team_id ( name ) )')
    .eq('id', matchId).single();
  if (matchError || !match) return { status: 404, body: { error: 'Partida não encontrada' } };
  const m = match as unknown as MatchDb;
  if (!match.home_team_id || !match.away_team_id) return { status: 409, body: { error: 'A partida precisa ter as duas equipes definidas' } };
  const { data: review } = await service.from('match_replay_reviews').select('id, status, decisions, updated_at').eq('match_id', matchId).eq('status', 'DRAFT').maybeSingle();
  if (!review) return { status: 200, body: { sheet: null, hash: null, reason: 'Não há súmula em revisão para esta partida' } };
  const [{ data: replays }, { data: rosterRows }] = await Promise.all([
    service.from('match_replays').select('id, original_name, sha256, size_bytes, file_last_modified, uploaded_at, status, error, analysis').eq('match_id', matchId).neq('status', 'REMOVED').order('uploaded_at'),
    service.from('rosters').select('season_team_id, player:players(id, nickname, position)').in('season_team_id', [match.home_team_id, match.away_team_id]),
  ]);
  const roster = ((rosterRows ?? []) as unknown as RosterDb[]).flatMap((r) => (r.player ? [{ playerId: r.player.id, seasonTeamId: r.season_team_id, nickname: r.player.nickname, position: r.player.position }] : []));
  const playerIds = [...new Set(roster.map((r) => r.playerId))];
  const { data: aliasRows } = playerIds.length
    ? await service.from('player_aliases').select('player_id, alias').in('player_id', playerIds)
    : { data: [] as { player_id: string; alias: string }[] };
  const replayRows = (replays ?? []) as unknown as ReplayDb[];
  const shas = replayRows.map((r) => r.sha256);
  const { data: reused } = shas.length
    ? await service.from('match_replays').select('sha256').in('sha256', shas).neq('match_id', matchId).neq('status', 'REMOVED')
    : { data: [] as { sha256: string }[] };
  const reusedSet = new Set(((reused ?? []) as { sha256: string }[]).map((r) => r.sha256));
  const files: ReplayFileInput[] = replayRows.map((r) => ({
    id: r.id, name: r.original_name, sha256: r.sha256, sizeBytes: Number(r.size_bytes),
    lastModified: r.file_last_modified ? Date.parse(r.file_last_modified) : null, uploadedAt: r.uploaded_at,
    status: r.status, error: r.error, usedInOtherMatch: reusedSet.has(r.sha256), analysis: r.analysis,
  }));
  const sheet = consolidateMatch({
    match: { id: matchId, homeTeamId: match.home_team_id, awayTeamId: match.away_team_id, homeName: m.home?.team?.name ?? 'Mandante', awayName: m.away?.team?.name ?? 'Visitante' },
    roster,
    aliases: ((aliasRows ?? []) as { player_id: string; alias: string }[]).map((a) => ({ playerId: a.player_id, alias: a.alias })),
    files,
    decisions: review.decisions ?? {},
  });
  if (match.status === 'FINISHED') {
    sheet.issues.push({ level: 'warn', code: 'match_has_result', message: 'Esta partida já tem resultado registrado. Ao confirmar, os gols, assistências e goleiros atuais serão substituídos pelos desta súmula; o estado anterior fica no histórico de alterações da partida.' });
  } else if (match.status !== 'SCHEDULED' && match.status !== 'POSTPONED') {
    sheet.issues.push({ level: 'block', code: 'match_not_editable', message: 'A súmula por gravação vale para partidas agendadas, adiadas ou finalizadas (não ao vivo ou canceladas).' });
    sheet.canConfirm = false;
  }
  const official = officialPayload(sheet);
  const names: Record<string, string> = Object.fromEntries(roster.map((r) => [r.playerId, r.nickname]));
  const report = publicReport(sheet, names);
  const hash = await sha256Hex(canonicalJson({ official, report, canConfirm: sheet.canConfirm, issues: sheet.issues }));
  const stored = { ...sheet, analyzer: ANALYZER_VERSION };
  const { data: updated } = await service.from('match_replay_reviews')
    .update({ sheet: stored, official, report, sheet_hash: hash, sheet_built_at: new Date().toISOString() })
    .eq('id', review.id).eq('status', 'DRAFT').eq('updated_at', review.updated_at).select('id');
  if (!updated || updated.length === 0) return { status: 409, body: { error: 'A súmula mudou durante o processamento; gere novamente', stale: true } };
  return { status: 200, body: { sheet: stored, hash } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Método não permitido' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return reply(401, { error: 'Entre na sua conta para continuar' });
  const user = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: who } = await user.auth.getUser();
  if (!who?.user) return reply(401, { error: 'Sessão inválida' });
  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  let body: { action?: string; replay_id?: string; match_id?: string };
  try { body = await req.json(); } catch { return reply(400, { error: 'Requisição inválida' }); }

  try {
    if (body.action === 'analyze') {
      if (!body.replay_id || !UUID.test(body.replay_id)) return reply(400, { error: 'Gravação inválida' });
      const { data: replay } = await service.from('match_replays').select('id, match_id, storage_path, size_bytes, sha256, status').eq('id', body.replay_id).maybeSingle();
      if (!replay) return reply(404, { error: 'Gravação não encontrada' });
      if (!(await canManage(user, replay.match_id))) return reply(403, { error: 'Sem permissão para gerenciar esta partida' });
      if (replay.status === 'REMOVED') return reply(409, { error: 'A gravação foi removida da análise' });
      await analyzeFile(service, replay);
      const built = await buildSheet(service, replay.match_id);
      return reply(built.status, built.body);
    }
    if (body.action === 'build') {
      if (!body.match_id || !UUID.test(body.match_id)) return reply(400, { error: 'Partida inválida' });
      if (!(await canManage(user, body.match_id))) return reply(403, { error: 'Sem permissão para gerenciar esta partida' });
      const built = await buildSheet(service, body.match_id);
      return reply(built.status, built.body);
    }
    return reply(400, { error: 'Ação desconhecida' });
  } catch (e) {
    console.error('replay-process', e);
    return reply(500, { error: 'Falha inesperada no processamento da gravação' });
  }
});
