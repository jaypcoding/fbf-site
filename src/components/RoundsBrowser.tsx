import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Goal, ListOrdered } from 'lucide-react';
import { supabase, type Match, type Stage } from '@/lib/supabase';
import { buildRoundsView, currentRoundIndex, roundStateLabels, type GroupOfTeam, type RoundInfo } from '@/lib/roundsView';
import { plural } from '@/lib/format';
import { EmptyState, LoadingCard } from '@/components/ui';
import { MatchCard } from '@/components/site';

type GroupRow = { stage_group_id: string; season_team_id: string };
type GroupMeta = { id: string; name: string; group_order: number };

/**
 * Every round of the season (played, in progress and future), one at a time
 * with a round navigator, or all of them at once. Knockout rounds stay in the
 * bracket shown above by the page.
 */
export function RoundsBrowser({ stages, matches, selected, onSelect }: {
  stages: Stage[];
  matches: Match[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  const [rounds, setRounds] = useState<RoundInfo[]>([]);
  const [groupOf, setGroupOf] = useState<GroupOfTeam>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const stageKey = stages.map((stage) => stage.id).join(',');

  useEffect(() => {
    let active = true;
    const stageIds = stageKey ? stageKey.split(',') : [];
    if (stageIds.length === 0) { setRounds([]); setLoading(false); return () => { active = false; }; }
    setLoading(true);
    Promise.all([
      supabase.from('rounds').select('id, stage_id, name, round_order, phase_type, leg_number, stage_group:stage_group_id ( name, group_order )').in('stage_id', stageIds),
      supabase.from('stage_groups').select('id, name, group_order').in('stage_id', stageIds),
      supabase.from('stage_group_teams').select('stage_group_id, season_team_id').in('stage_id', stageIds),
    ]).then(([roundsResult, groupsResult, membersResult]) => {
      if (!active) return;
      if (roundsResult.error) { setError(true); setLoading(false); return; }
      const meta = new Map(((groupsResult.data || []) as GroupMeta[]).map((group) => [group.id, group]));
      const map: GroupOfTeam = new Map();
      for (const row of (membersResult.data || []) as GroupRow[]) {
        const group = meta.get(row.stage_group_id);
        if (group) map.set(row.season_team_id, { name: group.name, order: group.group_order });
      }
      setRounds(((roundsResult.data || []) as unknown as RoundInfo[]).filter((round) => round.phase_type !== 'KNOCKOUT'));
      setGroupOf(map);
      setError(false);
      setLoading(false);
    });
    return () => { active = false; };
  }, [stageKey]);

  const views = useMemo(() => buildRoundsView(rounds, matches.filter((match) => match.round?.phase_type !== 'KNOCKOUT'), {
    groupOf,
    stageOrder: new Map(stages.map((stage) => [stage.id, stage.stage_order])),
  }), [rounds, matches, groupOf, stages]);

  if (loading) return <LoadingCard />;
  if (error) return <EmptyState icon={<Goal />} title="Não foi possível carregar as rodadas" description="Tente novamente mais tarde." />;
  if (views.length === 0) {
    return matches.length > 0 ? null : <EmptyState icon={<Goal />} title="Rodadas ainda não publicadas" description="A fase e os grupos já estão definidos. As rodadas e partidas aparecerão aqui assim que a organização publicar a tabela." />;
  }

  const showAll = selected === 'todas';
  const requested = selected && !showAll ? Number(selected) - 1 : Number.NaN;
  const index = Number.isInteger(requested) && requested >= 0 && requested < views.length ? requested : currentRoundIndex(views);
  const current = views[index];
  const go = (next: number) => onSelect(String(next + 1));

  const roundPanel = (view: typeof views[number]) => (
    <div className="round-panel" key={view.round.id}>
      <div className="round-panel-head">
        <h3>{view.label}</h3>
        <span className={`round-state state-${view.state}`}>{roundStateLabels[view.state]}</span>
        {view.total > 0 && <small>{view.finished} de {plural(view.total, 'partida disputada', 'partidas disputadas')}</small>}
      </div>
      {view.total === 0
        ? <p className="round-empty">As partidas desta rodada ainda não foram definidas pela organização.</p>
        : <div className="matches-list compact">{view.matches.map(({ match, group }) => <MatchCard key={match.id} match={match as Match} context={group ?? undefined} detailed />)}</div>}
    </div>
  );

  return (
    <div className="rounds-browser">
      <div className="round-nav" role="navigation" aria-label="Rodadas">
        <button type="button" className="icon-button" onClick={() => go(index - 1)} disabled={showAll || index <= 0} aria-label="Rodada anterior"><ChevronLeft size={16} /></button>
        <div className="round-chips">
          {views.map((view, position) => (
            <button
              key={view.round.id}
              type="button"
              className={`round-chip state-${view.state}${!showAll && position === index ? ' active' : ''}`}
              aria-pressed={!showAll && position === index}
              title={`${view.label}: ${roundStateLabels[view.state]}`}
              onClick={() => go(position)}
            >
              {view.round.stage_group ? view.label.replace(/Rodada /, 'R') : `R${view.round.round_order}`}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button" onClick={() => go(index + 1)} disabled={showAll || index >= views.length - 1} aria-label="Próxima rodada"><ChevronRight size={16} /></button>
        <button type="button" className={`button button-outline round-all${showAll ? ' active' : ''}`} onClick={() => onSelect(showAll ? null : 'todas')}>
          <ListOrdered size={15} /> {showAll ? 'Uma rodada por vez' : 'Ver todas'}
        </button>
      </div>
      <div className="round-legend" aria-hidden="true">
        {(['finished', 'in_progress', 'live', 'future'] as const).map((state) => <span key={state} className={`round-state state-${state}`}>{roundStateLabels[state]}</span>)}
      </div>
      {showAll ? views.map(roundPanel) : current && roundPanel(current)}
    </div>
  );
}
