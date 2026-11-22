// "Editar súmula": correction of a FINISHED match (manual sheet or sheet from
// recordings) through edit_match_sheet(), which validates everything, keeps
// the previous state in the match history and applies all changes in one
// transaction. The score is always derived from the goals.
import { useEffect, useMemo, useState } from 'react';
import { History, Plus, Trash2 } from 'lucide-react';
import { supabase, type Match } from '@/lib/supabase';
import { useRosters } from '@/lib/hooks';
import { refreshAdminData } from '@/lib/adminRefresh';
import { formatClock, parseClock } from '@/lib/time';
import { FormError } from '@/components/ui';

type Side = 'home' | 'away';
type GoalRow = { key: number; side: Side; playerId: string; ownGoal: boolean; minute: string; assistId: string; period: string; metadata: Record<string, unknown> | null };
type EventRow = { id: string; event_type: string; minute_seconds: number; period: string; team_id: string; player_id: string | null; is_own_goal: boolean; goal_event_id: string | null; metadata: Record<string, unknown> | null };
type HistoryRow = { id: number; created_at: string; actor: string | null; source: string; reason: string; changes: { score_before?: (number | null)[]; score_after?: (number | null)[]; goals_before?: number; goals_after?: number; statistics_changed?: boolean; goalkeepers_changed?: boolean } };
type ReportPlayer = { name: string; identified: boolean; side: Side | null; stats: Record<string, number> };
type Report = { players: ReportPlayer[]; teams: { home: Record<string, number>; away: Record<string, number> } };

const STAT_FIELDS: [string, string][] = [['shots', 'Fin.'], ['shotsOnTarget', 'No gol'], ['passes', 'Passes'], ['kicks', 'Chutes'], ['touches', 'Toques']];
const TEAM_FIELDS: [string, string][] = [['shots', 'Finalizações'], ['shotsOnTarget', 'Chutes no gol'], ['passes', 'Passes'], ['kicks', 'Chutes']];
let nextKey = 1;
// comparable form of the goal rows (without the React key)
const comparable = (rows: GoalRow[]) => JSON.stringify(rows.map((r) => [r.side, r.playerId, r.ownGoal, r.minute, r.assistId, r.period]));

export function MatchEditDialog({ match, onDone }: { match: Match; onDone: () => void }) {
  const homeId = match.home_team_id ?? '';
  const awayId = match.away_team_id ?? '';
  const homeName = match.home_team?.team?.name ?? 'Mandante';
  const awayName = match.away_team?.team?.name ?? 'Visitante';
  const { rosters: homeRoster } = useRosters(homeId || undefined);
  const { rosters: awayRoster } = useRosters(awayId || undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState('');
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [original, setOriginal] = useState<{ goals: string; keepers: string; home: number; away: number; duration: number | null }>({ goals: '', keepers: '', home: 0, away: 0, duration: null });
  const [keepers, setKeepers] = useState<{ home: string; away: string }>({ home: '', away: '' });
  const [duration, setDuration] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [statEdits, setStatEdits] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  async function load() {
    setLoading(true);
    const [fp, ev, rep, hist] = await Promise.all([
      supabase.rpc('match_sheet_fingerprint', { p_match_id: match.id }),
      supabase.from('match_events').select('id, event_type, minute_seconds, period, team_id, player_id, is_own_goal, goal_event_id, metadata').eq('match_id', match.id),
      supabase.from('match_replay_reports').select('report').eq('match_id', match.id).maybeSingle(),
      supabase.from('match_edit_history').select('id, created_at, actor, source, reason, changes').eq('match_id', match.id).order('created_at', { ascending: false }),
    ]);
    if (fp.error) { setError(fp.error.code === '42501' ? 'Sem permissão para editar esta partida.' : 'Não foi possível carregar a partida para edição.'); setLoading(false); return; }
    const events = (ev.data ?? []) as EventRow[];
    const assists = new Map(events.filter((e) => e.event_type === 'ASSIST' && e.goal_event_id).map((e) => [e.goal_event_id!, e.player_id ?? '']));
    const rows: GoalRow[] = events.filter((e) => e.event_type === 'GOAL').sort((a, b) => a.minute_seconds - b.minute_seconds).map((e) => {
      const teamSide: Side = e.team_id === homeId ? 'home' : 'away';
      return {
        key: nextKey++, side: e.is_own_goal ? (teamSide === 'home' ? 'away' : 'home') : teamSide, playerId: e.player_id ?? '', ownGoal: e.is_own_goal,
        minute: e.metadata?.minute_unknown ? '' : formatClock(e.minute_seconds), assistId: assists.get(e.id) ?? '', period: e.period, metadata: e.metadata,
      };
    });
    const k = { home: events.find((e) => e.event_type === 'GOALKEEPER_IN' && e.team_id === homeId)?.player_id ?? '', away: events.find((e) => e.event_type === 'GOALKEEPER_IN' && e.team_id === awayId)?.player_id ?? '' };
    setGoals(rows);
    setKeepers(k);
    setDuration(match.duration_seconds ? formatClock(match.duration_seconds) : '');
    setOriginal({ goals: comparable(rows), keepers: JSON.stringify(k), home: match.home_score ?? 0, away: match.away_score ?? 0, duration: match.duration_seconds });
    setFingerprint(fp.data as string);
    setReport(((rep.data as { report: Report } | null)?.report) ?? null);
    const h = (hist.data ?? []) as HistoryRow[];
    setHistory(h);
    const actorIds = [...new Set(h.map((x) => x.actor).filter(Boolean))] as string[];
    if (actorIds.length) {
      const { data } = await supabase.from('profiles').select('id, display_name').in('id', actorIds);
      setNames(Object.fromEntries((data ?? []).map((p: { id: string; display_name: string | null }) => [p.id, p.display_name ?? 'Administrador'])));
    }
    setStatEdits({});
    setError(null);
    setLoading(false);
  }
  useEffect(() => { void load(); }, [match.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rosterOf = (side: Side) => (side === 'home' ? homeRoster : awayRoster);
  const other = (side: Side): Side => (side === 'home' ? 'away' : 'home');
  const score = useMemo(() => ({ home: goals.filter((g) => g.side === 'home').length, away: goals.filter((g) => g.side === 'away').length }), [goals]);
  const update = (key: number, patch: Partial<GoalRow>) => setGoals((list) => list.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const durationSeconds = duration.trim() ? parseClock(duration) : null;
  const goalsChanged = comparable(goals) !== original.goals;
  const keepersChanged = JSON.stringify(keepers) !== original.keepers;
  const durationChanged = (durationSeconds ?? null) !== original.duration;
  const statsChanged = Object.keys(statEdits).length > 0;
  const changed = goalsChanged || keepersChanged || durationChanged || statsChanged;

  function validate(): string | null {
    if (duration.trim() && (durationSeconds === null || durationSeconds <= 0)) return 'Informe a duração no formato m:ss.';
    for (const g of goals) {
      const m = g.minute.trim() ? parseClock(g.minute) : null;
      if (g.minute.trim() && (m === null || (durationSeconds !== null && m > durationSeconds))) return `Tempo de gol inválido: ${g.minute}.`;
      if (g.assistId && (!g.playerId || g.assistId === g.playerId)) return 'A assistência precisa de um autor diferente do assistente.';
      if (g.ownGoal && g.assistId) return 'Gol contra não tem assistência.';
    }
    // the database identifies a goal by team, author and minute
    const seen = new Set<string>();
    for (const g of goals) {
      if (!g.playerId) continue;
      const team = g.ownGoal ? other(g.side) : g.side;
      const id = `${team}|${g.playerId}|${g.period}|${g.minute.trim() ? parseClock(g.minute) : 0}`;
      if (seen.has(id)) return 'Dois gols do mesmo jogador no mesmo minuto (ou ambos sem tempo). Informe o tempo de cada gol.';
      seen.add(id);
    }
    return null;
  }

  function payload() {
    const body: Record<string, unknown> = {
      score,
      goals: goals.map((g) => ({
        team_id: g.ownGoal ? (g.side === 'home' ? awayId : homeId) : (g.side === 'home' ? homeId : awayId),
        player_id: g.playerId || null,
        is_own_goal: g.ownGoal,
        minute_seconds: g.minute.trim() ? parseClock(g.minute) : null,
        assist_player_id: g.ownGoal ? null : g.assistId || null,
        period: g.period,
        metadata: g.metadata,
      })),
    };
    if (durationChanged && durationSeconds) body.duration_seconds = durationSeconds;
    if (keepersChanged) {
      body.goalkeepers = (['home', 'away'] as const).filter((s) => keepers[s]).map((s) => ({ team_id: s === 'home' ? homeId : awayId, player_id: keepers[s], started_at_seconds: 0 }));
    }
    if (statsChanged && report) {
      const players: { index: number; stats: Record<string, number> }[] = [];
      const teams: Record<string, Record<string, number>> = {};
      for (const [k, v] of Object.entries(statEdits)) {
        const [kind, id, field] = k.split(':');
        if (kind === 'p') {
          let row = players.find((p) => p.index === Number(id));
          if (!row) { row = { index: Number(id), stats: {} }; players.push(row); }
          row.stats[field] = v;
        } else {
          teams[id] = { ...(teams[id] ?? {}), [field]: v };
        }
      }
      body.report_patch = { players, teams };
    }
    return body;
  }

  async function save() {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('edit_match_sheet', { p_match_id: match.id, p_fingerprint: fingerprint, p_payload: payload(), p_reason: reason });
    setBusy(false);
    if (err) {
      setError(err.code === '55000' ? 'A partida foi alterada por outra pessoa enquanto você editava. Recarregue e confira antes de salvar.'
        : err.code === '23505' ? 'Dois gols do mesmo jogador no mesmo minuto. Informe o tempo de cada gol. Nada foi alterado.'
        : err.message || 'Não foi possível salvar a correção. Nada foi alterado.');
      setStep('edit');
      return;
    }
    refreshAdminData();
    onDone();
  }

  if (loading) return <p className="admin-empty-text">Carregando a súmula...</p>;
  if (error && !fingerprint) return <FormError message={error} />;

  const statValue = (key: string, base: number | undefined) => (key in statEdits ? statEdits[key] : base ?? 0);
  const setStat = (key: string, value: string, base: number | undefined) => {
    const n = Math.max(0, Math.round(Number(value) || 0));
    setStatEdits((s) => { const next = { ...s }; if (n === (base ?? 0)) delete next[key]; else next[key] = n; return next; });
  };

  if (step === 'confirm') {
    return (
      <div className="match-edit">
        <h4>Confirmar correção</h4>
        <ul className="match-edit-summary">
          <li>Placar: <strong>{original.home} × {original.away}</strong> → <strong>{score.home} × {score.away}</strong>{original.home === score.home && original.away === score.away ? ' (sem mudança)' : ''}</li>
          {goalsChanged && <li>Gols e assistências: {(JSON.parse(original.goals) as unknown[]).length} → {goals.length} gol(s), com autores e tempos revisados</li>}
          {keepersChanged && <li>Goleiros alterados</li>}
          {durationChanged && <li>Duração: {original.duration ? formatClock(original.duration) : '—'} → {durationSeconds ? formatClock(durationSeconds) : '—'}</li>}
          {statsChanged && <li>{Object.keys(statEdits).length} estatística(s) da gravação corrigida(s)</li>}
        </ul>
        <p className="match-edit-note">Classificação, artilharia, assistências, gols contra, CS e perfis são recalculados automaticamente. O estado atual fica guardado no histórico da partida.</p>
        <label className="match-edit-reason">Motivo da correção (obrigatório)
          <textarea className="form-input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: placar conferido com a gravação do 2º tempo" />
        </label>
        <FormError message={error} />
        <div className="admin-list-actions">
          <button type="button" className="button button-primary" disabled={busy || reason.trim().length < 3} onClick={() => void save()}>{busy ? 'Salvando...' : 'Salvar correção'}</button>
          <button type="button" className="button button-outline" disabled={busy} onClick={() => setStep('edit')}>Voltar e revisar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="match-edit">
      <div className="match-edit-score">
        <span>{homeName}</span><strong>{score.home} × {score.away}</strong><span>{awayName}</span>
      </div>
      <p className="match-edit-note">O placar é calculado pelos gols abaixo. No gol contra, escolha o jogador que marcou contra o próprio time: o gol vale para o adversário e não conta como gol do jogador.</p>

      <div className="table-scroll">
        <table className="replay-table match-edit-table">
          <thead><tr><th>Tempo</th><th>Gol para</th><th>Gol contra</th><th>Autor</th><th>Assistência</th><th /></tr></thead>
          <tbody>
            {goals.map((g) => {
              const authors = g.ownGoal ? rosterOf(other(g.side)) : rosterOf(g.side);
              return (
                <tr key={g.key}>
                  <td><input className="match-edit-minute" value={g.minute} placeholder="m:ss" onChange={(e) => update(g.key, { minute: e.target.value })} aria-label="Tempo do gol" /></td>
                  <td>
                    <select value={g.side} onChange={(e) => update(g.key, { side: e.target.value as Side, playerId: '', assistId: '' })} aria-label="Equipe que recebe o gol">
                      <option value="home">{homeName}</option><option value="away">{awayName}</option>
                    </select>
                  </td>
                  <td><input type="checkbox" checked={g.ownGoal} onChange={(e) => update(g.key, { ownGoal: e.target.checked, playerId: '', assistId: '' })} aria-label="Gol contra" /></td>
                  <td>
                    <select value={g.playerId} onChange={(e) => update(g.key, { playerId: e.target.value })} aria-label="Autor do gol">
                      <option value="">Sem autor informado</option>
                      {authors.map((r) => <option key={r.player_id} value={r.player_id}>{r.player?.nickname ?? r.player_id}{g.ownGoal ? ` (${g.side === 'home' ? awayName : homeName})` : ''}</option>)}
                    </select>
                  </td>
                  <td>
                    {g.ownGoal ? '—' : (
                      <select value={g.assistId} disabled={!g.playerId} onChange={(e) => update(g.key, { assistId: e.target.value })} aria-label="Assistência">
                        <option value="">Sem assistência</option>
                        {rosterOf(g.side).filter((r) => r.player_id !== g.playerId).map((r) => <option key={r.player_id} value={r.player_id}>{r.player?.nickname ?? r.player_id}</option>)}
                      </select>
                    )}
                  </td>
                  <td><button type="button" className="icon-button" title="Remover gol" onClick={() => setGoals((list) => list.filter((x) => x.key !== g.key))}><Trash2 size={14} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="admin-list-actions match-edit-add">
        {(['home', 'away'] as const).map((side) => (
          <button key={side} type="button" className="button button-outline" onClick={() => setGoals((list) => [...list, { key: nextKey++, side, playerId: '', ownGoal: false, minute: '', assistId: '', period: 'REGULATION', metadata: null }])}>
            <Plus size={14} /> Gol para {side === 'home' ? homeName : awayName}
          </button>
        ))}
      </div>

      <div className="match-edit-grid">
        {(['home', 'away'] as const).map((side) => (
          <label key={side}>Goleiro de {side === 'home' ? homeName : awayName}
            <select value={keepers[side]} onChange={(e) => setKeepers((k) => ({ ...k, [side]: e.target.value }))}>
              <option value="">Nenhum (CS não registrado)</option>
              {rosterOf(side).filter((r) => r.player?.position === 'Goleiro').map((r) => <option key={r.player_id} value={r.player_id}>{r.player?.nickname}</option>)}
            </select>
          </label>
        ))}
        <label>Duração (m:ss)
          <input className="form-input" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="14:00" />
        </label>
      </div>

      {report && (
        <details className="match-edit-stats">
          <summary>Estatísticas extraídas da gravação</summary>
          <div className="table-scroll">
            <table className="replay-table">
              <thead><tr><th>Jogador</th>{STAT_FIELDS.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
              <tbody>
                {report.players.map((p, i) => (
                  <tr key={i}>
                    <td>{p.name}{!p.identified && ' (não identificado)'}</td>
                    {STAT_FIELDS.map(([field]) => (
                      <td key={field}><input className="match-edit-number" type="number" min={0} value={statValue(`p:${i}:${field}`, p.stats[field])} onChange={(e) => setStat(`p:${i}:${field}`, e.target.value, p.stats[field])} aria-label={`${field} de ${p.name}`} /></td>
                    ))}
                  </tr>
                ))}
                {(['home', 'away'] as const).map((side) => (
                  <tr key={side} className="match-edit-team-row">
                    <td>{side === 'home' ? homeName : awayName} (equipe)</td>
                    {STAT_FIELDS.map(([field]) => (
                      <td key={field}>{TEAM_FIELDS.some(([f]) => f === field)
                        ? <input className="match-edit-number" type="number" min={0} value={statValue(`t:${side}:${field}`, report.teams[side]?.[field])} onChange={(e) => setStat(`t:${side}:${field}`, e.target.value, report.teams[side]?.[field])} aria-label={`${field} de ${side}`} />
                        : '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <FormError message={error} />
      <div className="admin-list-actions">
        <button type="button" className="button button-primary" disabled={!changed} onClick={() => { const v = validate(); if (v) { setError(v); return; } setError(null); setStep('confirm'); }}>Revisar e salvar</button>
        <button type="button" className="button button-outline" onClick={() => setShowHistory((s) => !s)}><History size={14} /> Histórico ({history.length})</button>
      </div>
      {showHistory && (
        history.length === 0 ? <p className="admin-empty-text">Nenhuma alteração registrada nesta partida.</p> : (
          <ul className="match-edit-history">
            {history.map((h) => (
              <li key={h.id}>
                <span>{new Date(h.created_at).toLocaleString('pt-BR')}</span>
                <strong>{h.actor ? names[h.actor] ?? 'Administrador' : 'Sistema'}</strong>
                {h.source === 'REPLAY' ? ' · súmula refeita pela gravação' : ''}
                {h.changes.score_before && h.changes.score_after ? ` · placar ${h.changes.score_before.join(' × ')} → ${h.changes.score_after.join(' × ')}` : ''}
                {h.changes.goals_before !== undefined ? ` · gols ${h.changes.goals_before} → ${h.changes.goals_after}` : ''}
                {h.changes.goalkeepers_changed ? ' · goleiros' : ''}
                {h.changes.statistics_changed ? ' · estatísticas' : ''}
                <em> — {h.reason}</em>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
