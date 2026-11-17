import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { LoadingCard } from '@/components/ui';
import { useAdminDataVersion } from '@/lib/adminRefresh';

type TeamTotals = { played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number };

export function TeamRecordStats({ teamId }: { teamId: string }) {
  const [record, setRecord] = useState<TeamTotals | null>(null);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();

  useEffect(() => {
    let active = true;
    setRecord(null);
    setError(false);
    async function load() {
      const empty: TeamTotals = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 };
      const { data, error: queryError } = await supabase
        .from('team_competition_statistics')
        .select('played, wins, draws, losses, goals_for, goals_against')
        .eq('team_id', teamId);
      if (!active) return;
      if (queryError) { setError(true); return; }
      const result = ((data || []) as { played: number; wins: number; draws: number; losses: number; goals_for: number; goals_against: number }[])
        .reduce<TeamTotals>((totals, row) => ({
          played: totals.played + row.played,
          wins: totals.wins + row.wins,
          draws: totals.draws + row.draws,
          losses: totals.losses + row.losses,
          goalsFor: totals.goalsFor + row.goals_for,
          goalsAgainst: totals.goalsAgainst + row.goals_against,
        }), empty);
      setRecord(result);
    }
    load();
    return () => { active = false; };
  }, [teamId, refreshVersion]);

  if (error) return <p className="admin-hint">Não foi possível carregar as estatísticas.</p>;
  if (!record) return <LoadingCard />;
  return (
    <div className="stat-grid">
      <div><span>Partidas</span><strong>{record.played}</strong></div>
      <div><span>Vitórias</span><strong>{record.wins}</strong></div>
      <div><span>Empates</span><strong>{record.draws}</strong></div>
      <div><span>Derrotas</span><strong>{record.losses}</strong></div>
      <div><span>Gols marcados</span><strong>{record.goalsFor}</strong></div>
      <div><span>Gols sofridos</span><strong>{record.goalsAgainst}</strong></div>
      <div><span>Saldo</span><strong>{record.goalsFor - record.goalsAgainst}</strong></div>
    </div>
  );
}
