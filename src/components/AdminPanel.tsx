import { useState } from 'react';
import { BadgeCheck, CalendarDays, CircleUserRound, ClipboardList, Crown, Flag, Goal, Hand, LayoutDashboard, ListOrdered, Mic, Shirt, Swords, Trophy, UserCog, Users } from 'lucide-react';
import type { Profile } from '@/lib/supabase';
import { ThemeToggle } from '@/lib/theme';
import { OverviewTab } from '@/components/admin/OverviewTab';
import { CompetitionsTab } from '@/components/admin/CompetitionsTab';
import { SeasonsTab } from '@/components/admin/SeasonsTab';
import { TeamsTab } from '@/components/admin/TeamsTab';
import { PlayersTab } from '@/components/admin/PlayersTab';
import { RegistrationsTab } from '@/components/admin/RegistrationsTab';
import { RostersTab } from '@/components/admin/RostersTab';
import { StagesTab } from '@/components/admin/StagesTab';
import { MatchesTab } from '@/components/admin/MatchesTab';
import { RoundsAdminTab } from '@/components/admin/RoundsAdminTab';
import { EventsTab } from '@/components/admin/EventsTab';
import { GoalkeepersTab } from '@/components/admin/GoalkeepersTab';
import { StreamersTab } from '@/components/admin/StreamersTab';
import { HallOfFameTab } from '@/components/admin/HallOfFameTab';
import { OrganizersTab, UsersTab } from '@/components/admin/UsersTab';

type Tab = 'overview' | 'competitions' | 'seasons' | 'teams' | 'players' | 'registrations' | 'rosters' | 'stages' | 'rounds' | 'matches' | 'events' | 'goalkeepers' | 'streamers' | 'hall' | 'organizers' | 'users';

const tabs: { id: Tab; label: string; icon: typeof Trophy; adminOnly?: boolean }[] = [
  { id: 'overview', label: 'Visão geral', icon: LayoutDashboard },
  { id: 'competitions', label: 'Competições', icon: Trophy },
  { id: 'seasons', label: 'Temporadas', icon: CalendarDays },
  { id: 'teams', label: 'Times', icon: Users, adminOnly: true },
  { id: 'players', label: 'Jogadores', icon: CircleUserRound, adminOnly: true },
  { id: 'registrations', label: 'Inscrições', icon: ClipboardList },
  { id: 'rosters', label: 'Elencos', icon: Shirt },
  { id: 'stages', label: 'Fases & Rodadas', icon: Flag },
  { id: 'rounds', label: 'Rodadas', icon: ListOrdered },
  { id: 'matches', label: 'Partidas', icon: Swords },
  { id: 'events', label: 'Eventos', icon: Goal },
  { id: 'goalkeepers', label: 'Goleiros', icon: Hand },
  { id: 'streamers', label: 'Streamers', icon: Mic, adminOnly: true },
  { id: 'hall', label: 'Hall da Fama', icon: Crown, adminOnly: true },
  { id: 'organizers', label: 'Organizadores', icon: BadgeCheck, adminOnly: true },
  { id: 'users', label: 'Usuários', icon: UserCog, adminOnly: true },
];

export function AdminPanel({ profile }: { profile: Profile | null }) {
  const [tab, setTab] = useState<Tab>('overview');
  const isAdmin = profile?.role === 'ADMIN';
  const visibleTabs = tabs.filter((item) => isAdmin || !item.adminOnly);

  return (
    <section className="container dashboard-section">
      <div className="dashboard-heading">
        <div>
          <span className="section-kicker">Área administrativa</span>
          <h1>{profile?.display_name || 'Sua conta'}</h1>
          <p>{isAdmin ? 'Gerencie toda a plataforma, incluindo competições, cadastros, partidas e permissões.' : 'Gerencie as competições que foram atribuídas à sua conta.'}</p>
        </div>
        <div className="dashboard-heading-actions"><ThemeToggle withLabel /><span className="role-badge">{profile?.role || 'USER'}</span></div>
      </div>
      <div className="admin-tabs">
        {visibleTabs.map((item) => (
          <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>
            <item.icon size={15} /> {item.label}
          </button>
        ))}
      </div>
      <div className="admin-content">
        {tab === 'overview' && <OverviewTab />}
        {tab === 'competitions' && <CompetitionsTab />}
        {tab === 'seasons' && <SeasonsTab />}
        {tab === 'teams' && isAdmin && <TeamsTab />}
        {tab === 'players' && isAdmin && <PlayersTab />}
        {tab === 'registrations' && <RegistrationsTab />}
        {tab === 'rosters' && <RostersTab />}
        {tab === 'stages' && <StagesTab />}
        {tab === 'rounds' && <RoundsAdminTab />}
        {tab === 'matches' && <MatchesTab />}
        {tab === 'events' && <EventsTab />}
        {tab === 'goalkeepers' && <GoalkeepersTab />}
        {tab === 'streamers' && isAdmin && <StreamersTab />}
        {tab === 'hall' && isAdmin && <HallOfFameTab />}
        {tab === 'organizers' && isAdmin && <OrganizersTab />}
        {tab === 'users' && isAdmin && <UsersTab currentUserId={profile?.id ?? ''} />}
      </div>
    </section>
  );
}
