import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { refreshAdminData } from '@/lib/adminRefresh';
import {
  DELETION_KIND_LABELS,
  confirmationMatches,
  deletionRows,
  deletionTotal,
  describeDeletionError,
  isStalePreviewError,
  type DeletionKind,
  type DeletionPreview,
  type DeletionResult,
} from '@/lib/deletion';
import { FormError, FormInput, LoadingCard, Modal } from '@/components/ui';

type Props = { kind: DeletionKind; id: string; onClose: () => void };

// Shows the database preview of a deletion (what will be removed, or why it is
// blocked), asks for the record name and lets the database revalidate it all.
export function DeleteRecordDialog({ kind, id, onClose }: Props) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeletionResult | null>(null);
  const label = DELETION_KIND_LABELS[kind];

  const load = useCallback(async () => {
    setLoading(true); setError(null); setStale(false); setTyped('');
    const { data, error: err } = await supabase.rpc('deletion_preview', { p_kind: kind, p_id: id });
    setLoading(false);
    if (err) { setPreview(null); setError(describeDeletionError(err)); return; }
    setPreview(data as DeletionPreview);
  }, [kind, id]);

  useEffect(() => { void load(); }, [load]);

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    if (!preview || !confirmationMatches(typed, preview.name)) return;
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.rpc('delete_competition_record', {
      p_kind: kind, p_id: id, p_confirmation: typed, p_expected_fingerprint: preview.fingerprint,
    });
    setBusy(false);
    if (err) {
      setError(describeDeletionError(err));
      setStale(isStalePreviewError(err.message));
      return;
    }
    setResult(data as DeletionResult);
    refreshAdminData();
  }

  return (
    <Modal title={`Excluir ${label}`} onClose={onClose}>
      <div className="deletion-dialog">
        {loading ? <LoadingCard /> : result ? (
          <>
            <p className="deletion-done" role="status">“{result.name}” foi excluída com {deletionTotal(result.counts)} registro(s). A exclusão ficou registrada na auditoria e pode ser restaurada pela administração do banco.</p>
            <button type="button" className="button button-primary" onClick={onClose}>Fechar</button>
          </>
        ) : !preview ? (
          <FormError message={error} />
        ) : (
          <>
            <p className="deletion-path">{preview.path}</p>
            {!preview.can_delete ? (
              <div className="deletion-blocked" role="alert">
                <strong><AlertTriangle size={15} /> Exclusão bloqueada</strong>
                <p>Este registro contém dados que precisam ser preservados:</p>
                <ul>{preview.blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}</ul>
              </div>
            ) : (
              <form onSubmit={remove}>
                <p className="deletion-intro">Serão removidos definitivamente {deletionTotal(preview.counts)} registro(s):</p>
                <table className="deletion-table">
                  <tbody>
                    {deletionRows(preview.counts).map((row) => <tr key={row.key}><td>{row.label}</td><td>{row.count}</td></tr>)}
                  </tbody>
                </table>
                {preview.warnings.length > 0 && <ul className="deletion-warnings">{preview.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
                <label className="deletion-confirm">
                  Para confirmar, digite o nome exato: <strong>{preview.name}</strong>
                  <FormInput value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" aria-label={`Digite ${preview.name} para confirmar`} />
                </label>
                <FormError message={error} />
                <div className="deletion-actions">
                  {stale && <button type="button" className="button" onClick={() => void load()}><RefreshCw size={15} /> Atualizar prévia</button>}
                  <button type="button" className="button" onClick={onClose}>Cancelar</button>
                  <button className="button button-danger" disabled={busy || stale || !confirmationMatches(typed, preview.name)}>
                    <Trash2 size={15} /> {busy ? 'Excluindo...' : `Excluir ${label}`}
                  </button>
                </div>
              </form>
            )}
            {!preview.can_delete && <div className="deletion-actions"><button type="button" className="button" onClick={onClose}>Fechar</button></div>}
          </>
        )}
      </div>
    </Modal>
  );
}
