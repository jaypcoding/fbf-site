import { CalendarDays, CircleUserRound, Users, Trophy, ClipboardList } from 'lucide-react';
import { useCompetitions, usePlayers, useSeasons, useTeams } from '@/lib/hooks';
import { FormError } from '@/components/ui';

export function OverviewTab() {
  const { competitions, error: competitionsError } = useCompetitions();
  const { seasons, error: seasonsError } = useSeasons(undefined, true);
  const { teams, error: teamsError } = useTeams();
  const { players, error: playersError } = usePlayers();
  const cards: [string, number, typeof ClipboardList][] = [
    ['Competições', competitions.length, Trophy],
    ['Temporadas', seasons.length, CalendarDays],
    ['Times', teams.length, Users],
    ['Jogadores', players.length, CircleUserRound],
  ];
  return (
    <>
      {(competitionsError || seasonsError || teamsError || playersError) && <FormError message="Alguns indicadores não puderam ser carregados. Consulte as abas correspondentes para verificar os dados." />}
      <div className="dashboard-cards">
        {cards.map(([label, value, Icon]) => (
          <div className="dashboard-card" key={label}>
            <Icon size={18} />
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="admin-empty">
        <div className="admin-empty-icon"><Trophy /></div>
        <div>
          <h2>Seu centro de comando</h2>
          <p>Use as abas acima para administrar competições, inscrições, elencos, fases, partidas e eventos.</p>
        </div>
      </div>
    </>
  );
}
