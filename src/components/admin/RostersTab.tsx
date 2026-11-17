import { useEffect, useState } from 'react';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { supabase, type Roster } from '@/lib/supabase';
import { useManagedCompetitions, useSeasons, useSeasonTeams, useRosters, usePlayers } from '@/lib/hooks';
import { refreshAdminData } from '@/lib/adminRefresh';
import { LoadingCard, Modal, PlayerPhoto, FormField, FormInput, FormSelect, FormError } from '@/components/ui';

export function RostersTab() {
  const { competitions, loading: competitionsLoading, error: competitionsError } = useManagedCompetitions();
  const [selectedComp, setSelectedComp] = useState('');
  const { seasons, loading: seasonsLoading, error: seasonsError } = useSeasons(selectedComp || undefined);
  const [selectedSeason, setSelectedSeason] = useState('');
  const { seasonTeams, loading: stLoading, error: seasonTeamsError } = useSeasonTeams(selectedSeason || undefined);
  const [selectedSeasonTeam, setSelectedSeasonTeam] = useState('');
  const { rosters, loading: rLoading, error: rostersError } = useRosters(selectedSeasonTeam || undefined);
  const { players, loading: playersLoading, error: playersError } = usePlayers();
  const availablePlayers = players.filter((player) => !rosters.some((roster) => roster.player_id === player.id));
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
    const parsedShirtNumber = shirtNumber === '' ? null : Number(shirtNumber);
    if (parsedShirtNumber !== null && (!Number.isInteger(parsedShirtNumber) || parsedShirtNumber < 0 || parsedShirtNumber > 99)) {
      setError('Informe um número de camisa inteiro entre 0 e 99.');
      return;
    }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('rosters').insert({ season_team_id: selectedSeasonTeam, player_id: selectedPlayer, shirt_number: parsedShirtNumber });
    setBusy(false);
    if (err) { setError(err.code === '23505' ? 'Este jogador já está no elenco.' : 'Não foi possível adicionar o jogador.'); return; }
    setSelectedPlayer(''); setShirtNumber('');
    refreshAdminData();
  }

  async function removePlayer(id: string) {
    if (!window.confirm('Remover este jogador do elenco?')) return;
    const { error: err } = await supabase.from('rosters').delete().eq('id', id);
    if (err) { setError('Não foi possível remover o jogador do elenco.'); return; }
    refreshAdminData();
  }

  return (
    <div className="admin-grid">
      <div className="admin-form-card">
        <h3>Adicionar ao elenco</h3>
        <form onSubmit={addPlayer}>
          <FormField label="Competição">
            <FormSelect value={selectedComp} disabled={competitionsLoading} onChange={(e) => { setSelectedComp(e.target.value); setSelectedSeason(''); setSelectedSeasonTeam(''); }}>
              <option value="">Selecione...</option>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Temporada">
            <FormSelect value={selectedSeason} onChange={(e) => { setSelectedSeason(e.target.value); setSelectedSeasonTeam(''); }} disabled={seasonsLoading || !seasons.length}>
              <option value="">Selecione...</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Time inscrito">
            <FormSelect value={selectedSeasonTeam} onChange={(e) => setSelectedSeasonTeam(e.target.value)} disabled={stLoading || !seasonTeams.length}>
              <option value="">Selecione...</option>
              {seasonTeams.map((st) => <option key={st.id} value={st.id}>{st.team?.name || '—'}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Jogador">
            <FormSelect value={selectedPlayer} onChange={(e) => setSelectedPlayer(e.target.value)} disabled={playersLoading || rLoading || !availablePlayers.length}>
              <option value="">Selecione...</option>
              {availablePlayers.map((p) => <option key={p.id} value={p.id}>{p.nickname} ({p.position})</option>)}
            </FormSelect>
          </FormField>
          <p className="admin-hint">A posição é definida no cadastro do jogador e exibida automaticamente neste elenco.</p>
          {selectedSeasonTeam && availablePlayers.length === 0 && !playersLoading && <p className="admin-hint">Todos os jogadores cadastrados já fazem parte deste elenco.</p>}
          {selectedSeasonTeam && players.length === 0 && !playersLoading && !playersError && <p className="admin-hint">Cadastre jogadores na plataforma antes de montar o elenco.</p>}
          <FormField label="Número da camisa">
            <FormInput type="number" min="0" max="99" value={shirtNumber} onChange={(e) => setShirtNumber(e.target.value)} placeholder="Opcional" />
          </FormField>
          <FormError message={error} />
          {!selectedSeasonTeam && selectedSeason && seasonTeams.length === 0 && !stLoading && !seasonTeamsError && <p className="admin-hint">Aprove uma inscrição na aba Inscrições antes de montar o elenco desta equipe.</p>}
          <FormError message={competitionsError ? 'Não foi possível carregar as competições.' : seasonsError ? 'Não foi possível carregar as temporadas.' : seasonTeamsError ? 'Não foi possível carregar as equipes aprovadas.' : playersError ? 'Não foi possível carregar os jogadores cadastrados.' : null} />
          <button className="button button-primary" disabled={busy || !selectedSeasonTeam || !selectedPlayer || playersLoading || rLoading}>{busy ? 'Aguarde...' : 'Adicionar'} <ArrowRight size={16} /></button>
        </form>
      </div>
      <div className="admin-list-card">
        <h3>Elenco</h3>
        {rLoading || stLoading ? <LoadingCard /> : rostersError ? <FormError message="Não foi possível carregar este elenco." /> : rosters.length === 0 ? <p className="admin-empty-text">{selectedSeasonTeam ? 'Nenhum jogador neste elenco ainda.' : 'Selecione um time inscrito e aprovado para ver o elenco.'}</p> : (
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
          <RosterEditForm roster={editing} onSaved={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

function RosterEditForm({ roster, onSaved }: { roster: Roster; onSaved: () => void }) {
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
    refreshAdminData();
    onSaved();
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
