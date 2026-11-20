import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Goal } from 'lucide-react';
import type { Stage } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import { EmptyState, LoadingCard, TeamLogo } from '@/components/ui';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { buildStandingsLayout, type StandingsRow } from '@/lib/standings';

export function StageStandings({ stages }: { stages: Stage[] }) {
  const [selectedStageId, setSelectedStageId] = useState('');
  const [rows, setRows] = useState<StandingsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refreshVersion = useAdminDataVersion();
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
      .select('stage_id, season_team_id, team_id, team_name, team_logo_url, stage_group_id, group_name, played, wins, draws, losses, goals_for, goals_against, points')
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
  }, [selectedStageId, refreshVersion]);

  const layout = useMemo(() => (stage ? buildStandingsLayout(rows, stage) : null), [rows, stage]);
  const standings = layout ? layout.tables.flatMap((table) => table.rows) : [];

  if (error) return <p className="admin-hint">Não foi possível carregar a classificação oficial.</p>;
  if (!stages.length) return <EmptyState icon={<BarChart3 />} title="Fase ainda não configurada" description="A classificação será exibida depois que uma fase for criada." />;
  if (stage?.format === 'Mata-mata') {
    return <EmptyState icon={<Goal />} title="A classificação é eliminatória" description="Acompanhe os confrontos, resultados e avanços na aba Jogos." />;
  }
  if (loading) return <LoadingCard />;
  if (standings.length === 0 || standings.every((row) => row.played === 0)) {
    return <EmptyState icon={<BarChart3 />} title="Sem classificação ainda" description="A tabela considera somente partidas finalizadas com placar oficial." />;
  }

  function renderTable(tableRows: StandingsRow[]) {
    return (
      <div className="standings-table">
        <div className="standings-header"><span>#</span><span>Time</span><span>PJ</span><span>V</span><span>E</span><span>D</span><span>GP</span><span>GC</span><span>SG</span><span>Pts</span></div>
        {tableRows.map((row, index) => {
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
    );
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
      {layout?.mode === 'groups'
        ? layout.tables.map((group) => (
            <section className="content-section standings-group" key={group.key || 'sem-grupo'} aria-label={group.name}>
              <h3>{group.name}</h3>
              {renderTable(group.rows)}
            </section>
          ))
        : (
          <>
            {layout?.mode === 'groups-pending' && (
              <p className="standings-notice" role="note">
                Os grupos desta fase ainda não foram cadastrados. Enquanto isso, a tabela abaixo reúne todas as equipes
                de forma provisória; a classificação por grupo aparece assim que os grupos forem registrados.
              </p>
            )}
            {renderTable(layout?.tables[0]?.rows ?? [])}
          </>
        )}
    </>
  );
}
