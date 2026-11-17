import { useEffect, useState } from 'react';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { supabase, type Season } from '@/lib/supabase';
import { useManagedCompetitions, useSeasons } from '@/lib/hooks';
import { refreshAdminData } from '@/lib/adminRefresh';
import { LoadingCard, Modal, FormField, FormInput, FormSelect, FormError } from '@/components/ui';

export function SeasonsTab() {
  const { competitions, loading: compLoading, error: competitionsError } = useManagedCompetitions();
  const [selectedComp, setSelectedComp] = useState<string>('');
  const { seasons, loading, error: seasonsError } = useSeasons(selectedComp || undefined);
  const [name, setName] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Season | null>(null);

  useEffect(() => {
    if (!selectedComp && competitions.length > 0) setSelectedComp(competitions[0].id);
  }, [competitions, selectedComp]);

  async function createSeason(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedComp || !name.trim()) { setError('Selecione uma competição e dê um nome à temporada.'); return; }
    if (startsAt && endsAt && endsAt < startsAt) { setError('A data de fim não pode ser anterior à data de início.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('seasons').insert({ competition_id: selectedComp, name: name.trim(), starts_at: startsAt || null, ends_at: endsAt || null });
    setBusy(false);
    if (err) { setError(err.message || 'Não foi possível criar a temporada.'); return; }
    setName(''); setStartsAt(''); setEndsAt('');
    refreshAdminData();
  }

  async function deleteSeason(id: string) {
    const [teamResult, stageResult] = await Promise.all([
      supabase.from('season_teams').select('id', { count: 'exact', head: true }).eq('season_id', id),
      supabase.from('stages').select('id', { count: 'exact', head: true }).eq('season_id', id),
    ]);
    if (teamResult.error || stageResult.error) { setError('Não foi possível verificar os dados vinculados à temporada.'); return; }
    if (teamResult.count || stageResult.count) {
      setError('Esta temporada possui equipes inscritas ou fases cadastradas e não pode ser removida. Preserve o histórico da competição.');
      return;
    }
    if (!window.confirm('Remover esta temporada vazia?')) return;
    const { error: err } = await supabase.from('seasons').delete().eq('id', id);
    if (err) { setError('Não foi possível remover a temporada. O banco pode estar protegendo dados vinculados.'); return; }
    refreshAdminData();
  }

  const filteredSeasons = selectedComp ? seasons.filter((s) => s.competition_id === selectedComp) : seasons;

  return (
    <div className="admin-grid">
      <div className="admin-form-card">
        <h3>Nova temporada</h3>
        <form onSubmit={createSeason}>
          <FormField label="Competição">
            <FormSelect value={selectedComp} onChange={(e) => setSelectedComp(e.target.value)} disabled={compLoading}>
              <option value="">Selecione...</option>
              {competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Nome da temporada">
            <FormInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Temporada 2026" />
          </FormField>
          <FormField label="Data de início">
            <FormInput type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </FormField>
          <FormField label="Data de fim">
            <FormInput type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </FormField>
          <FormError message={error} />
          <button className="button button-primary" disabled={busy}>{busy ? 'Aguarde...' : 'Criar temporada'} <ArrowRight size={16} /></button>
        </form>
      </div>
      <div className="admin-list-card">
        <h3>Temporadas cadastradas</h3>
        {competitionsError || seasonsError ? <FormError message="Não foi possível carregar as competições e temporadas autorizadas." /> : loading ? <LoadingCard /> : filteredSeasons.length === 0 ? <p className="admin-empty-text">Nenhuma temporada criada ainda.</p> : (
          <div className="admin-list">
            {filteredSeasons.map((s) => {
              const comp = competitions.find((c) => c.id === s.competition_id);
              return (
                <div key={s.id} className="admin-list-item">
                  <div>
                    <strong>{s.name}</strong>
                    <span>{comp?.name || '—'}{s.starts_at ? ` · ${new Date(s.starts_at).toLocaleDateString('pt-BR')}` : ''}</span>
                  </div>
                  <div className="admin-list-actions">
                    <button className="icon-button" onClick={() => setEditing(s)} title="Editar"><Pencil size={15} /></button>
                    <button className="icon-button-danger" onClick={() => deleteSeason(s.id)} title="Remover"><Trash2 size={15} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {editing && (
        <Modal title="Editar temporada" onClose={() => setEditing(null)}>
          <SeasonEditForm season={editing} onSaved={() => setEditing(null)} />
        </Modal>
      )}
    </div>
  );
}

function SeasonEditForm({ season, onSaved }: { season: Season; onSaved: () => void }) {
  const [name, setName] = useState(season.name);
  const [startsAt, setStartsAt] = useState(season.starts_at ?? '');
  const [endsAt, setEndsAt] = useState(season.ends_at ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) { setError('Dê um nome à temporada.'); return; }
    if (startsAt && endsAt && endsAt < startsAt) { setError('A data de fim não pode ser anterior à data de início.'); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from('seasons').update({ name: name.trim(), starts_at: startsAt || null, ends_at: endsAt || null }).eq('id', season.id);
    setBusy(false);
    if (err) { setError(err.message || 'Não foi possível salvar as alterações.'); return; }
    refreshAdminData();
    onSaved();
  }

  return (
    <form onSubmit={save}>
      <FormField label="Nome da temporada">
        <FormInput value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <FormField label="Data de início">
        <FormInput type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
      </FormField>
      <FormField label="Data de fim">
        <FormInput type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
      </FormField>
      <FormError message={error} />
      <button className="button button-primary" disabled={busy}>{busy ? 'Aguarde...' : 'Salvar alterações'} <ArrowRight size={16} /></button>
    </form>
  );
}
