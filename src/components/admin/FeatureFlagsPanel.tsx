// "Publicação de recursos" (admins only): turns the MVP on or off for visitors
// through set_feature_flag(), which checks the admin role, requires a reason
// and keeps the history. While off, visitors can neither see nor read the MVP
// through the API; organizers keep the preview on the match page.
import { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { resetFeatureCache } from '@/lib/features';
import { FormError } from '@/components/ui';

type Change = { enabled: boolean; reason: string; changed_at: string };

export function FeatureFlagsPanel() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'ADMIN';
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [flag, hist] = await Promise.all([
      supabase.from('feature_flags').select('enabled').eq('key', 'mvp_public').maybeSingle(),
      supabase.from('feature_flag_changes').select('enabled, reason, changed_at').eq('key', 'mvp_public').order('changed_at', { ascending: false }).limit(5),
    ]);
    setEnabled(flag.data ? (flag.data as { enabled: boolean }).enabled : false);
    setChanges((hist.data ?? []) as Change[]);
  }
  useEffect(() => { if (isAdmin) void load(); }, [isAdmin]);

  if (!isAdmin || enabled === null) return null;
  const next = !enabled;

  async function apply() {
    if (reason.trim().length < 3) { setError('Informe o motivo.'); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('set_feature_flag', { p_key: 'mvp_public', p_enabled: next, p_reason: reason.trim() });
    setBusy(false);
    if (err) { setError(err.message || 'Não foi possível alterar.'); return; }
    resetFeatureCache();
    setConfirming(false);
    setReason('');
    await load();
  }

  return (
    <section className="feature-flags">
      <h2><Award size={18} aria-hidden="true" /> Publicação do MVP</h2>
      <p>
        Situação: <strong className={enabled ? 'is-on' : 'is-off'}>{enabled ? 'publicado para visitantes' : 'não publicado'}</strong>.
        {' '}{enabled ? 'Visitantes veem o MVP nas partidas, perfis e rankings.' : 'Visitantes não veem nem conseguem consultar o MVP; a organização vê uma prévia na página de cada partida.'}
      </p>
      {!confirming ? (
        <button type="button" className={`button ${enabled ? 'button-outline' : 'button-primary'}`} onClick={() => setConfirming(true)}>{enabled ? 'Despublicar o MVP' : 'Publicar o MVP'}</button>
      ) : (
        <div className="feature-flags-confirm">
          <p>{next ? 'Antes de publicar, confira se as escalações e as revisões de W.O. das partidas antigas foram concluídas.' : 'Ao despublicar, o MVP some do site e da consulta pública imediatamente.'}</p>
          <label className="lineup-reason"><span>Motivo</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={next ? 'Ex.: escalações revisadas pela organização' : 'Ex.: revisão de uma partida'} maxLength={300} /></label>
          <FormError message={error} />
          <div className="deletion-actions">
            <button type="button" className="button button-outline" onClick={() => { setConfirming(false); setError(null); }}>Cancelar</button>
            <button type="button" className="button button-primary" disabled={busy} onClick={() => void apply()}>{busy ? 'Salvando...' : next ? 'Confirmar publicação' : 'Confirmar despublicação'}</button>
          </div>
        </div>
      )}
      {changes.length > 0 && (
        <ul className="feature-flags-history">
          {changes.map((c) => <li key={c.changed_at}>{new Date(c.changed_at).toLocaleString('pt-BR')} · {c.enabled ? 'publicado' : 'despublicado'} · {c.reason}</li>)}
        </ul>
      )}
    </section>
  );
}
