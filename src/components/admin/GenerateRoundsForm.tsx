import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSeasonTeams } from '@/lib/hooks';
import { buildRoundRobin } from '@/lib/roundRobin';
import { FormError } from '@/components/ui';

type Props = { stageId: string; seasonId: string };

export function GenerateRoundsForm({ stageId, seasonId }: Props) {
  const { seasonTeams, loading } = useSeasonTeams(seasonId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const plan = buildRoundRobin(seasonTeams.map((st) => st.id));
  const matchCount = plan.reduce((total, round) => total + round.length, 0);

  async function generate() {
    if (plan.length === 0) return;
    if (!window.confirm(`Gerar ${plan.length} rodadas com ${matchCount} partidas? A operação será transacional e não alterará partidas já existentes.`)) return;
    setBusy(true); setError(null);
    const { data, error: generationError } = await supabase.rpc('generate_round_robin', { p_stage_id: stageId });
    setBusy(false);
    if (generationError) {
      setError(generationError.message || 'Não foi possível gerar os confrontos. Partidas existentes foram preservadas.');
      return;
    }
    const result = data as { rounds?: number; matches?: number; already_generated?: boolean } | null;
    if (result?.already_generated) {
      setError('Todos os confrontos desta fase já foram gerados; nenhuma partida foi duplicada.');
      return;
    }
    window.location.reload();
  }

  return (
    <div className="generate-rounds">
      <div className="admin-divider" />
      <h3>Gerar confrontos</h3>
      {loading ? null : seasonTeams.length < 2 ? (
        <p className="admin-hint">Inscreva pelo menos dois times nesta temporada para gerar as rodadas.</p>
      ) : (
        <>
          <p className="admin-hint">Cada time enfrenta todos os outros uma vez: {plan.length} rodadas e {matchCount} partidas para {seasonTeams.length} times.</p>
          <FormError message={error} />
          <button className="button button-primary" disabled={busy} onClick={generate}>{busy ? 'Gerando...' : 'Gerar rodadas automaticamente'} <ArrowRight size={16} /></button>
        </>
      )}
    </div>
  );
}
