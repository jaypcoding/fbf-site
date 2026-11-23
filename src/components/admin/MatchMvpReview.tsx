// "Situação para o MVP": an organizer identifies an official W.O. or reviews a
// goal registered without author, through review_match_mvp() (permission,
// reason and history checked on the server). It never changes the score, the
// events or the lineup; it only decides whether the MVP of the match is
// calculated (normal / legitimate match) or not (W.O.).
import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { FormError } from '@/components/ui';

type Decision = 'WALKOVER' | 'VALID' | '';

export function MatchMvpReview({ matchId }: { matchId: string }) {
  const [loading, setLoading] = useState(true);
  const [authorless, setAuthorless] = useState(0);
  const [current, setCurrent] = useState<{ decision: Decision; reason: string } | null>(null);
  const [choice, setChoice] = useState<Decision>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load(spinner = true) {
    if (spinner) setLoading(true);
    const [goals, review] = await Promise.all([
      supabase.from('match_events').select('id', { count: 'exact', head: true }).eq('match_id', matchId).eq('event_type', 'GOAL').is('player_id', null).neq('period', 'PENALTY_SHOOTOUT'),
      supabase.from('match_mvp_reviews').select('decision, reason').eq('match_id', matchId).maybeSingle(),
    ]);
    setAuthorless(goals.count ?? 0);
    const r = review.data as { decision: Decision; reason: string } | null;
    setCurrent(r);
    setChoice(r?.decision ?? '');
    setLoading(false);
  }
  useEffect(() => { void load(); }, [matchId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (reason.trim().length < 3) { setError('Informe o motivo (por exemplo: "W.O. confirmado pela organização").'); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.rpc('review_match_mvp', { p_match_id: matchId, p_decision: choice || null, p_reason: reason.trim() });
    setBusy(false);
    if (err) { setError(err.message || 'Não foi possível salvar a revisão.'); return; }
    setSaved(true);
    setReason('');
    await load(false);
  }

  if (loading) return null;
  const status = current?.decision === 'WALKOVER' ? 'W.O. confirmado: a partida fica sem MVP.'
    : current?.decision === 'VALID' ? 'Partida confirmada como disputada normalmente: o MVP é calculado; o gol sem autor não dá pontos a ninguém.'
    : authorless > 0 ? `MVP pendente: ${authorless === 1 ? 'há 1 gol registrado' : `há ${authorless} gols registrados`} sem autor. Confirme se foi W.O. ou uma partida normal.`
    : 'Eventos completos: o MVP é calculado normalmente.';
  const unchanged = (current?.decision ?? '') === choice;

  return (
    <fieldset className="mvp-review">
      <legend>Situação para o MVP</legend>
      <p className={`lineup-source${authorless > 0 && !current ? ' is-missing' : ''}`}>{status}</p>
      <div className="mvp-review-options" role="radiogroup" aria-label="Situação para o MVP">
        <label><input type="radio" name={`mvp-review-${matchId}`} checked={choice === ''} onChange={() => { setChoice(''); setSaved(false); }} /> {authorless > 0 ? 'Ainda não revisada' : 'Partida normal'}</label>
        <label><input type="radio" name={`mvp-review-${matchId}`} checked={choice === 'WALKOVER'} onChange={() => { setChoice('WALKOVER'); setSaved(false); }} /> W.O. confirmado (sem MVP)</label>
        {authorless > 0 && <label><input type="radio" name={`mvp-review-${matchId}`} checked={choice === 'VALID'} onChange={() => { setChoice('VALID'); setSaved(false); }} /> Partida disputada normalmente (calcular o MVP)</label>}
      </div>
      {!unchanged && (
        <label className="lineup-reason">
          <span>Motivo</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: W.O. confirmado pela organização" maxLength={300} />
        </label>
      )}
      <FormError message={error} />
      {saved && !error && <p className="lineup-saved"><CheckCircle2 size={14} aria-hidden="true" /> Revisão salva e registrada no histórico da partida.</p>}
      {!unchanged && (
        <div className="deletion-actions">
          <button type="button" className="button button-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Salvando...' : 'Salvar situação'}</button>
        </div>
      )}
    </fieldset>
  );
}
