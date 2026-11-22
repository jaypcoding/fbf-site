// "Gravação e validação da partida": upload of any number of recordings of a
// match, server analysis, consolidated sheet preview, resolution of pending
// items and confirmation. The sheet shown is the one built by the server; the
// confirmation sends only its hash, so what is confirmed is what was shown.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Download, FileVideo, Info, Loader2, RefreshCw, Trash2, UploadCloud, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatClock } from '@/lib/time';
import { FormError } from '@/components/ui';
import { refreshAdminData } from '@/lib/adminRefresh';
import {
  cancelReview, confirmReview, reopenReview, formatBytes, inspectReplayFile, processReplay, rebuildSheet, removeReplay, replayDownloadUrl, saveDecisions, uploadReplay, type UploadStep,
} from '@/lib/replayClient';
import type { MatchSheet, ReviewDecisions, SheetGoal, SheetPlayer, Side } from '@/lib/replay/consolidate';
import { PitchMap, type PitchPoint } from '@/components/replay/PitchMap';

type MatchInfo = {
  id: string; status: string; home_team_id: string | null; away_team_id: string | null; scheduled_at: string | null;
  home_score: number | null; away_score: number | null;
  home: { team: { name: string } | null } | null; away: { team: { name: string } | null } | null;
  round: { name: string; stage: { name: string; season: { name: string; competition: { id: string; name: string } | null } | null } | null } | null;
};
type ReplayRow = { id: string; original_name: string; size_bytes: number; sha256: string; status: 'PENDING' | 'ANALYZED' | 'FAILED' | 'REMOVED'; duration_seconds: number | null; replay_version: number | null; analyzer_version: string | null; error: string | null; uploaded_at: string; storage_path: string; removal_reason: string | null };
type ReviewRow = { id: string; status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED'; decisions: ReviewDecisions; sheet: (MatchSheet & { analyzer?: string }) | null; sheet_hash: string | null; confirmed_at: string | null };
type RosterRow = { playerId: string; seasonTeamId: string; nickname: string; position: string };
type AuditRow = { id: number; action: string; created_at: string; details: Record<string, unknown> };
type LocalUpload = { key: string; name: string; size: number; step: UploadStep; progress: number; message: string | null; summary: string | null };

const stepLabel: Record<UploadStep, string> = {
  checking: 'Verificando o arquivo', uploading: 'Enviando', registering: 'Registrando', analyzing: 'Analisando no servidor', done: 'Concluído', error: 'Erro',
};
const statusLabel: Record<ReplayRow['status'], string> = { PENDING: 'Aguardando análise', ANALYZED: 'Analisado', FAILED: 'Falhou', REMOVED: 'Removido' };
const auditLabel: Record<string, string> = { UPLOAD: 'Arquivo enviado', REMOVE_FILE: 'Arquivo removido', DECISIONS: 'Correção/decisão registrada', CANCEL: 'Análise cancelada', CONFIRM: 'Súmula confirmada' };

function useReplayData(matchId: string) {
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [files, setFiles] = useState<ReplayRow[]>([]);
  const [review, setReview] = useState<ReviewRow | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { data: m, error: mErr } = await supabase.from('matches')
      .select('id, status, home_team_id, away_team_id, scheduled_at, home_score, away_score, home:home_team_id ( team:team_id ( name ) ), away:away_team_id ( team:team_id ( name ) ), round:round_id ( name, stage:stage_id ( name, season:season_id ( name, competition:competition_id ( id, name ) ) ) )')
      .eq('id', matchId).maybeSingle();
    if (mErr || !m) { setError('Partida não encontrada ou sem permissão.'); setLoading(false); return; }
    // matches are public: check the right to manage this one before showing any tool
    const { data: allowed } = await supabase.rpc('can_manage_match', { p_match_id: matchId });
    if (allowed !== true) { setError('Sem permissão para gerenciar esta partida. A súmula por gravação é feita por administradores ou pelos organizadores desta competição.'); setLoading(false); return; }
    const info = m as unknown as MatchInfo;
    const teamIds = [info.home_team_id, info.away_team_id].filter(Boolean) as string[];
    const [f, r, ro, au] = await Promise.all([
      supabase.from('match_replays').select('id, original_name, size_bytes, sha256, status, duration_seconds, replay_version, analyzer_version, error, uploaded_at, storage_path, removal_reason').eq('match_id', matchId).order('uploaded_at'),
      supabase.from('match_replay_reviews').select('id, status, decisions, sheet, sheet_hash, confirmed_at').eq('match_id', matchId).in('status', ['DRAFT', 'CONFIRMED']).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      teamIds.length ? supabase.from('rosters').select('season_team_id, player:player_id ( id, nickname, position )').in('season_team_id', teamIds) : Promise.resolve({ data: [], error: null }),
      supabase.from('match_replay_audit').select('id, action, created_at, details').eq('match_id', matchId).order('created_at', { ascending: false }).limit(50),
    ]);
    if (f.error || r.error) { setError('Não foi possível carregar as gravações. Verifique se a funcionalidade já está disponível neste ambiente.'); setLoading(false); return; }
    setMatch(info);
    setFiles((f.data ?? []) as ReplayRow[]);
    setReview((r.data ?? null) as ReviewRow | null);
    setRoster(((ro.data ?? []) as unknown as { season_team_id: string; player: { id: string; nickname: string; position: string } | null }[])
      .flatMap((x) => (x.player ? [{ playerId: x.player.id, seasonTeamId: x.season_team_id, nickname: x.player.nickname, position: x.player.position }] : [])));
    setAudit((au.data ?? []) as AuditRow[]);
    setError(null);
    setLoading(false);
  }, [matchId]);

  useEffect(() => { void reload(); }, [reload]);
  return { match, files, review, roster, audit, loading, error, reload };
}

export function MatchReplayPanel({ matchId }: { matchId: string }) {
  const { match, files, review, roster, audit, loading, error, reload } = useReplayData(matchId);
  const [uploads, setUploads] = useState<LocalUpload[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState<ReplayRow | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const homeName = match?.home?.team?.name ?? 'Mandante';
  const awayName = match?.away?.team?.name ?? 'Visitante';
  const confirmed = review?.status === 'CONFIRMED';
  const sheet = review?.sheet ?? null;
  const decisions: ReviewDecisions = review?.decisions ?? {};
  const activeFiles = files.filter((f) => f.status !== 'REMOVED');
  const finished = match?.status === 'FINISHED';
  const editable = !confirmed && (match?.status === 'SCHEDULED' || match?.status === 'POSTPONED' || finished);
  const [reopening, setReopening] = useState(false);
  const [replaceAck, setReplaceAck] = useState(false);

  // rebuild when the server sheet is missing or outdated
  const building = useRef(false);
  const build = useCallback(async () => {
    if (building.current) return;
    building.current = true;
    setBusy('Atualizando a súmula no servidor...');
    try { await rebuildSheet(matchId); } catch (e) { setMessage({ kind: 'error', text: (e as Error).message }); }
    building.current = false;
    setBusy(null);
    await reload();
  }, [matchId, reload]);
  useEffect(() => {
    if (!loading && review?.status === 'DRAFT' && !review.sheet_hash && activeFiles.length > 0 && activeFiles.every((f) => f.status !== 'PENDING')) void build();
  }, [loading, review?.status, review?.sheet_hash, activeFiles, build]);

  async function handleFiles(list: FileList | File[]) {
    setMessage(null);
    const items = [...list];
    for (const file of items) {
      const key = `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`;
      const patch = (p: Partial<LocalUpload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));
      setUploads((u) => [...u, { key, name: file.name, size: file.size, step: 'checking', progress: 0, message: null, summary: null }]);
      if (!/\.hbr2$/i.test(file.name)) { patch({ step: 'error', message: 'Envie arquivos .hbr2 (gravações do HaxBall). O formato antigo .hbr ainda não é suportado.' }); continue; }
      const check = await inspectReplayFile(file);
      if (!check.ok) { patch({ step: 'error', message: check.message }); continue; }
      if (files.some((f) => f.sha256 === check.sha256 && f.status !== 'REMOVED')) { patch({ step: 'error', message: 'Este arquivo já foi enviado para esta partida (mesmo conteúdo, SHA-256 idêntico).' }); continue; }
      patch({ summary: `${formatClock(Math.round(check.durationSeconds))} de gravação · ${check.games.length} jogo(s): ${check.games.map((g) => `${g.score} (${g.clock})`).join(', ') || 'nenhum jogo com bola rolando'}` });
      try {
        const result = await uploadReplay(matchId, file, check.sha256, (step, progress) => patch({ step, progress: progress ?? 0 }));
        patch({ step: 'done', message: result.usedInOtherMatch ? 'Atenção: este arquivo também foi enviado em outra partida. Confirme na súmula que ele pertence a esta.' : null });
      } catch (e) {
        patch({ step: 'error', message: (e as Error).message });
      }
      await reload();
    }
  }

  async function updateDecisions(next: ReviewDecisions) {
    setMessage(null);
    setBusy('Salvando decisão...');
    try {
      await saveDecisions(matchId, next);
      await reload();
      setBusy(null);
      await build();
    } catch (e) {
      setBusy(null);
      setMessage({ kind: 'error', text: (e as Error).message });
    }
  }

  async function reprocess(ids: string[]) {
    setMessage(null);
    for (const [i, id] of ids.entries()) {
      setBusy(`Reprocessando gravação ${i + 1} de ${ids.length}...`);
      try { await processReplay({ action: 'analyze', replay_id: id }); } catch (e) { setMessage({ kind: 'error', text: (e as Error).message }); }
    }
    setBusy(null);
    await reload();
  }

  async function download(row: ReplayRow) {
    try { window.open(await replayDownloadUrl(row.storage_path, row.original_name), '_blank', 'noopener'); }
    catch (e) { setMessage({ kind: 'error', text: (e as Error).message }); }
  }

  async function doConfirm() {
    if (!review?.sheet_hash) return;
    setBusy('Registrando a súmula oficial...');
    setMessage(null);
    try {
      const r = await confirmReview(matchId, review.sheet_hash, finished);
      setMessage({ kind: 'ok', text: `Súmula validada: ${homeName} ${r.home_score} × ${r.away_score} ${awayName}, ${r.goals} gol(s) registrados.` });
      refreshAdminData();
    } catch (e) {
      setMessage({ kind: 'error', text: (e as Error).message });
    }
    setBusy(null);
    await reload();
  }

  if (loading) return <div className="admin-list-card"><p className="admin-empty-text"><Loader2 className="spin" size={16} /> Carregando...</p></div>;
  if (error || !match) return <div className="admin-list-card"><FormError message={error ?? 'Partida não encontrada.'} /><Link to="/painel" className="back-link">← Voltar ao painel</Link></div>;

  const competition = match.round?.stage?.season?.competition;
  return (
    <div className="replay-panel">
      <Link to="/painel" className="back-link"><ArrowLeft size={14} /> Voltar ao painel</Link>
      <div className="admin-list-card replay-header">
        <span className="section-kicker">Gravação e validação da partida</span>
        <h2>{homeName} <small>×</small> {awayName}</h2>
        <p>{[competition?.name, match.round?.stage?.name, match.round?.name].filter(Boolean).join(' · ')}</p>
        <div className="replay-header-meta">
          <span className={`replay-pill pill-${confirmed ? 'ok' : sheet?.canConfirm ? 'ready' : 'pending'}`}>
            {confirmed ? 'Súmula validada' : !activeFiles.length ? 'Aguardando gravações' : sheet?.canConfirm ? 'Pronta para confirmar' : 'Pendências a resolver'}
          </span>
          {sheet && <span>Placar identificado: <strong>{sheet.score.home} × {sheet.score.away}</strong></span>}
          {sheet && <span>Duração: <strong>{formatClock(sheet.durationSeconds)}</strong></span>}
          <span>{activeFiles.length} arquivo(s)</span>
          {confirmed && <Link to={`/partidas/${match.id}`} className="button button-outline">Ver página pública</Link>}
        </div>
        {!editable && !confirmed && <p className="admin-hint">A súmula por gravação vale para partidas agendadas, adiadas ou finalizadas.</p>}
        {finished && !confirmed && <p className="admin-hint">Esta partida já tem resultado registrado ({match.home_score ?? '—'} × {match.away_score ?? '—'}). Uma súmula por gravação confirmada aqui substitui os gols, assistências e goleiros atuais; o estado anterior fica no histórico de alterações.</p>}
        {confirmed && (
          reopening ? (
            <div className="replay-confirm-box">
              <p>Reabrir a súmula por gravação? A súmula validada continua no histórico e uma nova revisão é aberta com as mesmas gravações (você pode enviar outras). O resultado oficial só muda quando a nova súmula for confirmada.</p>
              <input className="form-input" placeholder="Motivo (obrigatório)" value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="admin-list-actions">
                <button type="button" className="button button-primary" disabled={reason.trim().length < 3} onClick={async () => {
                  setReopening(false);
                  try { await reopenReview(matchId, reason); setMessage({ kind: 'ok', text: 'Súmula reaberta para revisão.' }); } catch (e) { setMessage({ kind: 'error', text: (e as Error).message }); }
                  await reload();
                }}>Reabrir</button>
                <button type="button" className="button button-outline" onClick={() => setReopening(false)}>Voltar</button>
              </div>
            </div>
          ) : <button type="button" className="button button-outline replay-reopen" onClick={() => { setReason(''); setReopening(true); }}>Reabrir súmula por gravação</button>
        )}
      </div>

      {message && <div className={`replay-message msg-${message.kind}`}>{message.kind === 'ok' ? <CheckCircle2 size={16} /> : <XCircle size={16} />} {message.text}</div>}
      {busy && <div className="replay-message msg-busy"><Loader2 size={16} className="spin" /> {busy}</div>}

      {editable && (
        <div className="admin-list-card">
          <h3>Enviar gravações (.hbr2)</h3>
          <div
            className={`replay-dropzone${dragging ? ' is-dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void handleFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
          >
            <UploadCloud size={28} />
            <strong>Arraste os arquivos aqui ou clique para selecionar</strong>
            <span>Um arquivo com a partida inteira, um por tempo ou vários trechos. Você pode enviar mais arquivos depois. Até 20 MB cada.</span>
            <input ref={inputRef} type="file" accept=".hbr2" multiple hidden onChange={(e) => { if (e.target.files) void handleFiles(e.target.files); e.target.value = ''; }} />
          </div>
          {uploads.length > 0 && (
            <div className="admin-list replay-uploads">
              {uploads.map((u) => (
                <div key={u.key} className={`admin-list-item replay-upload step-${u.step}`}>
                  <div>
                    <strong>{u.name}</strong>
                    <span>{formatBytes(u.size)} · {stepLabel[u.step]}{u.step === 'uploading' ? ` ${Math.round(u.progress * 100)}%` : ''}</span>
                    {u.summary && <span>{u.summary}</span>}
                    {u.message && <span className={u.step === 'error' ? 'replay-error-text' : 'replay-warn-text'}>{u.message}</span>}
                  </div>
                  {u.step === 'done' ? <CheckCircle2 size={18} className="ok-icon" /> : u.step === 'error' ? <XCircle size={18} className="error-icon" /> : <Loader2 size={18} className="spin" />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="admin-list-card">
        <div className="admin-list-heading">
          <h3>Arquivos da partida</h3>
          {editable && activeFiles.length > 0 && (
            <div className="admin-list-actions">
              <button type="button" className="button button-outline" disabled={Boolean(busy)} onClick={() => void reprocess(activeFiles.map((f) => f.id))}><RefreshCw size={14} /> Reprocessar todos</button>
              <button type="button" className="button button-outline" disabled={Boolean(busy)} onClick={() => { setCancelling(true); setReason(''); }}><XCircle size={14} /> Cancelar análise</button>
            </div>
          )}
        </div>
        {files.length === 0 ? <p className="admin-empty-text">Nenhuma gravação enviada para esta partida.</p> : (
          <div className="admin-list">
            {files.map((f) => {
              const row = sheet?.files.find((x) => x.id === f.id);
              return (
                <div key={f.id} className={`admin-list-item replay-file status-${f.status.toLowerCase()}`}>
                  <div className="replay-file-main">
                    <FileVideo size={18} />
                    <div>
                      <strong>{f.original_name}</strong>
                      <span>
                        {formatBytes(Number(f.size_bytes))}
                        {f.duration_seconds ? ` · ${formatClock(Math.round(Number(f.duration_seconds)))} de gravação` : ''}
                        {row ? ` · ${row.segments} jogo(s) no arquivo` : ''}
                        {row?.orderHint ? ` · ${row.orderHint}` : ''}
                        {` · ${statusLabel[f.status]}`}
                        {f.replay_version ? ` · formato v${f.replay_version}` : ''}
                      </span>
                      {f.error && <span className="replay-error-text">{f.error}</span>}
                      {f.status === 'REMOVED' && f.removal_reason && <span>Motivo: {f.removal_reason}</span>}
                      <span className="replay-hash" title="SHA-256">SHA-256 {f.sha256.slice(0, 16)}…</span>
                    </div>
                  </div>
                  <div className="admin-list-actions">
                    <button type="button" className="icon-button" title="Baixar gravação (link temporário)" onClick={() => void download(f)}><Download size={15} /></button>
                    {editable && f.status !== 'REMOVED' && <button type="button" className="icon-button" title="Reprocessar" disabled={Boolean(busy)} onClick={() => void reprocess([f.id])}><RefreshCw size={15} /></button>}
                    {editable && f.status !== 'REMOVED' && <button type="button" className="icon-button" title="Remover da análise" disabled={Boolean(busy)} onClick={() => { setRemoving(f); setReason(''); }}><Trash2 size={15} /></button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {(removing || cancelling) && (
          <div className="replay-confirm-box">
            <p>{removing ? `Remover "${removing.original_name}" da análise? O arquivo continua guardado e a remoção fica registrada.` : 'Cancelar a análise? Os arquivos saem da análise (continuam guardados) e as decisões são descartadas.'}</p>
            <input className="form-input" placeholder="Motivo (opcional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="admin-list-actions">
              <button type="button" className="button button-primary" onClick={async () => {
                const target = removing; setRemoving(null); setCancelling(false);
                try { if (target) await removeReplay(target.id, reason); else await cancelReview(matchId, reason); } catch (e) { setMessage({ kind: 'error', text: (e as Error).message }); }
                await reload();
              }}>Confirmar</button>
              <button type="button" className="button button-outline" onClick={() => { setRemoving(null); setCancelling(false); }}>Voltar</button>
            </div>
          </div>
        )}
      </div>

      {sheet && (
        <SheetView
          sheet={sheet}
          decisions={decisions}
          roster={roster}
          homeName={homeName}
          awayName={awayName}
          homeTeamId={match.home_team_id}
          awayTeamId={match.away_team_id}
          editable={editable && !busy}
          onDecisions={updateDecisions}
        />
      )}

      {sheet && editable && (
        <div className="admin-list-card replay-confirm-card">
          <h3>Confirmar e validar partida</h3>
          <p>Ao confirmar, o placar, os gols, as assistências, os goleiros e a duração são registrados oficialmente, a partida passa a <strong>Finalizada</strong> e as estatísticas ficam públicas. As gravações continuam privadas como comprovante.</p>
          {!sheet.canConfirm && <p className="replay-error-text">Resolva as pendências marcadas em vermelho para liberar a confirmação.</p>}
          {finished && <label className="replay-replace-ack"><input type="checkbox" checked={replaceAck} onChange={(e) => setReplaceAck(e.target.checked)} /> Entendo que o placar, os gols, as assistências e os goleiros atuais desta partida serão substituídos (o estado anterior fica no histórico).</label>}
          <button type="button" className="button button-primary" disabled={!sheet.canConfirm || !review?.sheet_hash || Boolean(busy) || (finished && !replaceAck)} onClick={() => void doConfirm()}>
            <CheckCircle2 size={16} /> Confirmar e validar partida
          </button>
        </div>
      )}

      {audit.length > 0 && (
        <details className="admin-list-card replay-audit">
          <summary>Histórico da súmula ({audit.length})</summary>
          <ul>
            {audit.map((a) => (
              <li key={a.id}><span>{new Date(a.created_at).toLocaleString('pt-BR')}</span> {auditLabel[a.action] ?? a.action}{typeof a.details?.name === 'string' ? ` · ${a.details.name}` : ''}{typeof a.details?.reason === 'string' && a.details.reason ? ` · ${a.details.reason}` : ''}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// --------------------------------------------------------------------- sheet
function SheetView({ sheet, decisions, roster, homeName, awayName, homeTeamId, awayTeamId, editable, onDecisions }: {
  sheet: MatchSheet; decisions: ReviewDecisions; roster: RosterRow[]; homeName: string; awayName: string; homeTeamId: string | null; awayTeamId: string | null; editable: boolean; onDecisions: (d: ReviewDecisions) => void;
}) {
  const [mapView, setMapView] = useState('ball');
  const teamOf = (side: Side | null) => (side === 'home' ? homeName : side === 'away' ? awayName : '—');
  const rosterFor = (side: Side) => roster.filter((r) => r.seasonTeamId === (side === 'home' ? homeTeamId : awayTeamId));
  const set = (patch: ReviewDecisions) => onDecisions({ ...decisions, ...patch });
  const blocks = sheet.issues.filter((i) => i.level === 'block');
  const warns = sheet.issues.filter((i) => i.level === 'warn');
  const infos = sheet.issues.filter((i) => i.level === 'info');
  const orderedFiles = sheet.order.fileIds.map((id) => sheet.files.find((f) => f.id === id)!).filter(Boolean);
  const moveFile = (index: number, delta: number) => {
    const ids = [...sheet.order.fileIds];
    const [x] = ids.splice(index, 1);
    ids.splice(index + delta, 0, x);
    set({ order: ids, orderConfirmed: true });
  };

  const players = sheet.players;
  const selectedPlayer = mapView.startsWith('p:') ? players.find((p) => p.ref === mapView.slice(2)) ?? null : null;
  const heat = mapView === 'ball' ? sheet.ballHeat : selectedPlayer?.heat ?? null;
  const points: PitchPoint[] = [
    ...sheet.shots.filter((s) => !selectedPlayer || s.ref === selectedPlayer.ref).map((s) => ({ from: s.from, at: s.to, kind: (s.onTarget ? 'shot-on' : 'shot-off') as PitchPoint['kind'], side: s.side })),
    ...sheet.goals.filter((g) => g.ball && (!selectedPlayer || g.scorerPlayerId === selectedPlayer.playerId)).map((g) => ({ from: g.shotFrom, at: g.ball!, kind: 'goal' as const, side: g.side })),
  ];
  const totalPoss = sheet.teams.home.possessionTicks + sheet.teams.away.possessionTicks;

  return (
    <>
      {(blocks.length > 0 || warns.length > 0 || infos.length > 0) && (
        <div className="admin-list-card">
          <h3>Pendências e avisos</h3>
          <ul className="replay-issues">
            {blocks.map((i, n) => (
              <li key={`b${n}`} className="issue-block">
                <XCircle size={15} /> <span>{i.message}</span>
                {i.code === 'file_reused' && i.ref && editable && (
                  <button type="button" className="button button-outline issue-action" onClick={() => set({ acknowledgeReuse: [...(decisions.acknowledgeReuse ?? []), i.ref!] })}>Pertence a esta partida</button>
                )}
              </li>
            ))}
            {warns.map((i, n) => <li key={`w${n}`} className="issue-warn"><AlertTriangle size={15} /> {i.message}</li>)}
            {infos.map((i, n) => <li key={`i${n}`} className="issue-info"><Info size={15} /> {i.message}</li>)}
          </ul>
        </div>
      )}

      <div className="admin-list-card">
        <h3>Trechos e períodos identificados</h3>
        {orderedFiles.length > 1 && (
          <div className="replay-order">
            <p>Ordem dos arquivos {sheet.order.source === 'timestamp' ? '(pela data e hora no nome dos arquivos)' : sheet.order.source === 'sequence' ? '(pela numeração no nome dos arquivos)' : sheet.order.source === 'manual' ? '(definida pelo administrador)' : '(não foi possível determinar pelos nomes — confira)'}:</p>
            <ol>
              {orderedFiles.map((f, i) => (
                <li key={f.id}>
                  {f.name}
                  {editable && <>
                    <button type="button" className="icon-button" disabled={i === 0} onClick={() => moveFile(i, -1)} title="Mover para cima"><ArrowUp size={13} /></button>
                    <button type="button" className="icon-button" disabled={i === orderedFiles.length - 1} onClick={() => moveFile(i, 1)} title="Mover para baixo"><ArrowDown size={13} /></button>
                  </>}
                </li>
              ))}
            </ol>
            {editable && !sheet.order.confirmed && <button type="button" className="button button-outline" onClick={() => set({ order: sheet.order.fileIds, orderConfirmed: true })}>Confirmar esta ordem</button>}
          </div>
        )}
        <div className="table-scroll">
          <table className="replay-table">
            <thead><tr><th>Arquivo</th><th>Trecho (relógio)</th><th>Placar (V × A)</th><th>Período</th><th>Vermelho é</th><th>Incluir</th></tr></thead>
            <tbody>
              {sheet.segments.map((s) => (
                <tr key={s.key} className={s.include ? '' : 'row-muted'}>
                  <td>{s.fileName}</td>
                  <td>{formatClock(Math.floor(s.clockStart))}–{formatClock(Math.floor(s.clockEnd))}{s.startedMidGame ? ' (gravação iniciada com o jogo em andamento)' : ''}</td>
                  <td>{s.score[0]} × {s.score[1]}</td>
                  <td>{s.include && s.gameIndex !== null ? `${sheet.games[s.gameIndex]?.label ?? ''}${s.role === 'repeat' ? ' (repetido)' : ''}` : s.excludedReason}</td>
                  <td>
                    {s.include ? (
                      <select value={s.redIsSource === 'manual' ? s.redIs ?? '' : ''} disabled={!editable} onChange={(e) => set({ segments: { ...decisions.segments, [s.key]: { ...decisions.segments?.[s.key], redIs: (e.target.value || undefined) as Side | undefined } } })}>
                        <option value="">{s.redIs ? `Automático: ${teamOf(s.redIs)}` : 'Não identificado'}</option>
                        <option value="home">{homeName}</option>
                        <option value="away">{awayName}</option>
                      </select>
                    ) : '—'}
                  </td>
                  <td><input type="checkbox" checked={s.include} disabled={!editable} onChange={(e) => set({ segments: { ...decisions.segments, [s.key]: { ...decisions.segments?.[s.key], include: e.target.checked } } })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="replay-footnote">
          {sheet.games.map((g) => `${g.label}: ${homeName} ${g.homeGoals} × ${g.awayGoals} ${awayName} (${formatClock(Math.round(g.durationSeconds))})`).join(' · ')}
          {sheet.games.length > 0 ? ` · Total: ${sheet.score.home} × ${sheet.score.away}, ${formatClock(sheet.durationSeconds)} de jogo.` : ''}
        </p>
      </div>

      <div className="admin-list-card">
        <h3>Jogadores</h3>
        <div className="table-scroll">
          <table className="replay-table">
            <thead><tr><th>Nick na gravação</th><th>Time</th><th>Situação</th><th>Jogador cadastrado</th></tr></thead>
            <tbody>
              {players.map((p) => <PlayerRow key={p.ref} p={p} decisions={decisions} options={p.side ? rosterFor(p.side) : roster} teamOf={teamOf} editable={editable} onPick={(v) => set({ players: { ...decisions.players, [p.ident]: v } })} />)}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-list-card">
        <h3>Gols</h3>
        {sheet.goals.length === 0 ? <p className="admin-empty-text">Nenhum gol nas gravações incluídas.</p> : (
          <div className="table-scroll">
            <table className="replay-table">
              <thead><tr><th>Tempo</th><th>Para</th><th>Autor</th><th>Assistência</th><th>Gol contra</th><th>Observações</th></tr></thead>
              <tbody>
                {sheet.goals.map((g) => <GoalRow key={g.key} g={g} decisions={decisions} homeName={homeName} awayName={awayName} scoringRoster={rosterFor(g.side)} concedingRoster={rosterFor(g.side === 'home' ? 'away' : 'home')} editable={editable && g.source === 'replay'} onFix={(fix) => set({ goals: { ...decisions.goals, [g.key]: fix } })} />)}
              </tbody>
            </table>
          </div>
        )}
        <div className="replay-keepers">
          {(['home', 'away'] as const).map((side) => (
            <label key={side}>
              Goleiro de {side === 'home' ? homeName : awayName}
              <select value={sheet.goalkeepers[side] ?? ''} disabled={!editable} onChange={(e) => set({ goalkeepers: { ...decisions.goalkeepers, [side]: e.target.value } })}>
                <option value="">Nenhum (CS não registrado)</option>
                {rosterFor(side).filter((r) => r.position === 'Goleiro').map((r) => <option key={r.playerId} value={r.playerId}>{r.nickname}{sheet.goalkeepers.suggested[side] === r.playerId ? ' (sugerido)' : ''}</option>)}
              </select>
            </label>
          ))}
        </div>
      </div>

      <div className="admin-list-card">
        <h3>Estatísticas</h3>
        <div className="table-scroll">
          <table className="replay-table replay-team-table">
            <thead><tr><th /><th>{homeName}</th><th>{awayName}</th></tr></thead>
            <tbody>
              <tr><td>Gols</td><td>{sheet.score.home}</td><td>{sheet.score.away}</td></tr>
              <tr><td>Posse de bola</td><td>{sheet.teams.home.possessionPct ?? '—'}%</td><td>{sheet.teams.away.possessionPct ?? '—'}%</td></tr>
              <tr><td>Finalizações</td><td>{sheet.teams.home.shots}</td><td>{sheet.teams.away.shots}</td></tr>
              <tr><td>Chutes no gol</td><td>{sheet.teams.home.shotsOnTarget}</td><td>{sheet.teams.away.shotsOnTarget}</td></tr>
              <tr><td>Passes</td><td>{sheet.teams.home.passes}</td><td>{sheet.teams.away.passes}</td></tr>
              <tr><td>Chutes (todos)</td><td>{sheet.teams.home.kicks}</td><td>{sheet.teams.away.kicks}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="table-scroll">
          <table className="replay-table">
            <thead><tr><th>Jogador</th><th>Time</th><th>G</th><th>A</th><th>GC</th><th>Fin.</th><th>No gol</th><th>Passes</th><th>Chutes</th><th>Toques</th><th>Posse</th><th>Tempo</th></tr></thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.ref}>
                  <td>{p.names.join(' / ')}{!p.playerId && <em className="replay-unidentified"> (não identificado)</em>}</td>
                  <td>{teamOf(p.side)}</td>
                  <td>{p.stats.goals}</td><td>{p.stats.assists}</td><td>{p.stats.ownGoals}</td><td>{p.stats.shots}</td><td>{p.stats.shotsOnTarget}</td>
                  <td>{p.stats.passes}</td><td>{p.stats.kicks}</td><td>{p.stats.touches}</td>
                  <td>{totalPoss ? `${Math.round((p.stats.possessionTicks / totalPoss) * 100)}%` : '—'}</td>
                  <td>{formatClock(Math.round(p.stats.playedTicks / 60))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sheet.stadium && (
          <div className="replay-maps">
            <div className="replay-map-controls">
              <label htmlFor="sheet-map-view">Mapa de calor</label>
              <select id="sheet-map-view" value={mapView} onChange={(e) => setMapView(e.target.value)}>
                <option value="ball">Bola</option>
                {players.map((p) => <option key={p.ref} value={`p:${p.ref}`}>{p.names[0]} · {teamOf(p.side)}</option>)}
              </select>
            </div>
            <PitchMap stadium={sheet.stadium} heat={heat} points={points} tone={mapView === 'ball' ? 'ball' : selectedPlayer?.side ?? 'home'} label={`${mapView === 'ball' ? 'Posição da bola' : selectedPlayer?.names[0] ?? ''} · ${homeName} ataca para a direita`} />
          </div>
        )}
      </div>
    </>
  );
}

function PlayerRow({ p, decisions, options, teamOf, editable, onPick }: { p: SheetPlayer; decisions: ReviewDecisions; options: RosterRow[]; teamOf: (s: Side | null) => string; editable: boolean; onPick: (v: string) => void }) {
  const r = p.resolution;
  const current = decisions.players?.[p.ident] ?? '';
  const status = r.status === 'matched' ? (r.via === 'manual' ? 'Associado manualmente' : r.via === 'alias' ? 'Identificado (apelido salvo)' : 'Identificado pelo nick')
    : r.status === 'ambiguous' ? 'Ambíguo: escolha o jogador' : r.status === 'unknown' ? 'Não identificado' : r.status === 'ignored' ? 'Ignorado (não é jogador da partida)' : 'Mantido sem cadastro';
  const suggestions = r.status === 'unknown' ? r.suggestions : r.status === 'ambiguous' ? r.candidates : [];
  return (
    <tr className={r.status === 'ambiguous' || r.status === 'unknown' ? 'row-pending' : ''}>
      <td>{p.names.join(' / ')}</td>
      <td>{teamOf(p.side)}</td>
      <td>{status}{suggestions.length > 0 ? ` · sugestões: ${suggestions.map((s) => s.nickname).join(', ')}` : ''}</td>
      <td>
        <select value={current} disabled={!editable} onChange={(e) => onPick(e.target.value)}>
          <option value="">{r.status === 'matched' && r.via !== 'manual' ? `Automático: ${options.find((o) => o.playerId === r.playerId)?.nickname ?? 'identificado'}` : 'Escolha...'}</option>
          {options.map((o) => <option key={`${o.playerId}-${o.seasonTeamId}`} value={o.playerId}>{o.nickname}</option>)}
          <option value="none">Não identificado (registrar sem jogador)</option>
          <option value="ignore">Ignorar (não jogou a partida)</option>
        </select>
      </td>
    </tr>
  );
}

function GoalRow({ g, decisions, homeName, awayName, scoringRoster, concedingRoster, editable, onFix }: {
  g: SheetGoal; decisions: ReviewDecisions; homeName: string; awayName: string; scoringRoster: RosterRow[]; concedingRoster: RosterRow[]; editable: boolean;
  onFix: (fix: { scorer?: string; assist?: string; ownGoal?: boolean }) => void;
}) {
  const fix = decisions.goals?.[g.key] ?? {};
  const authorOptions = g.ownGoal ? concedingRoster : scoringRoster;
  return (
    <tr className={g.notes.some((n) => n.startsWith('Último toque')) ? 'row-pending' : ''}>
      <td>{formatClock(g.minuteSeconds)}</td>
      <td>{g.side === 'home' ? homeName : awayName}</td>
      <td>
        <select value={fix.scorer ?? ''} disabled={!editable} onChange={(e) => onFix({ ...fix, scorer: e.target.value || undefined })}>
          <option value="">{g.scorerName ? `${g.scorerName}${g.scorerPlayerId ? '' : ' (não identificado)'}` : 'Sem autor'}</option>
          {authorOptions.map((o) => <option key={o.playerId} value={o.playerId}>{o.nickname}</option>)}
          <option value="none">Sem autor</option>
        </select>
      </td>
      <td>
        {g.ownGoal ? '—' : (
          <select value={fix.assist ?? ''} disabled={!editable} onChange={(e) => onFix({ ...fix, assist: e.target.value || undefined })}>
            <option value="">{g.assistName ? `${g.assistName}${g.assistPlayerId ? '' : ' (não identificado)'}` : 'Sem assistência'}</option>
            {scoringRoster.map((o) => <option key={o.playerId} value={o.playerId}>{o.nickname}</option>)}
            <option value="none">Sem assistência</option>
          </select>
        )}
      </td>
      <td><input type="checkbox" checked={g.ownGoal} disabled={!editable} onChange={(e) => onFix({ ...fix, ownGoal: e.target.checked })} /></td>
      <td className="replay-notes">
        {g.notes.join(' ')}
        {editable && !g.corrected && g.notes.some((n) => n.startsWith('Gol contra a conferir')) && (
          <button type="button" className="button button-outline issue-action" onClick={() => onFix({ ...fix, ownGoal: true })}>Confirmar gol contra</button>
        )}
      </td>
    </tr>
  );
}
