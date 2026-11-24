// "Responsáveis pelos clubes" (admins only): who may edit a club's tactical map
// besides the FBF admins. Granted and revoked through set_team_manager, which
// checks the admin role, requires a reason and keeps the history.
import { useEffect, useState } from 'react';
import { ShieldCheck, UserMinus } from 'lucide-react';
import { supabase, type Team } from '@/lib/supabase';
import { FormError, FormField, FormInput, FormSelect } from '@/components/ui';

type Manager = { team_id: string; user_id: string; granted_at: string; reason: string };
type ProfileRow = { id: string; display_name: string | null; role: string };

export function TeamManagersCard({ teams }: { teams: Team[] }) {
  const [teamId, setTeamId] = useState('');
  const [managers, setManagers] = useState<Manager[]>([]);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase.from('profiles').select('id, display_name, role').order('display_name').then(({ data }) => setProfiles((data ?? []) as ProfileRow[]));
  }, []);
  async function load(id = teamId) {
    if (!id) { setManagers([]); return; }
    const { data } = await supabase.from('team_managers').select('team_id, user_id, granted_at, reason').eq('team_id', id).order('granted_at');
    setManagers((data ?? []) as Manager[]);
  }
  useEffect(() => { void load(teamId); }, [teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameOf = (id: string) => profiles.find((p) => p.id === id)?.display_name || 'Usuário sem nome';
  async function change(target: string, grant: boolean) {
    if (reason.trim().length < 3) { setError('Informe o motivo.'); return; }
    setBusy(true); setError(null); setDone(null);
    const { error: err } = await supabase.rpc('set_team_manager', { p_team_id: teamId, p_user_id: target, p_grant: grant, p_reason: reason.trim() });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDone(grant ? 'Responsável designado.' : 'Responsável removido.');
    setUserId('');
    await load();
  }

  return (
    <div className="admin-list-card tac-managers">
      <h3><ShieldCheck size={16} aria-hidden="true" /> Responsáveis pelos clubes</h3>
      <p className="admin-hint">O responsável pode editar o mapa tático e os avatares somente do clube para o qual foi designado. Administradores editam todos. Cada designação exige motivo e fica no histórico.</p>
      <div className="tac-managers-form">
        <FormField label="Clube">
          <FormSelect value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Escolha</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Motivo">
          <FormInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Ex.: capitão indicado pelo clube" />
        </FormField>
      </div>
      {teamId && (
        <>
          {managers.length === 0 ? <p className="admin-empty-text">Nenhum responsável designado.</p> : (
            <ul>
              {managers.map((m) => (
                <li key={m.user_id}>
                  <span><strong>{nameOf(m.user_id)}</strong> · desde {new Date(m.granted_at).toLocaleDateString('pt-BR')} · {m.reason}</span>
                  <button type="button" className="button button-outline button-small" disabled={busy} onClick={() => void change(m.user_id, false)}><UserMinus size={14} aria-hidden="true" /> Remover</button>
                </li>
              ))}
            </ul>
          )}
          <div className="tac-managers-form">
            <FormField label="Designar usuário">
              <FormSelect value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Escolha</option>
                {profiles.filter((p) => !managers.some((m) => m.user_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.display_name || 'Usuário sem nome'} ({p.role})</option>)}
              </FormSelect>
            </FormField>
            <button type="button" className="button button-primary" disabled={busy || !userId} onClick={() => void change(userId, true)}>Designar</button>
          </div>
        </>
      )}
      <FormError message={error} />
      {done && <p className="lineup-saved">{done} Registrado no histórico.</p>}
    </div>
  );
}
