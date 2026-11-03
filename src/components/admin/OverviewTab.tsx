import { CalendarDays, CircleUserRound, Users, Trophy, ClipboardList } from 'lucide-react';
import { useCompetitions, usePlayers, useSeasons, useTeams } from '@/lib/hooks';

export function OverviewTab() {
  const { competitions } = useCompetitions();
  const { seasons } = useSeasons();
  const { teams } = useTeams();
  const { players } = usePlayers();
  const cards: [string, number, typeof ClipboardList][] = [
    ['Competições', competitions.length, Trophy],
    ['Temporadas', seasons.length, CalendarDays],
    ['Times', teams.length, Users],
    ['Jogadores', players.length, CircleUserRound],
  ];
  return (
    <>
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
          <p>Use as abas acima para gerenciar competições, temporadas, times, jogos, goleiros e streamers.</p>
        </div>
      </div>
    </>
  );
}
