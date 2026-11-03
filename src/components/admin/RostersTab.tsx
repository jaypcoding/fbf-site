import { useEffect, useState } from 'react';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { supabase, type Roster } from '@/lib/supabase';
import { useCompetitions, useSeasons, useSeasonTeams, useRosters, usePlayers } from '@/lib/hooks';
import { LoadingCard, Modal, PlayerPhoto, FormField, FormInput, FormSelect, FormError } from '@/components/ui';

export function RostersTab() {
  const { competitions } = useCompetitions();
  const [selectedComp, setSelectedComp] = useState('');
  const { seasons } = useSeasons(selectedComp || undefined);
  const [selectedSeason, setSelectedSeason] = useState('');
  const { seasonTeams, loading: stLoading } = useSeasonTeams(selectedSeason || undefined);
  const [selectedSeasonTeam, setSelectedSeasonTeam] = useState('');
  const { rosters, loading: rLoading } = useRosters(selectedSeasonTeam || undefined);
  const { players } = usePlayers();
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [shirtNumber, setShirtNumber] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Roster | null>(null);

  useEffect(() => {
    if (!selectedComp && competitions.length > 0) setSelectedComp(competitions[0].id);
  }, [competitions, selectedComp]);
  useEffect(() => {
    if (!selectedSeason && seasons.length > 0) setSelectedSeason(seasons[0].id);
  }, [seasons, selectedSeason]);
  useEffect(() => {
    if (!selectedSeasonTeam && seasonTeams.length > 0) setSelectedSeasonTeam(seasonTeams[0].id);
  }, [seasonTeams, selectedSeasonTeam]);

  async function addPlayer(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSeasonTeam || !selectedPlayer) { setError('Selecione um time e um jogador.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('rosters').insert({ season_team_id: selectedSeasonTeam, player_id: selectedPlayer, shirt_number: shirtNumber ? parseInt(shirtNumber, 10) : null });
    setBusy(false);
    if (err) { setError(err.code === '23505' ? 'Este jogador já está no elenco.' : 'Não foi possível adicionar o jogador.'); return; }
    setSelectedPlayer(''); setShirtNumber('');
    window.location.reload();
  }

  async function removePlayer(id: string) {
    if (!window.confirm('Remover este jogador do elenco?')) return;
    const { error: err } = await supabase.from('rosters').delete().eq('id', id);
    if (err) { setError('Não foi possível remover o jogador do elenco.'); return; }
    window.location.reload();
  }

  return (
    <div className="admin-grid">
      <div className="admin-form-card">
        <h3>Adicionar ao elenco</h3>
        <form onSubmit={addPlayer}>
          <FormField label="Competição">
            <FormSelect value={selectedComp} onChange={(e) => { setSelectedComp(e.target.value); setSelectedSeason(''); setSelectedSeasonTeam(''); }}>
              <option value="">Selecione...</option>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Temporada">
            <FormSelect value={selectedSeason} onChange={(e) => { setSelectedSeason(e.target.value); setSelectedSeasonTeam(''); }} disabled={!seasons.length}>
              <option value="">Selecione...</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Time inscrito">
            <FormSelect value={selectedSeasonTeam} onChange={(e) => setSelectedSeasonTeam(e.target.value)} disabled={!seasonTeams.length}>
              <option value="">Selecione...</option>
              {seasonTeams.map((st) => <option key={st.id} value={st.id}>{st.team?.name || '—'}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Jogador">
            <FormSelect value={selectedPlayer} onChange={(e) => setSelectedPlayer(e.target.value)}>
              <option value="">Selecione...</option>
              {players.map((p) => <option key={p.id} value={p.id}>{p.nickname} ({p.position})</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Número da camisa">
            <FormInput type="number" min="0" max="99" value={shirtNumber} onChange={(e) => setShirtNumber(e.target.value)} placeholder="Opcional" />
          </FormField>
          <FormError message={error} />
          <button className="button button-primary" disabled={busy || !selectedSeasonTeam || !selectedPlayer}>{busy ? 'Aguarde...' : 'Adicionar'} <ArrowRight size={16} /></button>
        </form>
      </div>
      <div className="admin-list-card">
        <h3>Elenco</h3>
        {rLoading || stLoading ? <LoadingCard /> : rosters.length === 0 ? <p className="admin-empty-text">{selectedSeasonTeam ? 'Nenhum jogador neste elenco ainda.' : 'Selecione um time para ver o elenco.'}</p> : (
          <div className="admin-list">
            {rosters.map((r) => (
              <div key={r.id} className="admin-list-item">
                <div className="admin-list-team">
                  <div className="roster-number-sm">{r.shirt_number ?? '—'}</div>
                  <PlayerPhoto src={r.player?.photo_url || null} name={r.player?.nickname || ''} size={32} />
                  <div><strong>{r.player?.nickname}</strong><span>{r.player?.position}</span></div>
                </div>
                <div className="admin-list-actions">
                  <button className="icon-button" onClick={() => setEditing(r)} title="Editar número"><Pencil size={15} /></button>
                  <button className="icon-button-danger" onClick={() => removePlayer(r.id)} title="Remover"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && (
        <Modal title="Número da camisa" onClose={() => setEditing(null)}>
          <RosterEditForm roster={editing} />
        </Modal>
      )}
    </div>
  );
}

function RosterEditForm({ roster }: { roster: Roster }) {
  const [shirtNumber, setShirtNumber] = useState(roster.shirt_number?.toString() ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const parsed = shirtNumber === '' ? null : parseInt(shirtNumber, 10);
    if (parsed !== null && (Number.isNaN(parsed) || parsed < 0 || parsed > 99)) { setError('Informe um número entre 0 e 99.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('rosters').update({ shirt_number: parsed }).eq('id', roster.id);
    setBusy(false);
    if (err) { setError('Não foi possível salvar o número.'); return; }
    window.location.reload();
  }

  return (
    <form onSubmit={save}>
      <p className="admin-hint">{roster.player?.nickname}</p>
      <FormField label="Número da camisa">
        <FormInput type="number" min="0" max="99" value={shirtNumber} onChange={(e) => setShirtNumber(e.target.value)} placeholder="Sem número" />
      </FormField>
      <FormError message={error} />
      <button className="button button-primary" disabled={busy}>{busy ? 'Aguarde...' : 'Salvar número'} <ArrowRight size={16} /></button>
    </form>
  );
}
