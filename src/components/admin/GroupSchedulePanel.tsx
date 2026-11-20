import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, RotateCcw } from 'lucide-react';
import { supabase, type SeasonTeam, type Stage } from '@/lib/supabase';
import { refreshAdminData, useAdminDataVersion } from '@/lib/adminRefresh';
import {
  buildSchedulePayload,
  existingFingerprint,
  fixtureKey,
  planGroupSchedule,
  type EnteredFixture,
  type ExistingMatch,
  type PlannedMatch,
  type ScheduleGroup,
} from '@/lib/groupSchedule';
import { matchStatusLabels } from '@/lib/labels';
import { formatMatchDate } from '@/lib/format';
import { FormError, FormInput, FormSelect } from '@/components/ui';
import { useConfirm } from '@/components/site';

type Props = { stage: Stage; seasonTeams: SeasonTeam[] };
type StoredGroup = { id: string; name: string; group_order: number; teamIds: string[] };
type MatchRow = { id: string; status: string; scheduled_at: string | null; home_team_id: string | null; away_team_id: string | null; round: { round_order: number } | { round_order: number }[] | null };

const groupLabel = (index: number) => `Grupo ${String.fromCharCode(65 + index)}`;
const sourceLabels: Record<PlannedMatch['source'], string> = {
  existing: 'Já cadastrada',
  entered: 'Informada',
  proposed: 'Proposta pelo sistema',
};

function toIso(local: string) {
  return local ? new Date(local).toISOString() : null;
}

// Full table of a home-and-away group stage played in SHARED rounds
// ("Rodada N" holds the matches of every group). Existing matches are shown
// locked; the organizer types the published fixtures, the planner fills in the
// rest and labels it, and the database validates and inserts only what is
// missing (apply_group_schedule).
export function GroupSchedulePanel({ stage, seasonTeams }: Props) {
  const confirm = useConfirm();
  const refreshVersion = useAdminDataVersion();
  const groupCount = stage.settings.group_count ?? 4;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [storedGroups, setStoredGroups] = useState<StoredGroup[]>([]);
  const [existing, setExisting] = useState<ExistingMatch[]>([]);
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [entered, setEntered] = useState<EnteredFixture[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const names = useMemo(() => new Map(seasonTeams.map((team) => [team.id, team.team?.name ?? 'Equipe'])), [seasonTeams]);
  const teamName = (id: string) => names.get(id) ?? 'Equipe';

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(false);
    Promise.all([
      supabase.from('stage_groups').select('id, name, group_order').eq('stage_id', stage.id).order('group_order'),
      supabase.from('stage_group_teams').select('stage_group_id, season_team_id, seed_order').eq('stage_id', stage.id).order('seed_order'),
      supabase.from('matches').select('id, status, scheduled_at, home_team_id, away_team_id, round:round_id!inner ( round_order, stage_id )').eq('round.stage_id', stage.id),
    ]).then(([groupResult, memberResult, matchResult]) => {
      if (!active) return;
      if (groupResult.error || memberResult.error || matchResult.error) {
        setLoadError(true);
        setLoading(false);
        return;
      }
      const members = memberResult.data ?? [];
      setStoredGroups((groupResult.data ?? []).map((group) => ({
        ...group,
        teamIds: members.filter((member) => member.stage_group_id === group.id).map((member) => member.season_team_id),
      })));
      setExisting(((matchResult.data ?? []) as unknown as MatchRow[]).map((row) => {
        const round = Array.isArray(row.round) ? row.round[0] : row.round;
        return { id: row.id, status: row.status, scheduledAt: row.scheduled_at, homeId: row.home_team_id, awayId: row.away_team_id, round: round?.round_order ?? 0 };
      }));
      setLoading(false);
    });
    return () => { active = false; };
  }, [stage.id, refreshVersion]);

  const groups: ScheduleGroup[] = useMemo(() => {
    if (storedGroups.length) return storedGroups.map((group) => ({ name: group.name, teamIds: group.teamIds }));
    return Array.from({ length: groupCount }, (_, index) => ({
      name: groupLabel(index),
      teamIds: seasonTeams.filter((team) => assignments[team.id] === index).map((team) => team.id),
    }));
  }, [storedGroups, groupCount, seasonTeams, assignments]);

  const unassigned = storedGroups.length ? [] : seasonTeams.filter((team) => assignments[team.id] === undefined);
  const plan = useMemo(
    () => (unassigned.length ? null : planGroupSchedule({ groups, entered, existing, teamName })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, entered, existing, unassigned.length, names],
  );
  const missing = plan ? plan.matches.filter((match) => match.source !== 'existing') : [];
  const proposedCount = plan ? plan.matches.filter((match) => match.source === 'proposed').length : 0;
  const complete = plan !== null && plan.conflicts.length === 0 && missing.length === 0 && storedGroups.length > 0;

  function choose(match: PlannedMatch, value: string) {
    const [homeId, awayId] = value.split('>');
    setReviewed(false);
    setEntered((current) => [
      ...current.filter((item) => !(item.round === match.round && item.homeId === match.homeId && item.awayId === match.awayId)),
      { group: match.group, round: match.round, homeId, awayId },
    ]);
  }

  function reset(match: PlannedMatch) {
    setReviewed(false);
    setEntered((current) => current.filter((item) => !(item.round === match.round && item.homeId === match.homeId && item.awayId === match.awayId)));
  }

  // Registers only the groups (register_stage_groups): no round or match is
  // created, and the standings start showing one table per group.
  const groupsReady = !storedGroups.length && unassigned.length === 0
    && groups.every((group) => group.teamIds.length === groups[0].teamIds.length && group.teamIds.length >= 2);
  async function registerGroupsOnly() {
    if (!groupsReady) return;
    const ok = await confirm({
      title: 'Registrar só os grupos',
      message: `Os ${groups.length} grupos serão registrados e a classificação passará a mostrar uma tabela por grupo. `
        + 'Nenhuma partida será criada ou alterada. Depois de registrados, os grupos não podem ser mudados.',
      confirmLabel: 'Registrar grupos',
    });
    if (!ok) return;
    setBusy(true); setError(null); setResult(null);
    const { error: rpcError } = await supabase.rpc('register_stage_groups', {
      p_stage_id: stage.id,
      p_groups: groups.map((group) => ({ name: group.name, team_ids: group.teamIds })),
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message || 'Não foi possível registrar os grupos. Nada foi alterado.'); return; }
    setResult('Grupos registrados. Nenhuma partida foi criada.');
    refreshAdminData();
  }

  async function generate() {
    if (!plan || plan.conflicts.length) return;
    if (proposedCount > 0 && !reviewed) {
      setError('Revise os confrontos propostos pelo sistema e marque a confirmação antes de gerar.');
      return;
    }
    const ok = await confirm({
      title: 'Gerar tabela da fase de grupos',
      message: `Serão criadas ${missing.length} partidas agendadas em ${plan.roundCount} rodadas compartilhadas.`
        + `${existing.length === 1 ? ' A partida já cadastrada não será alterada.' : existing.length ? ` As ${existing.length} partidas já cadastradas não serão alteradas.` : ''}`
        + `${storedGroups.length ? '' : ' Os grupos serão registrados e não poderão ser alterados depois.'}`
        + `${proposedCount ? ` ${proposedCount} confrontos foram propostos pelo sistema e não informados pela organização.` : ''}`,
      confirmLabel: `Gerar ${missing.length} partidas`,
    });
    if (!ok) return;
    setBusy(true); setError(null); setResult(null);
    const isoDates = Object.fromEntries(Object.entries(dates).map(([key, value]) => [key, toIso(value)]));
    const { data, error: rpcError } = await supabase.rpc('apply_group_schedule', {
      p_stage_id: stage.id,
      ...buildSchedulePayload(groups, plan, isoDates),
      p_existing: existingFingerprint(existing),
    });
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message || 'Não foi possível gerar a tabela. Nada foi alterado.');
      return;
    }
    const summary = data as { matches_created?: number; matches_total?: number } | null;
    setResult(`${summary?.matches_created ?? 0} partidas criadas · ${summary?.matches_total ?? 0} na fase.`);
    setEntered([]);
    setDates({});
    setReviewed(false);
    refreshAdminData();
  }

  if (loading) return <p className="admin-hint">Carregando a tabela da fase...</p>;
  if (loadError) return <FormError message="Não foi possível carregar grupos e partidas desta fase. Atualize a página e tente novamente." />;

  return (
    <div className="group-schedule">
      <h3>Tabela da fase de grupos</h3>
      <p className="admin-hint">
        Rodadas compartilhadas: cada rodada reúne os jogos de todos os grupos, com turno e returno (mandos invertidos).
        Partidas já cadastradas não são alteradas. Informe os confrontos divulgados pela organização; o restante é
        proposto pelo sistema e identificado como tal.
      </p>

      <h4>Grupos</h4>
      {storedGroups.length ? (
        <div className="group-schedule-groups">
          {storedGroups.map((group) => (
            <div key={group.id} className="admin-stage-block"><strong>{group.name}</strong><p>{group.teamIds.map(teamName).join(' · ')}</p></div>
          ))}
        </div>
      ) : (
        <div className="group-schedule-assign">
          {seasonTeams.map((team) => (
            <label key={team.id} className="form-field">
              <span className="form-field-label">{team.team?.name ?? 'Equipe'}</span>
              <FormSelect
                value={assignments[team.id] ?? ''}
                onChange={(event) => {
                  setReviewed(false);
                  setEntered([]);
                  setAssignments((current) => {
                    const next = { ...current };
                    if (event.target.value === '') delete next[team.id];
                    else next[team.id] = Number(event.target.value);
                    return next;
                  });
                }}
                aria-label={`Grupo de ${team.team?.name ?? 'equipe'}`}
              >
                <option value="">Sem grupo</option>
                {Array.from({ length: groupCount }, (_, index) => <option key={index} value={index}>{groupLabel(index)}</option>)}
              </FormSelect>
            </label>
          ))}
          {unassigned.length > 0 && <p className="admin-hint">Distribua todas as equipes: {unassigned.length} sem grupo.</p>}
          {groupsReady && (
            <div className="group-schedule-register">
              <p className="admin-hint">Você pode registrar só os grupos agora, sem gerar nenhuma partida: a classificação passa a separar os grupos imediatamente.</p>
              <button type="button" className="button button-outline" disabled={busy} onClick={registerGroupsOnly}>Registrar só os grupos</button>
            </div>
          )}
        </div>
      )}

      {plan && (
        <>
          <FormError message={plan.conflicts.length ? plan.conflicts.join(' ') : null} />
          {Array.from({ length: plan.roundCount }, (_, index) => index + 1).map((round) => (
            <div key={round} className="group-schedule-round">
              <h4>Rodada {round} <span>{round <= plan.roundCount / 2 ? 'Turno' : 'Returno'}</span></h4>
              {groups.map((group, groupIndex) => {
                const rows = plan.matches.filter((match) => match.round === round && match.group === groupIndex);
                if (!rows.length) return null;
                const options = group.teamIds.flatMap((home) => group.teamIds.filter((away) => away !== home).map((away) => `${home}>${away}`));
                return (
                  <div key={groupIndex} className="group-schedule-group">
                    <span className="group-schedule-group-name">{group.name}</span>
                    {rows.map((match) => {
                      const key = fixtureKey(match.round, match.homeId, match.awayId);
                      return (
                        <div key={key} className={`group-schedule-match source-${match.source}`}>
                          {match.source === 'existing' ? (
                            <span className="group-schedule-fixed">{teamName(match.homeId)} × {teamName(match.awayId)}</span>
                          ) : (
                            <FormSelect value={`${match.homeId}>${match.awayId}`} onChange={(event) => choose(match, event.target.value)} aria-label={`Confronto da rodada ${round}, ${group.name}`}>
                              {options.map((option) => {
                                const [home, away] = option.split('>');
                                return <option key={option} value={option}>{teamName(home)} × {teamName(away)}</option>;
                              })}
                            </FormSelect>
                          )}
                          {match.source === 'existing' ? (
                            <span className="group-schedule-date">{formatMatchDate(match.scheduledAt)} · {matchStatusLabels[match.status as keyof typeof matchStatusLabels] ?? match.status}</span>
                          ) : (
                            <FormInput type="datetime-local" value={dates[key] ?? ''} onChange={(event) => setDates((current) => ({ ...current, [key]: event.target.value }))} aria-label="Data e hora (horário de Brasília)" />
                          )}
                          <span className={`group-schedule-source source-${match.source}`}>{sourceLabels[match.source]}</span>
                          {match.source === 'proposed' && (
                            <button type="button" className="icon-button" onClick={() => choose(match, `${match.homeId}>${match.awayId}`)} title="Confirmar: este confronto foi informado pela organização"><Check size={14} /></button>
                          )}
                          {match.source === 'entered' && (
                            <button type="button" className="icon-button" onClick={() => reset(match)} title="Voltar ao confronto proposto"><RotateCcw size={14} /></button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))}

          {complete ? (
            <p className="admin-hint">Tabela completa: {plan.matches.length} partidas cadastradas.</p>
          ) : (
            <>
              <p className="admin-hint">
                {missing.length} partidas a criar · {existing.length} já {existing.length === 1 ? 'cadastrada' : 'cadastradas'}
                {proposedCount ? ` · ${proposedCount} propostas pelo sistema` : ''}. Datas em branco ficam como “a definir”.
              </p>
              {proposedCount > 0 && (
                <label className="form-check">
                  <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
                  <span>Revisei os {proposedCount} confrontos propostos pelo sistema e confirmo a tabela.</span>
                </label>
              )}
              <FormError message={error} />
              {result && <p className="admin-hint">{result}</p>}
              <button type="button" className="button button-primary" disabled={busy || plan.conflicts.length > 0 || missing.length === 0} onClick={generate}>
                {busy ? 'Gerando...' : `Gerar ${missing.length} partidas`} <ArrowRight size={16} />
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
