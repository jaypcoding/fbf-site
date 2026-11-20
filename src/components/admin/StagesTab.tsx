import { useEffect, useState } from 'react';
import { ArrowRight, Trash2 } from 'lucide-react';
import { supabase, type Stage } from '@/lib/supabase';
import { useManagedCompetitions, useSeasons, useStages, useRounds } from '@/lib/hooks';
import { LoadingCard, FormField, FormInput, FormSelect, FormError } from '@/components/ui';
import { GenerateRoundsForm } from '@/components/admin/GenerateRoundsForm';
import { refreshAdminData } from '@/lib/adminRefresh';
import { useConfirm } from '@/components/site';

const tieBreakerOptions = [
  ['Pontos', 'POINTS'],
  ['Vitórias', 'WINS'],
  ['Empates', 'DRAWS'],
  ['Derrotas', 'LOSSES'],
  ['Saldo de gols', 'GOAL_DIFF'],
  ['Gols marcados', 'GOALS_FOR'],
  ['Gols sofridos', 'GOALS_AGAINST'],
  ['Nome do time', 'TEAM_NAME'],
] as const;
const defaultTieBreakers = 'Pontos, Vitórias, Saldo de gols, Gols marcados, Nome do time';

export function StagesTab() {
  const confirm = useConfirm();
  const { competitions, error: competitionsError } = useManagedCompetitions();
  const [selectedComp, setSelectedComp] = useState('');
  const { seasons } = useSeasons(selectedComp || undefined);
  const [selectedSeason, setSelectedSeason] = useState('');
  const { stages, loading, error: stagesError } = useStages(selectedSeason || undefined);
  const [stageName, setStageName] = useState('');
  const [stageFormat, setStageFormat] = useState('Pontos corridos');
  const [roundRobinLegs, setRoundRobinLegs] = useState<1 | 2>(1);
  const [groupLegs, setGroupLegs] = useState<1 | 2>(1);
  const [knockoutLegs, setKnockoutLegs] = useState<1 | 2>(1);
  const [groupCount, setGroupCount] = useState(2);
  const [qualifiersPerGroup, setQualifiersPerGroup] = useState(2);
  const [groupCrossing, setGroupCrossing] = useState<'RANKED' | 'DRAW'>('RANKED');
  const [thirdPlace, setThirdPlace] = useState(false);
  const [stageOrder, setStageOrder] = useState('1');
  const [tieBreakerInput, setTieBreakerInput] = useState(defaultTieBreakers);
  const [selectedStage, setSelectedStage] = useState('');
  const { rounds, error: roundsError } = useRounds(undefined, true);
  const [roundName, setRoundName] = useState('');
  const [roundOrder, setRoundOrder] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedComp && competitions.length > 0) setSelectedComp(competitions[0].id);
  }, [competitions, selectedComp]);
  useEffect(() => {
    if (!selectedSeason && seasons.length > 0) setSelectedSeason(seasons[0].id);
  }, [seasons, selectedSeason]);
  useEffect(() => {
    if (!selectedStage && stages.length > 0) setSelectedStage(stages[0].id);
  }, [stages, selectedStage]);

  async function createStage(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSeason || !stageName.trim()) { setError('Selecione uma temporada e dê um nome à fase.'); return; }
    if (stageFormat === 'Grupos + Mata-mata'
      && (!Number.isInteger(groupCount) || groupCount < 2 || !Number.isInteger(qualifiersPerGroup) || qualifiersPerGroup < 1)) {
      setError('Configure ao menos dois grupos e uma quantidade válida de classificados por grupo.');
      return;
    }
    const labelsToIds = new Map(tieBreakerOptions.map(([label, id]) => [label.toLocaleLowerCase('pt-BR'), id]));
    const tieBreakers = tieBreakerInput.split(',').map((item) => labelsToIds.get(item.trim().toLocaleLowerCase('pt-BR')));
    if (tieBreakers.length === 0 || tieBreakers.some((item) => !item) || new Set(tieBreakers).size !== tieBreakers.length) {
      setError('Informe critérios válidos e sem repetição, separados por vírgula.');
      return;
    }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('stages').insert({
      season_id: selectedSeason,
      name: stageName.trim(),
      format: stageFormat,
      stage_order: parseInt(stageOrder, 10) || 1,
      tie_breakers: tieBreakers,
      settings: stageFormat === 'Pontos corridos'
        ? { legs: roundRobinLegs }
        : {
            knockout_legs: knockoutLegs,
            group_legs: groupLegs,
            group_count: groupCount,
            qualifiers_per_group: qualifiersPerGroup,
            group_crossing: groupCrossing,
            third_place: thirdPlace,
          },
    });
    setBusy(false);
    if (err) { setError(err.message || 'Não foi possível criar a fase.'); return; }
    setStageName(''); setStageOrder('1');
    refreshAdminData();
  }

  async function deleteStage(id: string) {
    if (roundsError) { setError('Não foi possível verificar as rodadas desta fase.'); return; }
    const roundIds = rounds.filter((round) => round.stage_id === id).map((round) => round.id);
    if (roundIds.length > 0) {
      const { count, error: countError } = await supabase.from('matches').select('id', { count: 'exact', head: true }).in('round_id', roundIds);
      if (countError) { setError('Não foi possível verificar se a fase possui partidas.'); return; }
      if (count) { setError('Esta fase possui partidas e não pode ser removida. Preserve o histórico e encerre a competição, se necessário.'); return; }
    }
    if (!(await confirm({ title: 'Remover fase', message: 'A fase e suas rodadas vazias serão excluídas. Esta ação não pode ser desfeita.', confirmLabel: 'Remover fase', tone: 'danger' }))) return;
    const { error: err } = await supabase.from('stages').delete().eq('id', id);
    if (err) { setError('Não foi possível remover a fase. O banco pode estar protegendo dados vinculados.'); return; }
    refreshAdminData();
  }

  async function createRound(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedStage || !roundName.trim()) { setError('Selecione uma fase e dê um nome à rodada.'); return; }
    if (rounds.some((round) => round.stage_id === selectedStage && round.round_order === (parseInt(roundOrder, 10) || 1))) {
      setError('Já existe uma rodada com esta ordem nesta fase.');
      return;
    }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('rounds').insert({ stage_id: selectedStage, name: roundName.trim(), round_order: parseInt(roundOrder, 10) || 1 });
    setBusy(false);
    if (err) { setError('Não foi possível criar a rodada.'); return; }
    setRoundName(''); setRoundOrder('1');
    refreshAdminData();
  }

  async function deleteRound(id: string) {
    const { count, error: countError } = await supabase.from('matches').select('id', { count: 'exact', head: true }).eq('round_id', id);
    if (countError) { setError('Não foi possível verificar se a rodada possui partidas.'); return; }
    if (count) { setError('Esta rodada possui partidas e não pode ser removida. Preserve o histórico da competição.'); return; }
    if (!(await confirm({ title: 'Remover rodada', message: 'A rodada vazia será excluída. Esta ação não pode ser desfeita.', confirmLabel: 'Remover rodada', tone: 'danger' }))) return;
    const { error: err } = await supabase.from('rounds').delete().eq('id', id);
    if (err) { setError('Não foi possível remover a rodada. O banco pode estar protegendo dados vinculados.'); return; }
    refreshAdminData();
  }

  return (
    <div className="admin-stack">
    <div className="admin-grid">
      <div className="admin-form-card">
        <h3>Nova fase</h3>
        <form onSubmit={createStage}>
          <FormField label="Competição">
            <FormSelect value={selectedComp} onChange={(e) => {
              const nextCompetition = competitions.find((competition) => competition.id === e.target.value);
              setSelectedComp(e.target.value);
              setSelectedSeason('');
              setSelectedStage('');
              if (nextCompetition && ['Pontos corridos', 'Mata-mata', 'Grupos + Mata-mata'].includes(nextCompetition.format)) {
                setStageFormat(nextCompetition.format);
              }
            }}>
              <option value="">Selecione...</option>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Temporada">
            <FormSelect value={selectedSeason} onChange={(e) => { setSelectedSeason(e.target.value); setSelectedStage(''); }} disabled={!seasons.length}>
              <option value="">Selecione...</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Nome da fase">
            <FormInput value={stageName} onChange={(e) => setStageName(e.target.value)} placeholder="Ex: Fase de grupos" />
          </FormField>
          <FormField label="Formato">
            <FormSelect value={stageFormat} onChange={(e) => setStageFormat(e.target.value)}>
              <option>Pontos corridos</option>
              <option value="Mata-mata">Mata-mata</option>
              <option value="Grupos + Mata-mata">Grupos + mata-mata</option>
              <option value="Personalizado">Personalizado (montagem manual)</option>
            </FormSelect>
          </FormField>
          {stageFormat === 'Pontos corridos' ? (
            <FormField label="Turnos">
              <FormSelect value={roundRobinLegs} onChange={(e) => setRoundRobinLegs(Number(e.target.value) as 1 | 2)}>
                <option value={1}>Turno único</option>
                <option value={2}>Turno e returno</option>
              </FormSelect>
            </FormField>
          ) : stageFormat === 'Mata-mata' || stageFormat === 'Grupos + Mata-mata' ? (
            <>
              {stageFormat === 'Grupos + Mata-mata' && (
                <>
                  <FormField label="Quantidade de grupos">
                    <FormInput type="number" min="2" value={groupCount} onChange={(e) => setGroupCount(Number(e.target.value))} />
                  </FormField>
                  <FormField label="Classificados por grupo">
                    <FormInput type="number" min="1" value={qualifiersPerGroup} onChange={(e) => setQualifiersPerGroup(Number(e.target.value))} />
                  </FormField>
                  <FormField label="Cruzamentos entre grupos">
                    <FormSelect value={groupCrossing} onChange={(e) => setGroupCrossing(e.target.value as 'RANKED' | 'DRAW')}>
                      <option value="RANKED">Por colocação, sem repetir grupo</option>
                      <option value="DRAW">Sorteio, sem repetir grupo</option>
                    </FormSelect>
                  </FormField>
                  <FormField label="Turnos na fase de grupos">
                    <FormSelect value={groupLegs} onChange={(e) => setGroupLegs(Number(e.target.value) as 1 | 2)}>
                      <option value={1}>Turno único</option>
                      <option value={2}>Turno e returno</option>
                    </FormSelect>
                  </FormField>
                </>
              )}
              <FormField label={stageFormat === 'Grupos + Mata-mata' ? 'Turnos no mata-mata' : 'Jogos por confronto'}>
                <FormSelect value={knockoutLegs} onChange={(e) => setKnockoutLegs(Number(e.target.value) as 1 | 2)}>
                  <option value={1}>Jogo único</option>
                  <option value={2}>Ida e volta</option>
                </FormSelect>
              </FormField>
              <FormField label="Disputa de terceiro lugar">
                <FormSelect value={thirdPlace ? 'yes' : 'no'} onChange={(e) => setThirdPlace(e.target.value === 'yes')}>
                  <option value="no">Não</option>
                  <option value="yes">Sim</option>
                </FormSelect>
              </FormField>
            </>
          ) : (
            <p className="admin-hint">Formato legado: cadastre as rodadas e partidas manualmente.</p>
          )}
          <FormField label="Ordem">
            <FormInput type="number" min="1" value={stageOrder} onChange={(e) => setStageOrder(e.target.value)} />
          </FormField>
          <FormField label="Critérios de desempate (ordem)">
            <FormInput value={tieBreakerInput} onChange={(e) => setTieBreakerInput(e.target.value)} placeholder={defaultTieBreakers} />
          </FormField>
          <FormError message={error || (competitionsError ? 'Não foi possível carregar as competições autorizadas.' : null)} />
          <button className="button button-primary" disabled={busy || !selectedSeason}>{busy ? 'Aguarde...' : 'Criar fase'} <ArrowRight size={16} /></button>
        </form>
        {stages.length > 0 && (
          <>
            <div className="admin-divider" />
            <h3>Nova rodada</h3>
            <form onSubmit={createRound}>
              <FormField label="Fase">
                <FormSelect value={selectedStage} onChange={(e) => setSelectedStage(e.target.value)}>
                  <option value="">Selecione...</option>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </FormSelect>
              </FormField>
              <FormField label="Nome da rodada">
                <FormInput value={roundName} onChange={(e) => setRoundName(e.target.value)} placeholder="Ex: Rodada 1" />
              </FormField>
              <FormField label="Ordem">
                <FormInput type="number" min="1" value={roundOrder} onChange={(e) => setRoundOrder(e.target.value)} />
              </FormField>
              <button className="button button-primary" disabled={busy || !selectedStage}>{busy ? 'Aguarde...' : 'Criar rodada'} <ArrowRight size={16} /></button>
            </form>
          </>
        )}
      </div>
      <div className="admin-list-card">
        <h3>Fases e rodadas</h3>
        {stagesError || roundsError ? <FormError message="Não foi possível carregar as fases e rodadas. Verifique a competição e suas permissões." /> : loading ? <LoadingCard /> : stages.length === 0 ? <p className="admin-empty-text">Nenhuma fase criada ainda.</p> : (
          <div className="admin-list">
            {stages.map((s) => {
              const stageRounds = rounds.filter((r) => r.stage_id === s.id);
              return (
                <div key={s.id} className="admin-stage-block">
                  <div className="admin-list-item admin-stage-header">
                    <div><strong>{s.name}</strong><span>Ordem {s.stage_order} · {s.format} · Desempate: {s.tie_breakers.map((criterion) => tieBreakerOptions.find(([, id]) => id === criterion)?.[0] ?? criterion).join(' → ')}</span></div>
                    <button className="icon-button-danger" onClick={() => deleteStage(s.id)} title="Remover fase"><Trash2 size={15} /></button>
                  </div>
                  {stageRounds.map((r) => (
                    <div key={r.id} className="admin-list-item admin-round-item">
                      <div><strong>{r.name}</strong><span>Ordem {r.round_order}</span></div>
                      <button className="icon-button-danger" onClick={() => deleteRound(r.id)} title="Remover rodada"><Trash2 size={13} /></button>
                    </div>
                  ))}
                  {stageRounds.length === 0 && <p className="admin-sub-empty">Sem rodadas nesta fase.</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
      {/* Fixture generators need room (whole tables of rounds), so they get a
          full-width card instead of the narrow form column. It lives OUTSIDE
          .admin-grid on purpose: the "Nova fase" card is position: sticky, and
          a sticky element travels across its whole containing block. Inside
          the grid it slid down over this card and covered the group
          selectors; outside it, the sticky card stops at the end of the grid. */}
      {selectedStage && selectedSeason && stages.find((stage) => stage.id === selectedStage) && (
        <div className="admin-wide-card">
          <GenerateRoundsForm stage={stages.find((stage) => stage.id === selectedStage) as Stage} seasonId={selectedSeason} />
        </div>
      )}
    </div>
  );
}
