import { useEffect, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { supabase, type TeamRegistration } from '@/lib/supabase';
import { useCompetitions, useSeasons, useTeams, useSeasonTeams } from '@/lib/hooks';
import { LoadingCard, TeamLogo, FormField, FormSelect, FormError } from '@/components/ui';

export function RegistrationsTab() {
  const { competitions } = useCompetitions();
  const [selectedComp, setSelectedComp] = useState('');
  const { seasons } = useSeasons(selectedComp || undefined);
  const [selectedSeason, setSelectedSeason] = useState('');
  const { seasonTeams, loading: teamsLoading } = useSeasonTeams(selectedSeason || undefined);
  const { teams } = useTeams();
  const [registrations, setRegistrations] = useState<TeamRegistration[]>([]);
  const [registrationsLoading, setRegistrationsLoading] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selectedCompetition = competitions.find((competition) => competition.id === selectedComp);
  const remainingTeams = teams.filter((team) =>
    !seasonTeams.some((entry) => entry.team_id === team.id)
    && !registrations.some((registration) =>
      registration.team_id === team.id && ['PENDING', 'APPROVED'].includes(registration.status),
    ),
  );

  useEffect(() => {
    if (competitions.length > 0 && !competitions.some((competition) => competition.id === selectedComp)) {
      setSelectedComp(competitions[0].id);
      setSelectedSeason('');
    }
  }, [competitions, selectedComp]);

  useEffect(() => {
    if (seasons.length > 0 && !seasons.some((season) => season.id === selectedSeason)) {
      setSelectedSeason(seasons[0].id);
    } else if (seasons.length === 0) {
      setSelectedSeason('');
    }
  }, [seasons, selectedSeason]);

  useEffect(() => {
    if (!selectedSeason) {
      setRegistrations([]);
      setRegistrationsLoading(false);
      return;
    }
    let active = true;
    setRegistrationsLoading(true);
    supabase
      .from('team_registrations')
      .select('id, season_id, team_id, status, submitted_by, reviewed_by, reviewed_at, created_at, team:team_id ( id, name, logo_url )')
      .eq('season_id', selectedSeason)
      .order('created_at', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) setError('Não foi possível carregar as inscrições desta temporada.');
        else setRegistrations((data || []) as unknown as TeamRegistration[]);
        setRegistrationsLoading(false);
      });
    return () => { active = false; };
  }, [selectedSeason]);

  async function register(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSeason || !selectedTeam) { setError('Selecione uma temporada e um time.'); return; }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('register_team_for_season', {
      p_season_id: selectedSeason,
      p_team_id: selectedTeam,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message || 'Não foi possível criar a inscrição.'); return; }
    setSelectedTeam('');
    window.location.reload();
  }

  async function review(registration: TeamRegistration, decision: 'APPROVED' | 'REJECTED') {
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('review_team_registration', {
      p_registration_id: registration.id,
      p_decision: decision,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message || 'Não foi possível atualizar a inscrição.'); return; }
    window.location.reload();
  }

  async function withdraw(registration: TeamRegistration) {
    if (!window.confirm('Retirar este time? A retirada só será permitida se ainda não houver elenco ou partidas vinculadas.')) return;
    setBusy(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc('withdraw_team_registration', {
      p_registration_id: registration.id,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message || 'Não foi possível retirar a inscrição.'); return; }
    window.location.reload();
  }

  const statusLabel: Record<TeamRegistration['status'], string> = {
    PENDING: 'Pendente',
    APPROVED: 'Aprovada',
    REJECTED: 'Rejeitada',
    WITHDRAWN: 'Retirada',
  };

  return (
    <div className="admin-grid">
      <div className="admin-form-card">
        <h3>Inscrever time</h3>
        <form onSubmit={register}>
          <FormField label="Competição">
            <FormSelect value={selectedComp} onChange={(event) => { setSelectedComp(event.target.value); setSelectedSeason(''); setSelectedTeam(''); }}>
              <option value="">Selecione...</option>
              {competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Temporada">
            <FormSelect value={selectedSeason} onChange={(event) => { setSelectedSeason(event.target.value); setSelectedTeam(''); }} disabled={!seasons.length}>
              <option value="">Selecione...</option>
              {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Time">
            <FormSelect value={selectedTeam} onChange={(event) => setSelectedTeam(event.target.value)}>
              <option value="">Selecione...</option>
              {remainingTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </FormSelect>
          </FormField>
          <FormError message={error} />
          <button className="button button-primary" disabled={busy || !selectedSeason || !selectedTeam || selectedCompetition?.status !== 'REGISTRATION'}>
            {busy ? 'Aguarde...' : 'Enviar inscrição'} <ArrowRight size={16} />
          </button>
        </form>
        {!seasons.length && selectedComp && <p className="admin-hint">Crie uma temporada para esta competição primeiro, na aba Temporadas.</p>}
        {selectedCompetition && selectedCompetition.status !== 'REGISTRATION' && <p className="admin-hint">As inscrições só podem ser enviadas quando a competição estiver com inscrições abertas.</p>}
        {selectedCompetition?.max_teams && <p className="admin-hint">Limite da competição: {selectedCompetition.max_teams} times; aprovados nesta temporada: {seasonTeams.length}.</p>}
      </div>
      <div className="admin-list-card">
        <h3>Inscrições e times aprovados</h3>
        {teamsLoading || registrationsLoading ? <LoadingCard /> : !selectedSeason ? <p className="admin-empty-text">Selecione uma temporada.</p> : (
          <>
            <FormError message={error} />
            {registrations.length > 0 && (
              <div className="admin-list">
                {registrations.map((registration) => (
                  <div key={registration.id} className="admin-list-item">
                    <div className="admin-list-team">
                      <TeamLogo src={registration.team?.logo_url ?? null} name={registration.team?.name ?? ''} size={32} />
                      <div><strong>{registration.team?.name || '—'}</strong><span>{statusLabel[registration.status]}</span></div>
                    </div>
                    {registration.status === 'PENDING' && (
                      <div className="admin-list-actions">
                        <button className="icon-button" disabled={busy} onClick={() => review(registration, 'APPROVED')} title="Aprovar inscrição"><Check size={15} /></button>
                        <button className="icon-button-danger" disabled={busy} onClick={() => review(registration, 'REJECTED')} title="Rejeitar inscrição"><X size={15} /></button>
                      </div>
                    )}
                    {registration.status === 'APPROVED' && (
                      <div className="admin-list-actions">
                        <button className="icon-button-danger" disabled={busy} onClick={() => withdraw(registration)} title="Retirar time">Retirar</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="admin-divider" />
            <h4>Times aprovados</h4>
            {seasonTeams.length === 0 ? <p className="admin-empty-text">Nenhum time aprovado nesta temporada.</p> : (
              <div className="admin-list">
                {seasonTeams.map((entry) => (
                  <div key={entry.id} className="admin-list-item">
                    <div className="admin-list-team">
                      <TeamLogo src={entry.team?.logo_url ?? null} name={entry.team?.name ?? ''} size={32} />
                      <div><strong>{entry.team?.name || '—'}</strong><span>Aprovado</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
