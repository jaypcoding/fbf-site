import { useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import type { Stage } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import { EmptyState, LoadingCard, TeamLogo } from '@/components/ui';

type StandingsRow = {
  stage_id: string;
  season_team_id: string;
  team_id: string;
  team_name: string;
  team_logo_url: string | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  points: number;
};

const numericCriteria: Record<string, keyof Pick<StandingsRow, 'points' | 'wins' | 'draws' | 'losses' | 'goals_for' | 'goals_against'>> = {
  POINTS: 'points',
  WINS: 'wins',
  DRAWS: 'draws',
  LOSSES: 'losses',
  GOALS_FOR: 'goals_for',
  GOALS_AGAINST: 'goals_against',
};

export function StageStandings({ stages }: { stages: Stage[] }) {
  const [selectedStageId, setSelectedStageId] = useState('');
  const [rows, setRows] = useState<StandingsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const stage = stages.find((item) => item.id === selectedStageId) ?? null;

  useEffect(() => {
    if (!stages.length) {
      setSelectedStageId('');
      setRows([]);
      setLoading(false);
      return;
    }
    if (!stages.some((item) => item.id === selectedStageId)) {
      setSelectedStageId(stages[0].id);
    }
  }, [stages, selectedStageId]);

  useEffect(() => {
    if (!selectedStageId) return;
    let active = true;
    setLoading(true);
    setError(false);
    supabase
      .from('stage_standings')
      .select('stage_id, season_team_id, team_id, team_name, team_logo_url, played, wins, draws, losses, goals_for, goals_against, points')
      .eq('stage_id', selectedStageId)
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) {
          setError(true);
          setRows([]);
        } else {
          setRows((data || []) as StandingsRow[]);
        }
        setLoading(false);
      });
    return () => { active = false; };
  }, [selectedStageId]);

  const standings = useMemo(() => {
    if (!stage) return [];
    return [...rows].sort((a, b) => {
      for (const criterion of stage.tie_breakers) {
        if (criterion === 'TEAM_NAME') {
          const result = a.team_name.localeCompare(b.team_name, 'pt-BR');
          if (result !== 0) return result;
          continue;
        }
        if (criterion === 'GOAL_DIFF') {
          const result = (b.goals_for - b.goals_against) - (a.goals_for - a.goals_against);
          if (result !== 0) return result;
          continue;
        }
        const key = numericCriteria[criterion];
        if (key && a[key] !== b[key]) return b[key] - a[key];
      }
      return a.team_name.localeCompare(b.team_name, 'pt-BR');
    });
  }, [rows, stage]);

  if (error) return <p className="admin-hint">Não foi possível carregar a classificação oficial.</p>;
  if (!stages.length) return <EmptyState icon={<BarChart3 />} title="Fase ainda não configurada" description="A classificação será exibida depois que uma fase for criada." />;
  if (loading) return <LoadingCard />;
  if (standings.length === 0 || standings.every((row) => row.played === 0)) {
    return <EmptyState icon={<BarChart3 />} title="Sem classificação ainda" description="A tabela considera somente partidas finalizadas com placar oficial." />;
  }

  return (
    <>
      {stages.length > 1 && (
        <label className="form-field">
          <span>Fase</span>
          <select value={selectedStageId} onChange={(event) => setSelectedStageId(event.target.value)}>
            {stages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      )}
      <div className="standings-table">
        <div className="standings-header"><span>#</span><span>Time</span><span>PJ</span><span>V</span><span>E</span><span>D</span><span>GP</span><span>GC</span><span>SG</span><span>Pts</span></div>
        {standings.map((row, index) => {
          const goalDifference = row.goals_for - row.goals_against;
          return (
            <div key={row.season_team_id} className="standings-row">
              <span className="standings-pos">{index + 1}</span>
              <div className="standings-team"><TeamLogo src={row.team_logo_url} name={row.team_name} size={24} /><span>{row.team_name}</span></div>
              <span>{row.played}</span><span>{row.wins}</span><span>{row.draws}</span><span>{row.losses}</span>
              <span>{row.goals_for}</span><span>{row.goals_against}</span>
              <span>{goalDifference > 0 ? `+${goalDifference}` : goalDifference}</span>
              <span className="standings-pts">{row.points}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}
