import { useState } from 'react';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { supabase, type Player } from '@/lib/supabase';
import { usePlayers } from '@/lib/hooks';
import { LoadingCard, Modal, PlayerPhoto, FormField, FormInput, FormSelect, FormError } from '@/components/ui';

const positions: Player['position'][] = ['Goleiro', 'Volante', 'Pivô'];

export function PlayersTab() {
  const { players, loading } = usePlayers();
  const [nickname, setNickname] = useState('');
  const [fullName, setFullName] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [nationality, setNationality] = useState('');
  const [position, setPosition] = useState<Player['position']>('Volante');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Player | null>(null);

  async function createPlayer(event: React.FormEvent) {
    event.preventDefault();
    if (!nickname.trim()) { setError('O apelido do jogador é obrigatório.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('players').insert({ nickname: nickname.trim(), full_name: fullName.trim() || null, photo_url: photoUrl.trim() || null, nationality: nationality.trim() || null, position });
    setBusy(false);
    if (err) { setError('Não foi possível cadastrar o jogador.'); return; }
    setNickname(''); setFullName(''); setPhotoUrl(''); setNationality(''); setPosition('Volante');
    window.location.reload();
  }

  async function deletePlayer(id: string) {
    if (!window.confirm('Remover este jogador?')) return;
    const { error: err } = await supabase.from('players').delete().eq('id', id);
    if (err) { setError('Não foi possível remover o jogador. Ele pode estar em algum elenco ou partida.'); return; }
    window.location.reload();
  }

  return (
    <div className="admin-grid">
      <div className="admin-form-card">
        <h3>Novo jogador</h3>
        <form onSubmit={createPlayer}>
          <FormField label="Apelido">
            <FormInput value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Ex: Pelé" />
          </FormField>
          <FormField label="Nome completo">
            <FormInput value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Opcional" />
          </FormField>
          <FormField label="Posição">
            <FormSelect value={position} onChange={(e) => setPosition(e.target.value as Player['position'])}>
              {positions.map((p) => <option key={p} value={p}>{p}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Nacionalidade">
            <FormInput value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="Ex: Brasil" />
          </FormField>
          <FormField label="Foto (URL da imagem)">
            <FormInput value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://..." />
          </FormField>
          {photoUrl && <div className="form-preview"><PlayerPhoto src={photoUrl} name={nickname || '?'} size={48} /></div>}
          <FormError message={error} />
          <button className="button button-primary" disabled={busy}>{busy ? 'Aguarde...' : 'Cadastrar jogador'} <ArrowRight size={16} /></button>
        </form>
      </div>
      <div className="admin-list-card">
        <h3>Jogadores cadastrados</h3>
        {loading ? <LoadingCard /> : players.length === 0 ? <p className="admin-empty-text">Nenhum jogador cadastrado ainda.</p> : (
          <div className="admin-list">
            {players.map((p) => (
              <div key={p.id} className="admin-list-item">
                <div className="admin-list-team">
                  <PlayerPhoto src={p.photo_url} name={p.nickname} size={32} />
                  <div><strong>{p.nickname}</strong><span>{p.position}{p.nationality ? ` · ${p.nationality}` : ''}</span></div>
                </div>
                <div className="admin-list-actions">
                  <button className="icon-button" onClick={() => setEditing(p)} title="Editar"><Pencil size={15} /></button>
                  <button className="icon-button-danger" onClick={() => deletePlayer(p.id)} title="Remover"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && (
        <Modal title="Editar jogador" onClose={() => setEditing(null)}>
          <PlayerEditForm player={editing} />
        </Modal>
      )}
    </div>
  );
}

function PlayerEditForm({ player }: { player: Player }) {
  const [nickname, setNickname] = useState(player.nickname);
  const [fullName, setFullName] = useState(player.full_name ?? '');
  const [photoUrl, setPhotoUrl] = useState(player.photo_url ?? '');
  const [nationality, setNationality] = useState(player.nationality ?? '');
  const [position, setPosition] = useState<Player['position']>(player.position);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!nickname.trim()) { setError('O apelido do jogador é obrigatório.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('players').update({
      nickname: nickname.trim(),
      full_name: fullName.trim() || null,
      photo_url: photoUrl.trim() || null,
      nationality: nationality.trim() || null,
      position,
    }).eq('id', player.id);
    setBusy(false);
    if (err) { setError('Não foi possível salvar as alterações.'); return; }
    window.location.reload();
  }

  return (
    <form onSubmit={save}>
      <FormField label="Apelido">
        <FormInput value={nickname} onChange={(e) => setNickname(e.target.value)} />
      </FormField>
      <FormField label="Nome completo">
        <FormInput value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </FormField>
      <FormField label="Posição">
        <FormSelect value={position} onChange={(e) => setPosition(e.target.value as Player['position'])}>
          {positions.map((p) => <option key={p} value={p}>{p}</option>)}
        </FormSelect>
      </FormField>
      <FormField label="Nacionalidade">
        <FormInput value={nationality} onChange={(e) => setNationality(e.target.value)} />
      </FormField>
      <FormField label="Foto (URL da imagem)">
        <FormInput value={photoUrl} onChange={(e) => setPhotoUrl(e.target.value)} placeholder="https://..." />
      </FormField>
      <div className="form-preview"><PlayerPhoto src={photoUrl.trim() || null} name={nickname || '?'} size={48} /></div>
      <FormError message={error} />
      <button className="button button-primary" disabled={busy}>{busy ? 'Aguarde...' : 'Salvar alterações'} <ArrowRight size={16} /></button>
    </form>
  );
}
