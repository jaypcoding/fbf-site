import { useState } from 'react';
import { AlertTriangle, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { supabase, type Competition } from '@/lib/supabase';
import { refreshAdminData } from '@/lib/adminRefresh';
import { competitionStatusLabels } from '@/lib/labels';
import {
  describeResetError,
  isStaleResetError,
  resetConfirmationMatches,
  resetRows,
  resetTotal,
  type ResetPreview,
  type ResetResult,
} from '@/lib/competitionReset';
import { FormError, FormInput, LoadingCard, Modal } from '@/components/ui';
import { CompetitionRestartDialog } from '@/components/admin/CompetitionRestartDialog';

type Props = { competitions: Competition[]; onClose: () => void };

// Reset of the selected competitions: choose, see the database preview (what
// is removed, what is kept, or why it is blocked), type the confirmation and
// let the database revalidate and remove everything in one transaction.
export function CompetitionResetDialog({ competitions, onClose }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResetResult | null>(null);
  const [restarting, setRestarting] = useState(false);

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function loadPreview() {
    setLoading(true); setError(null); setStale(false); setTyped('');
    const { data, error: err } = await supabase.rpc('reset_competitions_preview', { p_competition_ids: selected });
    setLoading(false);
    if (err) { setPreview(null); setError(describeResetError(err)); return; }
    setPreview(data as ResetPreview);
  }

  async function runReset(event: React.FormEvent) {
    event.preventDefault();
    if (!preview || !resetConfirmationMatches(typed, preview.confirmation)) return;
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.rpc('reset_competitions', {
      p_competition_ids: selected, p_confirmation: typed, p_expected_fingerprint: preview.fingerprint,
    });
    setBusy(false);
    if (err) {
      setError(describeResetError(err));
      setStale(isStaleResetError(err.message));
      return;
    }
    setResult(data as ResetResult);
    refreshAdminData();
  }

  if (restarting && selected.length === 1) {
    const competition = competitions.find((c) => c.id === selected[0]) ?? { id: selected[0], name: 'Competição' };
    return <CompetitionRestartDialog competition={competition} onClose={onClose} />;
  }

  return (
    <Modal title="Reset geral de competições" onClose={onClose}>
      <div className="deletion-dialog">
        {result ? (
          <>
            <p className="deletion-done" role="status">
              Reset concluído: {result.logs.length} competição(ões) e {resetTotal(result.totals)} registro(s) removidos.
              Times ({result.preserved.teams}) e jogadores ({result.preserved.players}) foram preservados sem alteração.
              Cada competição ficou registrada na auditoria e pode ser restaurada pela administração do banco.
            </p>
            <button type="button" className="button button-primary" onClick={onClose}>Fechar</button>
          </>
        ) : !preview ? (
          <>
            <p className="deletion-intro">
              Selecione as competições que serão apagadas por completo, inclusive partidas já disputadas, gols, assistências,
              goleiros, grupos, temporadas, inscrições e elencos. <strong>Times e jogadores nunca são apagados.</strong>
            </p>
            <div className="reset-choices" role="group" aria-label="Competições para o reset">
              {competitions.map((competition) => (
                <label key={competition.id} className="reset-choice">
                  <input type="checkbox" checked={selected.includes(competition.id)} onChange={() => toggle(competition.id)} />
                  <span><strong>{competition.name}</strong> · {competition.category} · {competitionStatusLabels[competition.status as Competition['status']] ?? competition.status}</span>
                </label>
              ))}
            </div>
            <FormError message={error} />
            <div className="deletion-actions">
              <button type="button" className="button" onClick={onClose}>Cancelar</button>
              <button type="button" className="button button-primary" disabled={selected.length === 0 || loading} onClick={() => void loadPreview()}>
                {loading ? 'Carregando...' : `Ver prévia (${selected.length})`}
              </button>
            </div>
          </>
        ) : loading ? <LoadingCard /> : (
          <>
            {!preview.can_reset ? (
              <div className="deletion-blocked" role="alert">
                <strong><AlertTriangle size={15} /> Reset bloqueado</strong>
                <ul>{preview.blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul>
                {preview.blockers.some((b) => b.code === 'HAS_HISTORY') && (selected.length === 1 ? (
                  <button type="button" className="button button-outline button-small" onClick={() => setRestarting(true)}>Abrir o reinício auditado desta competição</button>
                ) : <p>O reinício auditado é feito uma competição por vez: selecione só a competição com histórico.</p>)}
              </div>
            ) : (
              <form onSubmit={runReset}>
                <p className="deletion-intro">Serão removidos definitivamente {resetTotal(preview.totals)} registro(s) de {preview.competitions.length} competição(ões):</p>
                <ul className="reset-summary">
                  {preview.competitions.map((competition) => (
                    <li key={competition.id}>
                      <strong>{competition.name}</strong> ({competitionStatusLabels[competition.status as Competition['status']] ?? competition.status}) — {resetTotal(competition.counts)} registro(s)
                      {competition.finished_matches > 0 ? `, ${competition.finished_matches} partida(s) finalizada(s)` : ''}
                    </li>
                  ))}
                </ul>
                <table className="deletion-table">
                  <tbody>
                    {resetRows(preview.totals).map((row) => <tr key={row.key}><td>{row.label}</td><td>{row.count}</td></tr>)}
                  </tbody>
                </table>
                <p className="reset-preserved"><ShieldCheck size={15} /> Preservados: {preview.preserved.teams} times e {preview.preserved.players} jogadores (conferidos antes e depois).</p>
                <label className="deletion-confirm">
                  Para confirmar, digite exatamente: <strong>{preview.confirmation}</strong>
                  <FormInput value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" aria-label={`Digite ${preview.confirmation} para confirmar`} />
                </label>
                <FormError message={error} />
                <div className="deletion-actions">
                  {stale && <button type="button" className="button" onClick={() => void loadPreview()}><RefreshCw size={15} /> Atualizar prévia</button>}
                  <button type="button" className="button" onClick={() => setPreview(null)}>Voltar</button>
                  <button className="button button-danger" disabled={busy || stale || !resetConfirmationMatches(typed, preview.confirmation)}>
                    <RotateCcw size={15} /> {busy ? 'Executando reset...' : 'Executar reset'}
                  </button>
                </div>
              </form>
            )}
            {!preview.can_reset && (
              <div className="deletion-actions">
                <button type="button" className="button" onClick={() => setPreview(null)}>Voltar</button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
