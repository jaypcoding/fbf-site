import { useEffect, useState } from 'react';
import { ArrowRight, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCompetitions, useSeasons, useStages, useRounds } from '@/lib/hooks';
import { LoadingCard, FormField, FormInput, FormSelect, FormError } from '@/components/ui';
import { GenerateRoundsForm } from '@/components/admin/GenerateRoundsForm';

const tieBreakerOptions = [
  ['Pontos', 'POINTS'],
  ['Vitórias', 'WINS'],
  ['Saldo de gols', 'GOAL_DIFF'],
  ['Gols marcados', 'GOALS_FOR'],
  ['Gols sofridos', 'GOALS_AGAINST'],
  ['Nome do time', 'TEAM_NAME'],
] as const;
const defaultTieBreakers = 'Pontos, Vitórias, Saldo de gols, Gols marcados, Nome do time';

export function StagesTab() {
  const { competitions } = useCompetitions();
  const [selectedComp, setSelectedComp] = useState('');
  const { seasons } = useSeasons(selectedComp || undefined);
  const [selectedSeason, setSelectedSeason] = useState('');
  const { stages, loading } = useStages(selectedSeason || undefined);
  const [stageName, setStageName] = useState('');
  const [stageFormat, setStageFormat] = useState('Pontos corridos');
  const [stageOrder, setStageOrder] = useState('1');
  const [tieBreakerInput, setTieBreakerInput] = useState(defaultTieBreakers);
  const [selectedStage, setSelectedStage] = useState('');
  const { rounds } = useRounds();
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
    });
    setBusy(false);
    if (err) { setError(err.message || 'Não foi possível criar a fase.'); return; }
    setStageName(''); setStageOrder('1');
    window.location.reload();
  }

  async function deleteStage(id: string) {
    if (!window.confirm('Remover esta fase e todas as suas rodadas e partidas?')) return;
    const { error: err } = await supabase.from('stages').delete().eq('id', id);
    if (err) { setError('Não foi possível remover a fase.'); return; }
    window.location.reload();
  }

  async function createRound(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedStage || !roundName.trim()) { setError('Selecione uma fase e dê um nome à rodada.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('rounds').insert({ stage_id: selectedStage, name: roundName.trim(), round_order: parseInt(roundOrder, 10) || 1 });
    setBusy(false);
    if (err) { setError('Não foi possível criar a rodada.'); return; }
    setRoundName(''); setRoundOrder('1');
    window.location.reload();
  }

  async function deleteRound(id: string) {
    if (!window.confirm('Remover esta rodada e todas as suas partidas?')) return;
    const { error: err } = await supabase.from('rounds').delete().eq('id', id);
    if (err) { setError('Não foi possível remover a rodada.'); return; }
    window.location.reload();
  }

  return (
    <div className="admin-grid">
      <div className="admin-form-card">
        <h3>Nova fase</h3>
        <form onSubmit={createStage}>
          <FormField label="Competição">
            <FormSelect value={selectedComp} onChange={(e) => { setSelectedComp(e.target.value); setSelectedSeason(''); setSelectedStage(''); }}>
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
              <option>Mata-mata</option>
              <option>Grupos + Mata-mata</option>
              <option>Personalizado</option>
            </FormSelect>
          </FormField>
          <FormField label="Ordem">
            <FormInput type="number" min="1" value={stageOrder} onChange={(e) => setStageOrder(e.target.value)} />
          </FormField>
          <FormField label="Critérios de desempate (ordem)">
            <FormInput value={tieBreakerInput} onChange={(e) => setTieBreakerInput(e.target.value)} placeholder={defaultTieBreakers} />
          </FormField>
          <FormError message={error} />
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
        {selectedStage && selectedSeason && <GenerateRoundsForm stageId={selectedStage} seasonId={selectedSeason} />}
      </div>
      <div className="admin-list-card">
        <h3>Fases e rodadas</h3>
        {loading ? <LoadingCard /> : stages.length === 0 ? <p className="admin-empty-text">Nenhuma fase criada ainda.</p> : (
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
  );
}
