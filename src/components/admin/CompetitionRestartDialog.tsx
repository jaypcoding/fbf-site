// Audited restart of ONE competition with protected history (lineups, replay
// sheets, match edits, MVP reviews, Hall da Fama drafts). The ordinary reset
// refuses such a competition; this procedure, only for admins, shows what will
// be archived and removed, requires a detailed reason and the typed
// confirmation, and lets the database archive the history, run the same safe
// reset and keep everything restorable (competition_restart_archive +
// deletion_log), in one transaction.
import { useEffect, useState } from 'react';
import { AlertTriangle, Archive, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { supabase, type Competition } from '@/lib/supabase';
import { refreshAdminData } from '@/lib/adminRefresh';
import { describeResetError, isStaleResetError, resetConfirmationMatches, resetRows, resetTotal } from '@/lib/competitionReset';
import { FormError, FormInput, LoadingCard, Modal } from '@/components/ui';

type RestartPreview = {
  competition: { id: string; name: string; status: string };
  history: Record<string, number>;
  history_total: number;
  aliases_relinked: number;
  reset: Record<string, number>;
  blockers: { code: string; message: string }[];
  can_restart: boolean;
  confirmation: string;
  fingerprint: string;
};
type RestartResult = { archive_id: string; history: Record<string, number>; reset: { totals: Record<string, number>; preserved: { teams: number; players: number } } };

const HISTORY_LABELS: Record<string, string> = {
  match_participations: 'Escalações registradas',
  match_edit_history: 'Histórico de edições das partidas',
  match_mvp_reviews: 'Revisões de MVP (W.O.)',
  match_replays: 'Gravações enviadas (os arquivos ficam guardados)',
  match_replay_reviews: 'Revisões de súmula por gravação',
  match_replay_reports: 'Relatórios de súmula validados',
  match_replay_audit: 'Histórico das súmulas por gravação',
  season_honours: 'Rascunhos do Hall da Fama',
};
const MIN_REASON = 20;
const sumCounts = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + Number(b), 0);

export function CompetitionRestartDialog({ competition, onClose }: { competition: Pick<Competition, 'id' | 'name'>; onClose: () => void }) {
  const [preview, setPreview] = useState<RestartPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RestartResult | null>(null);

  async function load() {
    setLoading(true); setError(null); setStale(false); setTyped('');
    const { data, error: err } = await supabase.rpc('competition_restart_preview', { p_competition_id: competition.id });
    setLoading(false);
    if (err) { setPreview(null); setError(describeResetError(err)); return; }
    setPreview(data as RestartPreview);
  }
  useEffect(() => { void load(); }, [competition.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (!preview || !resetConfirmationMatches(typed, preview.confirmation) || reason.trim().length < MIN_REASON) return;
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.rpc('restart_competition_audited', {
      p_competition_id: competition.id, p_confirmation: typed, p_expected_fingerprint: preview.fingerprint, p_reason: reason.trim(),
    });
    setBusy(false);
    if (err) { setError(describeResetError(err)); setStale(isStaleResetError(err.message)); return; }
    setResult(data as RestartResult);
    refreshAdminData();
  }

  const historyRows = preview ? Object.entries(preview.history).filter(([, n]) => n > 0) : [];

  return (
    <Modal title={`Reinício auditado: ${competition.name}`} onClose={onClose}>
      <div className="deletion-dialog">
        {result ? (
          <>
            <p className="deletion-done" role="status">
              Reinício concluído. {sumCounts(result.history)} registro(s) de histórico foram arquivados e {resetTotal(result.reset.totals)} registro(s) da competição removidos.
              Times ({result.reset.preserved.teams}) e jogadores ({result.reset.preserved.players}) foram preservados sem alteração.
              Tudo ficou guardado no arquivo de reinícios (código {result.archive_id.slice(0, 8)}) com o motivo e pode ser restaurado pela administração do banco.
            </p>
            <button type="button" className="button button-primary" onClick={onClose}>Fechar</button>
          </>
        ) : loading ? <LoadingCard /> : !preview ? (
          <>
            <FormError message={error} />
            <div className="deletion-actions"><button type="button" className="button" onClick={onClose}>Fechar</button></div>
          </>
        ) : (
          <form onSubmit={run}>
            <p className="deletion-intro">
              Procedimento para <strong>corrigir ou reiniciar uma competição que já tem histórico protegido</strong>. O reset comum continua bloqueado para ela.
              Aqui, o histórico abaixo é <strong>arquivado</strong> antes, com o motivo, e depois a competição passa pelo mesmo reset seguro. Nada se perde: tudo pode ser restaurado.
            </p>
            {historyRows.length > 0 && (
              <>
                <h4 className="restart-heading"><Archive size={15} aria-hidden="true" /> Histórico que será arquivado ({preview.history_total})</h4>
                <table className="deletion-table"><tbody>
                  {historyRows.map(([key, n]) => <tr key={key}><td>{HISTORY_LABELS[key] ?? key}</td><td>{n}</td></tr>)}
                </tbody></table>
              </>
            )}
            <h4 className="restart-heading"><RotateCcw size={15} aria-hidden="true" /> Registros da competição que serão removidos ({resetTotal(preview.reset)})</h4>
            <table className="deletion-table"><tbody>
              {resetRows(preview.reset).map((row) => <tr key={row.key}><td>{row.label}</td><td>{row.count}</td></tr>)}
            </tbody></table>
            <p className="reset-preserved"><ShieldCheck size={15} /> Times, jogadores, streamers, contas, arquivos de gravação e o histórico do Hall da Fama nunca são apagados.</p>
            {!preview.can_restart ? (
              <div className="deletion-blocked" role="alert">
                <strong><AlertTriangle size={15} /> Reinício bloqueado</strong>
                <ul>{preview.blockers.map((b) => <li key={b.code}>{b.message}</li>)}</ul>
              </div>
            ) : (
              <>
                <label className="deletion-confirm">
                  Motivo do reinício (obrigatório, ao menos {MIN_REASON} caracteres)
                  <textarea className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} placeholder="Ex.: final registrada com a equipe errada; a organização decidiu reiniciar a competição" />
                </label>
                <label className="deletion-confirm">
                  Para confirmar, digite exatamente: <strong>{preview.confirmation}</strong>
                  <FormInput value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label={`Digite ${preview.confirmation} para confirmar`} />
                </label>
              </>
            )}
            <FormError message={error} />
            <div className="deletion-actions">
              {stale && <button type="button" className="button" onClick={() => void load()}><RefreshCw size={15} /> Atualizar prévia</button>}
              <button type="button" className="button" onClick={onClose}>Cancelar</button>
              {preview.can_restart && (
                <button className="button button-danger" disabled={busy || stale || reason.trim().length < MIN_REASON || !resetConfirmationMatches(typed, preview.confirmation)}>
                  <RotateCcw size={15} /> {busy ? 'Arquivando e reiniciando...' : 'Arquivar e reiniciar'}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
