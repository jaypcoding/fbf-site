import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { LoadingCard } from '@/components/ui';

export function PlayerCareerStats({ playerId }: { playerId: string }) {
  const [totals, setTotals] = useState<{ goals: number; assists: number } | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.from('player_career_statistics').select('goals, assists').eq('player_id', playerId).maybeSingle().then(({ data, error: err }) => {
    if (!active) return;
    if (err) { setError(true); return; }
    setTotals({
      goals: data?.goals ?? 0,
      assists: data?.assists ?? 0,
    });
    });
    return () => { active = false; };
  }, [playerId]);

  if (error) return <p className="admin-hint">Não foi possível carregar as estatísticas.</p>;
  if (!totals) return <LoadingCard />;
  return (
    <div className="stat-grid">
      <div><span>Gols na carreira</span><strong>{totals.goals}</strong></div>
      <div><span>Assistências na carreira</span><strong>{totals.assists}</strong></div>
    </div>
  );
}
