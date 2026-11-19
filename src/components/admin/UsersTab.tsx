import { useEffect, useState } from 'react';
import { ArrowRight, Trash2 } from 'lucide-react';
import { supabase, type Profile } from '@/lib/supabase';
import { useCompetitions } from '@/lib/hooks';
import { LoadingCard, FormField, FormSelect, FormError } from '@/components/ui';
import { refreshAdminData, useAdminDataVersion } from '@/lib/adminRefresh';
import { useConfirm } from '@/components/site';

type RoleValue = Profile['role'];
const roleOptions: { value: RoleValue; label: string }[] = [
  { value: 'USER', label: 'Usuário' },
  { value: 'ORGANIZER', label: 'Organizador' },
  { value: 'ADMIN', label: 'Administrador' },
];

export function UsersTab({ currentUserId }: { currentUserId: string }) {
  const refreshVersion = useAdminDataVersion();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.from('profiles').select('id, display_name, role').order('display_name', { ascending: true }).then(({ data, error: err }) => {
      if (!active) return;
      if (err) setError('Não foi possível carregar os usuários.');
      else setProfiles((data || []) as Profile[]);
      setLoading(false);
    });
    return () => { active = false; };
  }, [refreshVersion]);

  async function changeRole(target: Profile, role: RoleValue) {
    setBusyId(target.id); setError(null);
    const { error: err } = await supabase.rpc('set_user_role', { target_user: target.id, new_role: role });
    setBusyId(null);
    if (err) { setError(err.message.includes('itself') || err.message.includes('própri') ? 'Você não pode alterar o seu próprio papel.' : 'Não foi possível alterar o papel deste usuário.'); return; }
    setProfiles((prev) => prev.map((p) => (p.id === target.id ? { ...p, role } : p)));
    refreshAdminData();
  }

  return (
    <div className="admin-list-card">
      <h3>Papéis dos usuários</h3>
      <p className="admin-hint">Organizadores editam apenas as competições que lhes forem atribuídas. Administradores editam tudo.</p>
      <FormError message={error} />
      {loading ? <LoadingCard /> : profiles.length === 0 ? <p className="admin-empty-text">Nenhum usuário cadastrado.</p> : (
        <div className="admin-list">
          {profiles.map((p) => (
            <div key={p.id} className="admin-list-item">
              <div>
                <strong>{p.display_name || 'Sem nome'}{p.id === currentUserId ? ' (você)' : ''}</strong>
                <span>{p.id.slice(0, 8)}</span>
              </div>
              <div className="admin-list-actions">
                <FormSelect value={p.role} disabled={busyId === p.id || p.id === currentUserId} onChange={(e) => changeRole(p, e.target.value as RoleValue)} aria-label={`Papel de ${p.display_name || 'usuário'}`}>
                  {roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </FormSelect>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Organizer = { user_id: string };

export function OrganizersTab() {
  const confirm = useConfirm();
  const { competitions, error: competitionsError } = useCompetitions();
  const refreshVersion = useAdminDataVersion();
  const [selectedComp, setSelectedComp] = useState('');
  const [organizers, setOrganizers] = useState<Organizer[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesError, setProfilesError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pickedUser, setPickedUser] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!selectedComp && competitions.length > 0) setSelectedComp(competitions[0].id);
  }, [competitions, selectedComp]);

  useEffect(() => {
    let active = true;
    supabase.from('profiles').select('id, display_name, role').order('display_name', { ascending: true }).then(({ data, error: queryError }) => {
      if (!active) return;
      setProfilesError(Boolean(queryError));
      setProfiles(queryError ? [] : (data || []) as Profile[]);
    });
    return () => { active = false; };
  }, [refreshVersion]);

  useEffect(() => {
    if (!selectedComp) return;
    let active = true;
    setLoading(true);
    supabase.from('competition_organizers').select('user_id').eq('competition_id', selectedComp).then(({ data, error: err }) => {
      if (!active) return;
      setError(err ? 'Não foi possível carregar os organizadores.' : null);
      setOrganizers((data || []) as Organizer[]);
      setLoading(false);
    });
    return () => { active = false; };
  }, [selectedComp, refreshVersion]);

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.display_name || 'Sem nome';
  const assignable = profiles.filter((p) => p.role === 'ORGANIZER' && !organizers.some((o) => o.user_id === p.id));

  async function assign(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedComp || !pickedUser) return;
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('competition_organizers').insert({ competition_id: selectedComp, user_id: pickedUser });
    setBusy(false);
    if (err) { setError('Não foi possível atribuir este organizador.'); return; }
    setOrganizers((prev) => [...prev, { user_id: pickedUser }]);
    setPickedUser('');
    refreshAdminData();
  }

  async function unassign(userId: string) {
    if (!(await confirm({ title: 'Remover organizador', message: 'Esta conta perde o acesso de gestão a esta competição.', confirmLabel: 'Remover acesso', tone: 'danger' }))) return;
    const { error: err } = await supabase.from('competition_organizers').delete().eq('competition_id', selectedComp).eq('user_id', userId);
    if (err) { setError('Não foi possível remover o organizador.'); return; }
    setOrganizers((prev) => prev.filter((o) => o.user_id !== userId));
    refreshAdminData();
  }

  return (
    <div className="admin-grid">
      <div className="admin-form-card">
        <h3>Atribuir organizador</h3>
        <form onSubmit={assign}>
          <FormField label="Competição">
            <FormSelect value={selectedComp} onChange={(e) => { setSelectedComp(e.target.value); setPickedUser(''); }}>
              <option value="">Selecione...</option>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Organizador">
            <FormSelect value={pickedUser} onChange={(e) => setPickedUser(e.target.value)} disabled={!assignable.length}>
              <option value="">Selecione...</option>
              {assignable.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.id.slice(0, 8)}</option>)}
            </FormSelect>
          </FormField>
          {profilesError && <FormError message="Não foi possível carregar os perfis de usuário." />}
          {assignable.length === 0 && !profilesError && <p className="admin-hint">Promova um usuário a Organizador na aba Usuários para atribuí-lo aqui.</p>}
          <FormError message={error || (competitionsError ? 'Não foi possível carregar as competições.' : null)} />
          <button className="button button-primary" disabled={busy || !pickedUser || profilesError || competitionsError}>{busy ? 'Aguarde...' : 'Atribuir'} <ArrowRight size={16} /></button>
        </form>
      </div>
      <div className="admin-list-card">
        <h3>Organizadores desta competição</h3>
        {loading ? <LoadingCard /> : error ? <FormError message={error} /> : organizers.length === 0 ? <p className="admin-empty-text">Nenhum organizador atribuído.</p> : (
          <div className="admin-list">
            {organizers.map((o) => (
              <div key={o.user_id} className="admin-list-item">
                <div><strong>{nameOf(o.user_id)}</strong></div>
                <div className="admin-list-actions">
                  <button className="icon-button-danger" onClick={() => unassign(o.user_id)} title="Remover"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
