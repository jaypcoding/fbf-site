// "Hall da Fama" (admins only): confirms the champion, runner-up and third
// place of a season and registers individual awards. The podium is suggested
// from the official final or standings (src/lib/honours.ts); the admin
// confirms it. Everything goes through save/publish/delete_season_honour(),
// which check the admin role, require a reason, keep the history and refuse
// publishing before the competition is finished.
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Crown, Lightbulb } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useCompetitions, useSeasons } from '@/lib/hooks';
import { suggestPodium, type HonourKind, type Podium, type PodiumMatch, type PodiumRound, type PodiumStage } from '@/lib/honours';
import type { StandingsRow } from '@/lib/standings';
import { FormError, FormField, FormInput, FormSelect } from '@/components/ui';

type Honour = { id: string; kind: HonourKind; award_name: string | null; season_team_id: string | null; player_id: string | null; basis: string; notes: string | null; status: 'DRAFT' | 'PUBLISHED' };
type SeasonTeam = { id: string; team: { name: string } | null };
type SeasonPlayer = { player_id: string; season_team_id: string; nickname: string };

const PLACES: { kind: HonourKind; label: string; key: keyof Pick<Podium, 'champion' | 'runnerUp' | 'third'> }[] = [
  { kind: 'CHAMPION', label: 'Campeão', key: 'champion' },
  { kind: 'RUNNER_UP', label: 'Vice-campeão', key: 'runnerUp' },
  { kind: 'THIRD_PLACE', label: 'Terceiro lugar', key: 'third' },
];
const AWARD_PRESETS = ['Melhor jogador', 'Melhor goleiro', 'Melhor volante', 'Melhor pivô', 'Revelação', 'Craque da final'];
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export function HallOfFameTab() {
  const { competitions } = useCompetitions();
  const [competitionId, setCompetitionId] = useState('');
  const { seasons } = useSeasons(competitionId || undefined, true);
  const [seasonId, setSeasonId] = useState('');
  const competition = competitions.find((c) => c.id === competitionId);
  const finished = competition?.status === 'FINISHED';

  const [loading, setLoading] = useState(false);
  const [teams, setTeams] = useState<SeasonTeam[]>([]);
  const [players, setPlayers] = useState<SeasonPlayer[]>([]);
  const [honours, setHonours] = useState<Honour[]>([]);
  const [podium, setPodium] = useState<Podium | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [placeChoice, setPlaceChoice] = useState<Record<string, string>>({});
  const [award, setAward] = useState({ name: '', player: '', notes: '' });

  useEffect(() => { setSeasonId(''); }, [competitionId]);
  useEffect(() => { if (!seasonId && seasons.length === 1) setSeasonId(seasons[0].id); }, [seasons, seasonId]);

  async function load() {
    if (!seasonId) return;
    setLoading(true);
    const [st, stages, hon] = await Promise.all([
      supabase.from('season_teams').select('id, team:team_id ( name )').eq('season_id', seasonId),
      supabase.from('stages').select('id, stage_order, tie_breakers').eq('season_id', seasonId),
      supabase.from('season_honours').select('id, kind, award_name, season_team_id, player_id, basis, notes, status').eq('season_id', seasonId),
    ]);
    const seasonTeams = ((st.data ?? []) as unknown as { id: string; team: { name: string } | { name: string }[] | null }[]).map((t) => ({ id: t.id, team: one(t.team) }));
    const stageRows = (stages.data ?? []) as PodiumStage[];
    const stageIds = stageRows.map((s) => s.id);
    const [rounds, standings, rosters] = await Promise.all([
      stageIds.length ? supabase.from('rounds').select('id, stage_id, phase_type, bracket_round, name').in('stage_id', stageIds) : Promise.resolve({ data: [] }),
      stageIds.length ? supabase.from('stage_standings').select('stage_id, season_team_id, team_id, team_name, team_logo_url, stage_group_id, group_name, played, wins, draws, losses, goals_for, goals_against, points').in('stage_id', stageIds) : Promise.resolve({ data: [] }),
      seasonTeams.length ? supabase.from('rosters').select('player_id, season_team_id, player:player_id ( nickname )').in('season_team_id', seasonTeams.map((t) => t.id)) : Promise.resolve({ data: [] }),
    ]);
    const roundRows = (rounds.data ?? []) as PodiumRound[];
    const matches = roundRows.length
      ? ((await supabase.from('matches').select('id, round_id, status, series_id, series_leg, home_team_id, away_team_id, home_score, away_score, home_penalty_score, away_penalty_score, home_source_outcome, away_source_outcome').in('round_id', roundRows.map((r) => r.id))).data ?? []) as PodiumMatch[]
      : [];
    // the standings view gives teams by team_id; the podium works with season teams
    const standingRows = ((standings.data ?? []) as StandingsRow[]).map((r) => ({ ...r, team_id: r.season_team_id }));
    const p = suggestPodium(stageRows, roundRows, matches, standingRows);
    const rosterPlayers = ((rosters.data ?? []) as unknown as { player_id: string; season_team_id: string; player: { nickname: string } | { nickname: string }[] | null }[])
      .map((r) => ({ player_id: r.player_id, season_team_id: r.season_team_id, nickname: one(r.player)?.nickname ?? 'Jogador' }));
    setTeams(seasonTeams);
    setPlayers(rosterPlayers.sort((a, b) => a.nickname.localeCompare(b.nickname, 'pt-BR')));
    setHonours((hon.data ?? []) as Honour[]);
    setPodium(p);
    setPlaceChoice({});
    setLoading(false);
  }
  useEffect(() => { void load(); }, [seasonId]); // eslint-disable-line react-hooks/exhaustive-deps

  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.team?.name ?? '—';
  const playerName = (id: string | null) => players.find((p) => p.player_id === id)?.nickname ?? 'Jogador';
  const awards = useMemo(() => honours.filter((h) => h.kind === 'AWARD'), [honours]);

  async function run(action: () => PromiseLike<{ error: { message: string } | null }>, ok: string) {
    if (reason.trim().length < 3) { setError('Informe o motivo (vale para a próxima ação).'); return false; }
    setError(null);
    setDone(null);
    const { error: err } = await action();
    if (err) { setError(err.message); return false; }
    setDone(ok);
    await load();
    return true;
  }
  const save = (kind: HonourKind, payload: Record<string, unknown>, existing?: Honour) =>
    run(() => supabase.rpc('save_season_honour', { p_id: existing?.id ?? null, p_honour: { season_id: seasonId, kind, ...payload }, p_reason: reason.trim() }), 'Rascunho salvo.');
  const publish = (h: Honour, on: boolean) => run(() => supabase.rpc('publish_season_honour', { p_id: h.id, p_publish: on, p_reason: reason.trim() }), on ? 'Publicado.' : 'Despublicado.');
  const remove = (h: Honour) => run(() => supabase.rpc('delete_season_honour', { p_id: h.id, p_reason: reason.trim() }), 'Rascunho excluído.');

  const actions = (h: Honour) => (
    <span className="hof-admin-actions">
      <span className={`hof-status is-${h.status.toLowerCase()}`}>{h.status === 'PUBLISHED' ? 'Publicado' : 'Rascunho'}</span>
      {h.status === 'DRAFT' && <button type="button" className="button button-primary button-small" disabled={!finished} title={finished ? undefined : 'Só depois que a competição for encerrada'} onClick={() => void publish(h, true)}>Publicar</button>}
      {h.status === 'PUBLISHED' && <button type="button" className="button button-outline button-small" onClick={() => void publish(h, false)}>Despublicar</button>}
      {h.status === 'DRAFT' && <button type="button" className="button button-outline button-small" onClick={() => void remove(h)}>Excluir</button>}
    </span>
  );

  return (
    <div className="hof-admin">
      <p className="admin-hint">
        Títulos e premiações são registros oficiais da FBF. Tudo começa como rascunho e só aparece no site depois de publicado, o que só é possível com a competição encerrada.
        Artilheiros não precisam de registro: vêm das súmulas oficiais.
      </p>
      <div className="hof-admin-filters">
        <FormField label="Competição">
          <FormSelect value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
            <option value="">Escolha</option>
            {competitions.filter((c) => c.status !== 'DRAFT' && c.status !== 'CANCELLED').map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === 'FINISHED' ? ' (encerrada)' : ''}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Temporada">
          <FormSelect value={seasonId} disabled={!competitionId} onChange={(e) => setSeasonId(e.target.value)}>
            <option value="">Escolha</option>
            {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </FormSelect>
        </FormField>
        <FormField label="Motivo das alterações">
          <FormInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: final conferida pela organização" maxLength={300} />
        </FormField>
      </div>
      {competition && !finished && <p className="lineup-source is-missing">A competição ainda não foi encerrada: dá para preparar rascunhos, mas a publicação fica bloqueada.</p>}
      <FormError message={error} />
      {done && <p className="lineup-saved"><CheckCircle2 size={14} aria-hidden="true" /> {done} Registrado no histórico.</p>}

      {seasonId && (loading || !podium ? <p className="admin-empty-text">Carregando...</p> : (
        <>
          <section className="hof-admin-block">
            <h3><Crown size={16} aria-hidden="true" /> Pódio</h3>
            <p className="hof-suggestion"><Lightbulb size={14} aria-hidden="true" /> Sugestão pelos dados oficiais ({podium.basis === 'FINAL' ? 'final do mata-mata' : podium.basis === 'STANDINGS' ? 'classificação da última fase' : 'sem base'}):
              {' '}{podium.champion ? `campeão ${teamName(podium.champion)}, vice ${teamName(podium.runnerUp)}${podium.third ? `, 3º ${teamName(podium.third)}` : ''}.` : 'nenhuma.'}
              {podium.notes.map((n) => <span key={n} className="hof-note"> {n}</span>)}
            </p>
            <ul className="hof-admin-list">
              {PLACES.map(({ kind, label, key }) => {
                const h = honours.find((x) => x.kind === kind);
                const suggested = podium[key];
                const choice = placeChoice[kind] ?? h?.season_team_id ?? suggested ?? '';
                return (
                  <li key={kind}>
                    <strong>{label}</strong>
                    {h?.status === 'PUBLISHED' ? <span>{teamName(h.season_team_id)}</span> : (
                      <FormSelect value={choice} onChange={(e) => setPlaceChoice((c) => ({ ...c, [kind]: e.target.value }))} aria-label={label}>
                        <option value="">Não registrar</option>
                        {teams.map((t) => <option key={t.id} value={t.id}>{t.team?.name}{t.id === suggested ? ' (sugerido)' : ''}</option>)}
                      </FormSelect>
                    )}
                    {h ? actions(h) : <span className="hof-status">Não registrado</span>}
                    {h?.status !== 'PUBLISHED' && choice && choice !== h?.season_team_id && (
                      <button type="button" className="button button-outline button-small" onClick={() => void save(kind, { season_team_id: choice, basis: choice === suggested ? podium.basis ?? 'MANUAL' : 'MANUAL' }, h)}>{h ? 'Salvar alteração' : 'Salvar rascunho'}</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="hof-admin-block">
            <h3>Premiações individuais</h3>
            {awards.length === 0 && <p className="admin-empty-text">Nenhuma premiação registrada.</p>}
            <ul className="hof-admin-list">
              {awards.map((a) => <li key={a.id}><strong>{a.award_name}</strong><span>{playerName(a.player_id)}{a.season_team_id ? ` · ${teamName(a.season_team_id)}` : ''}</span>{actions(a)}</li>)}
            </ul>
            <div className="hof-admin-award">
              <FormField label="Prêmio">
                <FormInput list="hof-award-presets" value={award.name} onChange={(e) => setAward((a) => ({ ...a, name: e.target.value }))} placeholder="Ex.: Melhor goleiro" maxLength={60} />
                <datalist id="hof-award-presets">{AWARD_PRESETS.map((n) => <option key={n} value={n} />)}</datalist>
              </FormField>
              <FormField label="Jogador">
                <FormSelect value={award.player} onChange={(e) => setAward((a) => ({ ...a, player: e.target.value }))}>
                  <option value="">Escolha</option>
                  {players.map((p) => <option key={`${p.player_id}|${p.season_team_id}`} value={`${p.player_id}|${p.season_team_id}`}>{p.nickname} · {teamName(p.season_team_id)}</option>)}
                </FormSelect>
              </FormField>
              <FormField label="Observação (opcional)">
                <FormInput value={award.notes} onChange={(e) => setAward((a) => ({ ...a, notes: e.target.value }))} maxLength={300} />
              </FormField>
              <button type="button" className="button button-primary" disabled={award.name.trim().length < 3 || !award.player}
                onClick={() => { const [player_id, season_team_id] = award.player.split('|'); void save('AWARD', { award_name: award.name.trim(), player_id, season_team_id, notes: award.notes }).then((ok) => { if (ok) setAward({ name: '', player: '', notes: '' }); }); }}>
                Salvar rascunho
              </button>
            </div>
          </section>
        </>
      ))}
    </div>
  );
}
