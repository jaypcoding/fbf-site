import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, Shuffle } from 'lucide-react';
import { supabase, type Stage } from '@/lib/supabase';
import { refreshAdminData, useAdminDataVersion } from '@/lib/adminRefresh';
import { useSeasonTeams } from '@/lib/hooks';
import { knockoutSeriesName } from '@/lib/knockoutPreview';
import {
  applyKnockoutOptions, buildGroupKnockoutBracket,
  buildGroupRoundRobin,
  buildKnockoutBracket,
  distributeTeamsIntoGroups,
  rankStandings,
  standingFromView,
  type GroupAssignment,
  type StandingStats,
  type TieBreaker,
} from '@/lib/competitionFormats';
import { buildRoundRobin } from '@/lib/roundRobin';
import { FormError } from '@/components/ui';
import { useConfirm } from '@/components/site';
import { GroupSchedulePanel } from './GroupSchedulePanel';

type Props = { stage: Stage; seasonId: string };

type GroupRow = StandingStats & {
  season_team_id: string;
  stage_group_id: string;
  group_name: string;
};

type GroupProgress = {
  groups: { id: string; name: string; order: number; teamIds: string[]; rows: StandingStats[] }[];
  allMatchesFinished: boolean;
  // Rounds of the legacy model (one round per group). When absent, a
  // home-and-away group stage uses shared rounds (GroupSchedulePanel).
  hasGroupRounds: boolean;
};

const groupLabel = (index: number) => `Grupo ${String.fromCharCode(65 + index)}`;

function slotLabel(
  slot: { kind: 'team'; teamId: string } | { kind: 'winner' | 'loser'; sourceKey: string },
  names: Map<string, string>,
  plan?: { rounds: unknown[][] },
) {
  if (slot.kind === 'team') return names.get(slot.teamId) ?? 'Equipe';
  const source = plan ? knockoutSeriesName(slot.sourceKey, plan.rounds.length, (round) => plan.rounds[round - 1]?.length ?? 1) : slot.sourceKey;
  const article = /^(Quartas|Oitavas)/.test(source) ? 'das' : 'da';
  return `${slot.kind === 'winner' ? 'Vencedor' : 'Perdedor'} ${article} ${source}`;
}

function stageErrorMessage(message: string) {
  if (message.includes('confronto') || message.includes('classificados') || message.includes('grupos')) return message;
  return 'Não foi possível gerar a etapa. As partidas existentes foram preservadas.';
}

export function GenerateRoundsForm({ stage, seasonId }: Props) {
  const confirm = useConfirm();
  const { seasonTeams, loading, error: seasonTeamsError } = useSeasonTeams(seasonId);
  const refreshVersion = useAdminDataVersion();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [groupProgress, setGroupProgress] = useState<GroupProgress | null>(null);
  const [groupProgressLoading, setGroupProgressLoading] = useState(false);
  const [groupProgressError, setGroupProgressError] = useState(false);
  const [groupAssignments, setGroupAssignments] = useState<Record<string, number>>({});
  const [groupDrawVersion, setGroupDrawVersion] = useState(() => Math.floor(Math.random() * 0x100000000));
  const [teamOrder, setTeamOrder] = useState<string[]>([]);
  const idsKey = seasonTeams.map((team) => team.id).join(',');
  const legs = stage.settings.legs === 2 ? 2 : 1;
  const groupLegs = stage.settings.group_legs === 2 ? 2 : 1;
  const knockoutLegs = stage.settings.knockout_legs === 2 ? 2 : 1;
  const groupCount = stage.settings.group_count ?? 2;
  const qualifiersPerGroup = stage.settings.qualifiers_per_group ?? 2;
  const names = useMemo(
    () => new Map(seasonTeams.map((seasonTeam) => [seasonTeam.id, seasonTeam.team?.name ?? 'Equipe'])),
    [seasonTeams],
  );

  useEffect(() => {
    const ids = idsKey ? idsKey.split(',') : [];
    setTeamOrder(ids);
    if (!ids.length || stage.format !== 'Grupos + Mata-mata') {
      setGroupAssignments({});
      return;
    }
    if (groupCount < 2 || groupCount > Math.floor(ids.length / 2)) {
      setGroupAssignments({});
      return;
    }
    const initialGroups = distributeTeamsIntoGroups(ids, groupCount);
    const assignments = Object.fromEntries(
      initialGroups.flatMap((group, index) => group.teamIds.map((teamId) => [teamId, index])),
    );
    setGroupAssignments(assignments);
  }, [idsKey, stage.format, groupCount]);

  useEffect(() => {
    if (stage.format !== 'Grupos + Mata-mata') {
      setGroupProgress(null);
      setGroupProgressLoading(false);
      setGroupProgressError(false);
      return;
    }
    let active = true;
    async function loadGroupProgress() {
      setGroupProgressLoading(true);
      setGroupProgressError(false);
      const [groupResult, memberResult, standingResult, roundResult] = await Promise.all([
        supabase.from('stage_groups').select('id, name, group_order').eq('stage_id', stage.id).order('group_order'),
        supabase.from('stage_group_teams').select('stage_group_id, season_team_id, seed_order').eq('stage_id', stage.id).order('seed_order'),
        supabase.from('stage_standings').select('season_team_id, stage_group_id, group_name, team_name, played, wins, draws, losses, goals_for, goals_against, points').eq('stage_id', stage.id).not('stage_group_id', 'is', null),
        supabase.from('rounds').select('id, phase_type').eq('stage_id', stage.id).in('phase_type', ['GROUP', 'ROUND_ROBIN']),
      ]);
      if (!active) return;
      if (groupResult.error || memberResult.error || standingResult.error || roundResult.error) {
        setGroupProgress(null);
        setGroupProgressError(true);
        setGroupProgressLoading(false);
        return;
      }

      // Group matches live in GROUP rounds (legacy model) or in the stage's
      // shared ROUND_ROBIN rounds; both count for the end of the group phase.
      const roundIds = (roundResult.data ?? []).map((round) => round.id);
      const hasGroupRounds = (roundResult.data ?? []).some((round) => round.phase_type === 'GROUP');
      const matchResult = roundIds.length
        ? await supabase.from('matches').select('status').in('round_id', roundIds)
        : { data: [], error: null };
      if (!active) return;
      if (matchResult.error) {
        setGroupProgress(null);
        setGroupProgressError(true);
        setGroupProgressLoading(false);
        return;
      }

      const membersByGroup = new Map<string, string[]>();
      for (const member of memberResult.data ?? []) {
        const groupMembers = membersByGroup.get(member.stage_group_id) ?? [];
        groupMembers.push(member.season_team_id);
        membersByGroup.set(member.stage_group_id, groupMembers);
      }
      // stage_standings uses snake_case; rankStandings and the labels read
      // StandingStats (camelCase), including goals for the goal-difference
      // tie-breaker.
      const rows = (standingResult.data ?? []).map(standingFromView) as unknown as GroupRow[];
      const tieBreakers = stage.tie_breakers as TieBreaker[];
      const groups = (groupResult.data ?? []).map((group) => ({
        id: group.id,
        name: group.name,
        order: group.group_order,
        teamIds: membersByGroup.get(group.id) ?? [],
        rows: rankStandings(
          rows.filter((row) => row.stage_group_id === group.id),
          tieBreakers,
        ),
      }));
      setGroupProgress({
        groups,
        hasGroupRounds,
        allMatchesFinished: roundIds.length > 0
          && (matchResult.data ?? []).length > 0
          && (matchResult.data ?? []).every((match) => match.status === 'FINISHED'),
      });
      setGroupProgressLoading(false);
    }
    void loadGroupProgress();
    return () => { active = false; };
  }, [stage.format, stage.id, stage.tie_breakers, refreshVersion]);

  const groupSizeCounts = Array.from({ length: Math.max(0, groupCount) }, (_, index) =>
    seasonTeams.filter((team) => groupAssignments[team.id] === index).length,
  );
  const groupAssignmentsValid = groupCount >= 2
    && groupCount <= Math.floor(seasonTeams.length / 2)
    && seasonTeams.every((team) => Number.isInteger(groupAssignments[team.id]))
    && groupSizeCounts.every((count) => count >= 2);
  const manualGroups: GroupAssignment[] = useMemo(() => (
    Array.from({ length: Math.max(0, groupCount) }, (_, index) => ({
      name: groupLabel(index),
      teamIds: seasonTeams
        .filter((team) => groupAssignments[team.id] === index)
        .map((team) => team.id),
    }))
  ), [groupAssignments, groupCount, seasonTeams]);
  const roundRobinRounds = useMemo(() => buildRoundRobin(seasonTeams.map((team) => team.id), legs), [seasonTeams, legs]);
  const roundRobinMatches = roundRobinRounds.reduce((total, round) => total + round.length, 0);
  const groupSchedule = useMemo(
    () => groupAssignmentsValid ? buildGroupRoundRobin(manualGroups, groupLegs) : [],
    [groupAssignmentsValid, manualGroups, groupLegs],
  );
  const groupMatches = groupSchedule.reduce(
    (total, group) => total + group.rounds.reduce((sum, round) => sum + round.length, 0),
    0,
  );
  const groupRankings = useMemo(
    () => (groupProgress?.groups ?? [])
      .map((group) => ({ name: group.name, teamIds: group.rows.map((row) => row.teamId) })),
    [groupProgress],
  );
  const groupKnockoutPlan = useMemo(() => {
    if (!groupProgress?.allMatchesFinished || !groupRankings.length) return null;
    if (groupProgress.groups.some((group) => group.rows.length < qualifiersPerGroup)) return null;
    return applyKnockoutOptions(buildGroupKnockoutBracket(
      groupRankings,
      qualifiersPerGroup,
      knockoutLegs,
      stage.settings.third_place ?? false,
      stage.settings.group_crossing ?? 'RANKED',
      groupDrawVersion,
    ), { finalLegs: stage.settings.final_legs, betterSeedHostsSecondLeg: stage.settings.better_seed_hosts_second_leg });
  }, [groupProgress, groupRankings, qualifiersPerGroup, knockoutLegs, stage.settings.third_place, stage.settings.group_crossing, stage.settings.final_legs, stage.settings.better_seed_hosts_second_leg, groupDrawVersion]);
  const knockoutPlan = useMemo(() => (
    stage.format === 'Mata-mata' && teamOrder.length >= 2
      ? applyKnockoutOptions(buildKnockoutBracket(teamOrder, knockoutLegs, stage.settings.third_place ?? false), { finalLegs: stage.settings.final_legs, betterSeedHostsSecondLeg: stage.settings.better_seed_hosts_second_leg })
      : null
  ), [stage.format, teamOrder, knockoutLegs, stage.settings.third_place, stage.settings.final_legs, stage.settings.better_seed_hosts_second_leg]);

  async function generateRoundRobin() {
    if (!roundRobinMatches) return;
    const roundLabel = legs === 2 ? 'turno e returno' : 'turno único';
    if (!(await confirm({ title: 'Gerar tabela de jogos', message: `Serão criadas ${roundRobinRounds.length} rodadas e ${roundRobinMatches} partidas (${roundLabel}). A operação é feita de uma só vez e não altera partidas já existentes.`, confirmLabel: 'Gerar partidas' }))) return;
    setBusy(true); setError(null);
    const { data, error: generationError } = await supabase.rpc('generate_round_robin', { p_stage_id: stage.id });
    setBusy(false);
    if (generationError) { setError(stageErrorMessage(generationError.message)); return; }
    const result = data as { rounds?: number; matches?: number; already_generated?: boolean } | null;
    if (result?.already_generated) {
      setError('Os confrontos desta fase já foram gerados; nenhuma partida foi duplicada.');
      return;
    }
    refreshAdminData();
  }

  async function generateGroups() {
    if (!groupAssignmentsValid || groupSchedule.length < 2) {
      setError('Distribua todos os times em grupos com pelo menos duas equipes cada.');
      return;
    }
    const preview = manualGroups.map((group) => `${group.name}: ${group.teamIds.map((id) => names.get(id)).join(', ')}`).join('\n');
    if (!(await confirm({ title: 'Gerar fase de grupos', message: `Serão criados ${groupMatches} jogos em ${groupCount} grupos.\n\n${preview}`, confirmLabel: 'Gerar grupos' }))) return;
    setBusy(true); setError(null);
    const { error: generationError } = await supabase.rpc('generate_group_stage', {
      p_stage_id: stage.id,
      p_groups: manualGroups.map((group) => ({ name: group.name, team_ids: group.teamIds })),
      p_group_legs: groupLegs,
      p_qualifiers_per_group: qualifiersPerGroup,
    });
    setBusy(false);
    if (generationError) { setError(stageErrorMessage(generationError.message)); return; }
    refreshAdminData();
  }

  async function generateKnockout(plan: NonNullable<typeof knockoutPlan>) {
    const series = [...plan.rounds.flat(), ...(plan.thirdPlace ? [plan.thirdPlace] : [])];
    const matchCount = series.reduce((count, item) => count + item.legs, 0);
    if (!(await confirm({ title: 'Confirmar chave eliminatória', message: `Serão criados ${series.length} confrontos e ${matchCount} partidas. A chave desta fase só pode ser gerada uma vez.`, confirmLabel: 'Gerar chave' }))) return;
    setBusy(true); setError(null);
    const { error: generationError } = await supabase.rpc('generate_knockout_stage', {
      p_stage_id: stage.id,
      p_series: series,
      p_legs: knockoutLegs,
    });
    setBusy(false);
    if (generationError) { setError(stageErrorMessage(generationError.message)); return; }
    refreshAdminData();
  }

  function moveTeam(teamId: string, direction: -1 | 1) {
    setTeamOrder((current) => {
      const index = current.indexOf(teamId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function drawTeams() {
    setTeamOrder((current) => {
      const next = [...current];
      for (let index = next.length - 1; index > 0; index -= 1) {
        const target = Math.floor(Math.random() * (index + 1));
        [next[index], next[target]] = [next[target], next[index]];
      }
      return next;
    });
  }

  if (stage.format === 'Personalizado') {
    return <p className="admin-hint">Esta fase usa confrontos manuais e não possui geração automática.</p>;
  }

  return (
    <div className="generate-rounds">
      <div className="admin-divider" />
      {seasonTeamsError ? <FormError message="Não foi possível carregar as equipes aprovadas desta temporada." /> : loading ? null : seasonTeams.length < 2 ? (
        <p className="admin-hint">Inscreva pelo menos duas equipes nesta temporada para configurar os confrontos.</p>
      ) : stage.format === 'Pontos corridos' ? (
        <>
          <h3>Prévia dos confrontos</h3>
          <p className="admin-hint">{roundRobinRounds.length} rodadas e {roundRobinMatches} partidas, com {legs === 2 ? 'turno e returno' : 'turno único'} para {seasonTeams.length} equipes. O sistema distribui folgas automaticamente quando necessário.</p>
          <ol className="admin-hint">
            {roundRobinRounds.slice(0, Math.min(4, roundRobinRounds.length)).map((round, index) => (
              <li key={index}>{legs === 2 && index >= roundRobinRounds.length / 2 ? 'Returno · ' : ''}Rodada {index + 1}: {round.map((match) => `${names.get(match.home)} × ${names.get(match.away)}`).join(' · ') || 'Folga'}</li>
            ))}
          </ol>
          {roundRobinRounds.length > 4 && <p className="admin-hint">A prévia completa será criada ao confirmar a geração.</p>}
          <FormError message={error} />
          <button className="button button-primary" disabled={busy || !roundRobinMatches} onClick={generateRoundRobin}>
            {busy ? 'Gerando...' : 'Gerar pontos corridos'} <ArrowRight size={16} />
          </button>
        </>
      ) : stage.format === 'Mata-mata' ? (
        <>
          <h3>Prévia da chave eliminatória</h3>
          <p className="admin-hint">Ordene as equipes para definir os cabeças de chave ou sorteie uma ordem. Vagas não preenchidas no quadro geram avanços automáticos.</p>
          <div className="admin-list">
            {teamOrder.map((teamId, index) => (
              <div className="admin-list-item" key={teamId}>
                <div><strong>{index + 1}. {names.get(teamId)}</strong><span>Posição de chave</span></div>
                <div className="admin-list-actions">
                  <button className="icon-button" disabled={index === 0} onClick={() => moveTeam(teamId, -1)} aria-label={`Subir ${names.get(teamId)}`}><ArrowUp size={15} /></button>
                  <button className="icon-button" disabled={index === teamOrder.length - 1} onClick={() => moveTeam(teamId, 1)} aria-label={`Descer ${names.get(teamId)}`}><ArrowDown size={15} /></button>
                </div>
              </div>
            ))}
          </div>
          <button className="button button-secondary" onClick={drawTeams}><Shuffle size={16} /> Sortear ordem</button>
          {knockoutPlan && <KnockoutPreview plan={knockoutPlan} names={names} />}
          <FormError message={error} />
          {knockoutPlan && <button className="button button-primary" disabled={busy} onClick={() => generateKnockout(knockoutPlan)}>{busy ? 'Gerando...' : 'Confirmar e gerar chave'} <ArrowRight size={16} /></button>}
        </>
      ) : (
        <>
          <h3>Fase de grupos</h3>
          {groupProgressLoading ? (
            <p className="admin-hint">Verificando os grupos existentes...</p>
          ) : groupProgressError ? (
            <FormError message="Não foi possível verificar os grupos e resultados desta fase. Atualize os dados antes de continuar." />
          ) : groupLegs === 2 && !groupProgress?.hasGroupRounds && !groupProgress?.groups.length ? (
            <GroupSchedulePanel stage={stage} seasonTeams={seasonTeams} />
          ) : !groupProgress?.groups.length ? (
            <>
              <p className="admin-hint">Distribua cada equipe manualmente entre os grupos. A prévia inclui os jogos de turno {groupLegs === 2 ? 'e returno' : 'único'}.</p>
              {!groupAssignmentsValid && <FormError message={`Com ${seasonTeams.length} equipes, use entre 2 e ${Math.floor(seasonTeams.length / 2)} grupos, com pelo menos duas equipes em cada.`} />}
              {seasonTeams.map((team) => (
                <label className="form-field" key={team.id}>
                  <span>{team.team?.name ?? 'Equipe'}</span>
                  <select
                    value={groupAssignments[team.id] ?? ''}
                    onChange={(event) => setGroupAssignments((current) => ({ ...current, [team.id]: Number(event.target.value) }))}
                    aria-label={`Grupo de ${team.team?.name ?? 'equipe'}`}
                  >
                    {Array.from({ length: groupCount }, (_, index) => <option key={index} value={index}>{groupLabel(index)}</option>)}
                  </select>
                </label>
              ))}
              {groupAssignmentsValid && <p className="admin-hint">{groupSchedule.map((group) => `${group.groupName}: ${group.rounds.reduce((sum, round) => sum + round.length, 0)} partidas`).join(' · ')} · Total: {groupMatches} partidas.</p>}
              <FormError message={error} />
              <button className="button button-primary" disabled={busy || !groupAssignmentsValid} onClick={generateGroups}>
                {busy ? 'Gerando...' : 'Confirmar grupos e gerar jogos'} <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <>
              {groupLegs === 2 && !groupProgress.hasGroupRounds && <GroupSchedulePanel stage={stage} seasonTeams={seasonTeams} />}
              <p className="admin-hint">{groupProgress.allMatchesFinished
                ? `Todos os jogos dos grupos terminaram. Serão classificados os ${qualifiersPerGroup} primeiros de cada grupo.`
                : 'A chave será liberada após todas as partidas da fase de grupos serem finalizadas.'}</p>
              {groupProgress.groups.map((group) => (
                <div className="admin-stage-block" key={group.id}>
                  <strong>{group.name}</strong>
                  <p className="admin-hint">{group.rows.map((row, index) => `${index + 1}. ${row.teamName} (${row.points} pts)`).join(' · ') || 'A classificação aparece após os resultados.'}</p>
                </div>
              ))}
              {groupKnockoutPlan && <KnockoutPreview plan={groupKnockoutPlan} names={names} />}
              {groupKnockoutPlan && stage.settings.group_crossing === 'DRAW' && (
                <button className="button button-secondary" onClick={() => setGroupDrawVersion((version) => version + 1)}>
                  <Shuffle size={16} /> Sortear outros cruzamentos
                </button>
              )}
              <FormError message={error} />
              {groupKnockoutPlan && <button className="button button-primary" disabled={busy} onClick={() => generateKnockout(groupKnockoutPlan)}>{busy ? 'Gerando...' : 'Confirmar e gerar mata-mata'} <ArrowRight size={16} /></button>}
            </>
          )}
        </>
      )}
    </div>
  );
}

function KnockoutPreview({
  plan,
  names,
}: {
  plan: ReturnType<typeof buildKnockoutBracket>;
  names: Map<string, string>;
}) {
  const series = [...plan.rounds.flat(), ...(plan.thirdPlace ? [plan.thirdPlace] : [])];
  return (
    <div className="admin-list">
      {series.map((item) => (
        <div className="admin-list-item" key={item.key}>
          <div>
            <strong>{item.thirdPlace ? 'Terceiro lugar' : `Fase ${item.round} · Confronto ${item.matchNumber}`}</strong>
            <span>{item.legs === 2
              ? `Ida: ${slotLabel(item.home, names, plan)} × ${slotLabel(item.away, names, plan)} · Volta: ${slotLabel(item.away, names, plan)} × ${slotLabel(item.home, names, plan)}`
              : `Jogo único: ${slotLabel(item.home, names, plan)} × ${slotLabel(item.away, names, plan)}`}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
