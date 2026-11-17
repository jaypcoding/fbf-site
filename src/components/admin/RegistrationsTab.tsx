import { useEffect, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { supabase, type TeamRegistration } from '@/lib/supabase';
import { useManagedCompetitions, useSeasons, useTeams, useSeasonTeams } from '@/lib/hooks';
import { refreshAdminData, useAdminDataVersion } from '@/lib/adminRefresh';
import { LoadingCard, TeamLogo, FormField, FormSelect, FormError } from '@/components/ui';

export function RegistrationsTab() {
  const { competitions, loading: competitionsLoading, error: competitionsError } = useManagedCompetitions();
  const [selectedComp, setSelectedComp] = useState('');
  const { seasons, loading: seasonsLoading, error: seasonsError } = useSeasons(selectedComp || undefined);
  const [selectedSeason, setSelectedSeason] = useState('');
  const { seasonTeams, loading: seasonTeamsLoading, error: seasonTeamsError } = useSeasonTeams(selectedSeason || undefined);
  const { teams, loading: teamsLoading, error: teamsError } = useTeams();
  const [registrations, setRegistrations] = useState<TeamRegistration[]>([]);
  const [registrationsLoading, setRegistrationsLoading] = useState(false);
  const [registrationsError, setRegistrationsError] = useState(false);
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refreshVersion = useAdminDataVersion();
  const selectedCompetition = competitions.find((competition) => competition.id === selectedComp);
  const remainingTeams = teams.filter((team) =>
    !seasonTeams.some((entry) => entry.team_id === team.id)
    && !registrations.some((registration) =>
      registration.team_id === team.id && ['PENDING', 'APPROVED'].includes(registration.status),
    ),
  );
  const pendingCount = registrations.filter((registration) => registration.status === 'PENDING').length;

  useEffect(() => {
    const availableIds = new Set(remainingTeams.map((team) => team.id));
    setSelectedTeamIds((current) => {
      const next = current.filter((teamId) => availableIds.has(teamId));
      return next.length === current.length ? current : next;
    });
  }, [remainingTeams]);

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
    setRegistrationsError(false);
    supabase
      .from('team_registrations')
      .select('id, season_id, team_id, status, submitted_by, reviewed_by, reviewed_at, created_at, team:team_id ( id, name, logo_url )')
      .eq('season_id', selectedSeason)
      .order('created_at', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) {
          setRegistrations([]);
          setRegistrationsError(true);
          setError('Não foi possível carregar as inscrições desta temporada. Verifique o acesso à competição e tente novamente.');
        }
        else setRegistrations((data || []) as unknown as TeamRegistration[]);
        setRegistrationsLoading(false);
      });
    return () => { active = false; };
  }, [selectedSeason, refreshVersion]);

  async function register(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedSeason || selectedTeamIds.length === 0) { setError('Selecione uma temporada e pelo menos um time.'); return; }
    setBusy(true);
    setError(null);
    const failedIds: string[] = [];
    const failures: string[] = [];
    for (const teamId of selectedTeamIds) {
      const { error: rpcError } = await supabase.rpc('register_team_for_season', {
        p_season_id: selectedSeason,
        p_team_id: teamId,
      });
      if (rpcError) {
        failedIds.push(teamId);
        const teamName = teams.find((team) => team.id === teamId)?.name ?? 'Time selecionado';
        failures.push(`${teamName}: ${rpcError.message || 'não foi possível criar a inscrição'}`);
      }
    }
    setBusy(false);
    setSelectedTeamIds(failedIds);
    if (failedIds.length < selectedTeamIds.length) refreshAdminData();
    if (failures.length > 0) setError(`Algumas inscrições não foram concluídas. ${failures.join(' ')}`);
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
    refreshAdminData();
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
    refreshAdminData();
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
            <FormSelect value={selectedComp} disabled={competitionsLoading} onChange={(event) => { setError(null); setSelectedComp(event.target.value); setSelectedSeason(''); setSelectedTeamIds([]); }}>
              <option value="">Selecione...</option>
              {competitions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}
            </FormSelect>
          </FormField>
          <FormField label="Temporada">
            <FormSelect value={selectedSeason} onChange={(event) => { setError(null); setSelectedSeason(event.target.value); setSelectedTeamIds([]); }} disabled={seasonsLoading || !seasons.length}>
              <option value="">Selecione...</option>
              {seasons.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
            </FormSelect>
          </FormField>
          <div className="form-field">
            <span className="form-field-label">Times cadastrados</span>
            {teamsLoading || seasonTeamsLoading || registrationsLoading ? <LoadingCard /> : teamsError || seasonTeamsError || registrationsError ? (
              <FormError message="Não foi possível carregar todos os dados de inscrição. Verifique suas permissões para esta competição e tente novamente." />
            ) : !selectedSeason ? (
              <p className="admin-empty-text">Selecione uma temporada para ver os times disponíveis.</p>
            ) : remainingTeams.length === 0 ? (
              <p className="admin-empty-text">{teams.length === 0 ? 'Cadastre equipes na plataforma antes de inscrevê-las.' : 'Não há equipes disponíveis para inscrição nesta temporada.'}</p>
            ) : (
              <div className="admin-list">
                {remainingTeams.map((team) => (
                  <label key={team.id} className="admin-list-item">
                    <span className="admin-list-team">
                      <TeamLogo src={team.logo_url} name={team.name} size={30} />
                      <strong>{team.name}</strong>
                    </span>
                    <input
                      type="checkbox"
                      checked={selectedTeamIds.includes(team.id)}
                      disabled={busy || selectedCompetition?.status !== 'REGISTRATION'}
                      onChange={(event) => setSelectedTeamIds((current) =>
                        event.target.checked
                          ? [...current, team.id]
                          : current.filter((id) => id !== team.id),
                      )}
                      aria-label={`Selecionar ${team.name} para inscrição`}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
          <FormError message={error} />
          <button className="button button-primary" disabled={busy || !selectedSeason || !selectedTeamIds.length || selectedCompetition?.status !== 'REGISTRATION'}>
            {busy ? 'Aguarde...' : `Enviar inscrição${selectedTeamIds.length ? ` (${selectedTeamIds.length})` : ''}`} <ArrowRight size={16} />
          </button>
        </form>
        <FormError message={competitionsError ? 'Não foi possível carregar as competições.' : seasonsError ? 'Não foi possível carregar as temporadas.' : null} />
        {!seasons.length && selectedComp && <p className="admin-hint">Crie uma temporada para esta competição primeiro, na aba Temporadas.</p>}
        {selectedCompetition && selectedCompetition.status !== 'REGISTRATION' && <p className="admin-hint">As inscrições só podem ser enviadas quando a competição estiver com inscrições abertas.</p>}
        {selectedCompetition?.max_teams && <p className="admin-hint">Limite da competição: {selectedCompetition.max_teams} times; aprovados: {seasonTeams.length}; pendentes: {pendingCount}.</p>}
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
