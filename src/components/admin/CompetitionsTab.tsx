import { useState } from 'react';
import { ArrowRight, Pencil } from 'lucide-react';
import { supabase, type Competition } from '@/lib/supabase';
import { useCompetitions } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { LoadingCard, Modal, FormField, FormInput, FormSelect, FormError } from '@/components/ui';

type Status = Competition['status'];
type CompetitionFields = Pick<Competition, 'name' | 'description' | 'category' | 'format' | 'max_teams' | 'registration_starts_at' | 'registration_ends_at'>;

const statusOptions: { value: Status; label: string }[] = [
  { value: 'DRAFT', label: 'Em preparação (rascunho)' },
  { value: 'UPCOMING', label: 'Próxima' },
  { value: 'REGISTRATION', label: 'Inscrições abertas' },
  { value: 'ACTIVE', label: 'Em andamento' },
  { value: 'FINISHED', label: 'Finalizada' },
  { value: 'CANCELLED', label: 'Cancelada / arquivada' },
];

const emptyFields: CompetitionFields = {
  name: '',
  description: '',
  category: 'Principal',
  format: 'Pontos corridos',
  max_teams: null,
  registration_starts_at: null,
  registration_ends_at: null,
};

function toLocalInput(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function competitionFields(competition: Competition): CompetitionFields {
  return {
    name: competition.name,
    description: competition.description,
    category: competition.category,
    format: competition.format,
    max_teams: competition.max_teams,
    registration_starts_at: competition.registration_starts_at,
    registration_ends_at: competition.registration_ends_at,
  };
}

export function CompetitionsTab() {
  const { competitions, loading } = useCompetitions();
  const { profile } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Competition | null>(null);
  const isAdmin = profile?.role === 'ADMIN';

  async function changeStatus(id: string, status: Status) {
    setBusyId(id);
    setError(null);
    const { error: err } = await supabase.from('competitions').update({ status }).eq('id', id);
    setBusyId(null);
    if (err) {
      setError(err.message.includes('Transição') || err.message.includes('partidas pendentes') || err.message.includes('times aprovados')
        ? err.message
        : 'Não foi possível atualizar o status da competição.');
      return;
    }
    window.location.reload();
  }

  return (
    <div className="admin-grid">
      {isAdmin && <CompetitionCreateForm />}
      <div className="admin-list-card">
        <h3>Competições</h3>
        <p className="admin-hint">O banco valida transições de status, vagas e encerramento de partidas. Organizadores só alteram competições atribuídas. Competições com partidas não podem ser excluídas: use “Cancelada / arquivada” ou “Finalizada” para preservar o histórico.</p>
        <FormError message={error} />
        {loading ? <LoadingCard /> : competitions.length === 0 ? <p className="admin-empty-text">Nenhuma competição cadastrada.</p> : (
          <div className="admin-list">
            {competitions.map((competition) => (
              <div key={competition.id} className="admin-list-item">
                <div>
                  <strong>{competition.name}</strong>
                  <span>{competition.category} · {competition.format}{competition.max_teams ? ` · limite ${competition.max_teams} times` : ''}</span>
                </div>
                <div className="admin-list-actions">
                  <button className="icon-button" onClick={() => setEditing(competition)} title="Editar competição"><Pencil size={15} /></button>
                  <FormSelect value={competition.status} disabled={busyId === competition.id} onChange={(event) => changeStatus(competition.id, event.target.value as Status)} aria-label={`Status de ${competition.name}`}>
                    {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </FormSelect>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && (
        <Modal title="Editar competição" onClose={() => setEditing(null)}>
          <CompetitionEditForm competition={editing} />
        </Modal>
      )}
    </div>
  );
}

function CompetitionCreateForm() {
  const [fields, setFields] = useState<CompetitionFields>(emptyFields);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!fields.name.trim()) { setError('O nome da competição é obrigatório.'); return; }
    if (fields.max_teams !== null && fields.max_teams < 1) { setError('O limite de times deve ser maior que zero.'); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('competitions').insert({
      ...fields,
      name: fields.name.trim(),
      description: fields.description?.trim() || null,
      max_teams: fields.max_teams || null,
      status: 'DRAFT',
    });
    setBusy(false);
    if (err) { setError('Não foi possível criar a competição.'); return; }
    window.location.reload();
  }

  return (
    <div className="admin-form-card">
      <h3>Nova competição</h3>
      <form onSubmit={create}>
        <CompetitionFieldsForm fields={fields} setFields={setFields} />
        <FormError message={error} />
        <button className="button button-primary" disabled={busy}>{busy ? 'Aguarde...' : 'Criar competição'} <ArrowRight size={16} /></button>
      </form>
    </div>
  );
}

function CompetitionEditForm({ competition }: { competition: Competition }) {
  const [fields, setFields] = useState<CompetitionFields>(competitionFields(competition));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!fields.name.trim()) { setError('O nome da competição é obrigatório.'); return; }
    if (fields.max_teams !== null && fields.max_teams < 1) { setError('O limite de times deve ser maior que zero.'); return; }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('competitions').update({
      ...fields,
      name: fields.name.trim(),
      description: fields.description?.trim() || null,
      max_teams: fields.max_teams || null,
    }).eq('id', competition.id);
    setBusy(false);
    if (err) { setError('Não foi possível salvar as alterações.'); return; }
    window.location.reload();
  }

  return (
    <form onSubmit={save}>
      <CompetitionFieldsForm fields={fields} setFields={setFields} />
      <FormError message={error} />
      <button className="button button-primary" disabled={busy}>{busy ? 'Aguarde...' : 'Salvar alterações'} <ArrowRight size={16} /></button>
    </form>
  );
}

function CompetitionFieldsForm({ fields, setFields }: {
  fields: CompetitionFields;
  setFields: React.Dispatch<React.SetStateAction<CompetitionFields>>;
}) {
  return (
    <>
      <FormField label="Nome da competição">
        <FormInput value={fields.name} onChange={(event) => setFields({ ...fields, name: event.target.value })} />
      </FormField>
      <FormField label="Descrição">
        <FormInput value={fields.description ?? ''} onChange={(event) => setFields({ ...fields, description: event.target.value })} />
      </FormField>
      <FormField label="Categoria">
        <FormInput value={fields.category} onChange={(event) => setFields({ ...fields, category: event.target.value })} />
      </FormField>
      <FormField label="Formato">
        <FormSelect value={fields.format} onChange={(event) => setFields({ ...fields, format: event.target.value })}>
          <option>Pontos corridos</option>
          <option>Mata-mata</option>
          <option>Grupos + Mata-mata</option>
          <option>Personalizado</option>
        </FormSelect>
      </FormField>
      <FormField label="Limite de times por temporada (opcional)">
        <FormInput type="number" min="1" value={fields.max_teams ?? ''} onChange={(event) => setFields({ ...fields, max_teams: event.target.value ? Number(event.target.value) : null })} />
      </FormField>
      <FormField label="Abertura das inscrições">
        <FormInput type="datetime-local" value={toLocalInput(fields.registration_starts_at)} onChange={(event) => setFields({ ...fields, registration_starts_at: event.target.value ? new Date(event.target.value).toISOString() : null })} />
      </FormField>
      <FormField label="Encerramento das inscrições">
        <FormInput type="datetime-local" value={toLocalInput(fields.registration_ends_at)} onChange={(event) => setFields({ ...fields, registration_ends_at: event.target.value ? new Date(event.target.value).toISOString() : null })} />
      </FormField>
    </>
  );
}
