import { useState } from 'react';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { supabase, type Team } from '@/lib/supabase';
import { useTeams } from '@/lib/hooks';
import { LoadingCard, Modal, TeamLogo, FormField, FormInput, FormError } from '@/components/ui';

export function TeamsTab() {
  const { teams, loading } = useTeams();
  const [name, setName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);

  async function createTeam(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError('O nome do time é obrigatório.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('teams').insert({ name: name.trim(), logo_url: logoUrl.trim() || null });
    setBusy(false);
    if (err) { setError(err.code === '23505' ? 'Já existe um time com esse nome.' : 'Não foi possível criar o time.'); return; }
    setName(''); setLogoUrl('');
    window.location.reload();
  }

  async function deleteTeam(id: string) {
    if (!window.confirm('Remover este time?')) return;
    const { error: err } = await supabase.from('teams').delete().eq('id', id);
    if (err) { setError('Não foi possível remover o time. Ele pode estar inscrito em alguma temporada.'); return; }
    window.location.reload();
  }

  return (
    <div className="admin-grid">
      <div className="admin-form-card">
        <h3>Novo time</h3>
        <form onSubmit={createTeam}>
          <FormField label="Nome do time">
            <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: São Paulo FC" />
          </FormField>
          <FormField label="Logo (URL da imagem)">
            <FormInput value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
          </FormField>
          {logoUrl && <div className="form-preview"><TeamLogo src={logoUrl} name={name || '?'} size={48} /></div>}
          <FormError message={error} />
          <button className="button button-primary" disabled={busy}>{busy ? 'Aguarde...' : 'Criar time'} <ArrowRight size={16} /></button>
        </form>
      </div>
      <div className="admin-list-card">
        <h3>Times cadastrados</h3>
        {loading ? <LoadingCard /> : teams.length === 0 ? <p className="admin-empty-text">Nenhum time cadastrado ainda.</p> : (
          <div className="admin-list">
            {teams.map((t) => (
              <div key={t.id} className="admin-list-item">
                <div className="admin-list-team">
                  <TeamLogo src={t.logo_url} name={t.name} size={32} />
                  <div><strong>{t.name}</strong></div>
                </div>
                <div className="admin-list-actions">
                  <button className="icon-button" onClick={() => setEditing(t)} title="Editar"><Pencil size={15} /></button>
                  <button className="icon-button-danger" onClick={() => deleteTeam(t.id)} title="Remover"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && (
        <Modal title="Editar time" onClose={() => setEditing(null)}>
          <TeamEditForm team={editing} />
        </Modal>
      )}
    </div>
  );
}

function TeamEditForm({ team }: { team: Team }) {
  const [name, setName] = useState(team.name);
  const [logoUrl, setLogoUrl] = useState(team.logo_url ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError('O nome do time é obrigatório.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('teams').update({ name: name.trim(), logo_url: logoUrl.trim() || null }).eq('id', team.id);
    setBusy(false);
    if (err) { setError(err.code === '23505' ? 'Já existe um time com esse nome.' : 'Não foi possível salvar as alterações.'); return; }
    window.location.reload();
  }

  return (
    <form onSubmit={save}>
      <FormField label="Nome do time">
        <FormInput value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <FormField label="Logo (URL da imagem)">
        <FormInput value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
      </FormField>
      <div className="form-preview"><TeamLogo src={logoUrl.trim() || null} name={name || '?'} size={48} /></div>
      <FormError message={error} />
      <button className="button button-primary" disabled={busy}>{busy ? 'Aguarde...' : 'Salvar alterações'} <ArrowRight size={16} /></button>
    </form>
  );
}
