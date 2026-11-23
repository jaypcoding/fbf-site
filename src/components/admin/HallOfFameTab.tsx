// "Hall da Fama" (admins only), in three parts:
// - Competições do sistema: confirms the champion, runner-up and third place
//   of a season (suggested from the official final or standings,
//   src/lib/honours.ts) and registers individual awards. Top scorers are not
//   registered: they come from the official match sheets.
// - Edições anteriores ao sistema: registers an edition played before the
//   system (with the source where the FBF confirmed it) and its records:
//   podium, top scorer and awards. Nothing is presumed: every record is typed
//   by the admin and only appears after he publishes it.
// - Premiações: the award categories (create, rename, deactivate, delete if
//   never used). No category is mandatory in an edition.
// Everything goes through the database functions, which check the admin role,
// require a reason and keep the history.
import { useEffect, useMemo, useState } from 'react';
import { Archive, CheckCircle2, Crown, Goal, Lightbulb, ListChecks, Trophy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { one } from '@/lib/relations';
import { useCompetitions, useSeasons } from '@/lib/hooks';
import { editionTitle } from '@/lib/hallOfFameData';
import { suggestPodium, type HonourKind, type Podium, type PodiumMatch, type PodiumRound, type PodiumStage } from '@/lib/honours';
import type { StandingsRow } from '@/lib/standings';
import { FormError, FormField, FormInput, FormSelect } from '@/components/ui';

type Honour = {
  id: string; kind: HonourKind; award_category_id: string | null; season_team_id: string | null; team_id: string | null; team_name: string | null;
  player_id: string | null; player_name: string | null; goals: number | null; basis: string; notes: string | null; status: 'DRAFT' | 'PUBLISHED';
};
type Category = { id: string; name: string; description: string | null; active: boolean; sort_order: number };
type Edition = { id: string; competition_name: string; edition_name: string | null; category: string | null; edition_year: number | null; started_on: string | null; ended_on: string | null; source: string; notes: string | null };
type Named = { id: string; name: string };
type SeasonTeam = { id: string; team: { name: string } | null };
type SeasonPlayer = { player_id: string; season_team_id: string; nickname: string };
type Mode = 'system' | 'historical' | 'categories';

const HONOUR_COLUMNS = 'id, kind, award_category_id, season_team_id, team_id, team_name, player_id, player_name, goals, basis, notes, status';
const PLACES: { kind: HonourKind; label: string; key: keyof Pick<Podium, 'champion' | 'runnerUp' | 'third'> }[] = [
  { kind: 'CHAMPION', label: 'Campeão', key: 'champion' },
  { kind: 'RUNNER_UP', label: 'Vice-campeão', key: 'runnerUp' },
  { kind: 'THIRD_PLACE', label: 'Terceiro lugar', key: 'third' },
];
const EMPTY_EDITION = { competition_name: '', edition_name: '', category: '', edition_year: '', started_on: '', ended_on: '', source: '', notes: '' };

export function HallOfFameTab() {
  const [mode, setMode] = useState<Mode>('system');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  async function loadCategories() {
    const { data } = await supabase.from('award_categories').select('id, name, description, active, sort_order').order('sort_order').order('name');
    setCategories((data ?? []) as Category[]);
  }
  useEffect(() => { void loadCategories(); }, []);

  // every write: reason required, error or confirmation shown, then reload
  async function run(action: () => PromiseLike<{ error: { message: string } | null }>, ok: string, after?: () => Promise<void> | void) {
    if (reason.trim().length < 3) { setError('Informe o motivo (vale para a próxima ação).'); return false; }
    setError(null);
    setDone(null);
    const { error: err } = await action();
    if (err) { setError(err.message); return false; }
    setDone(ok);
    await after?.();
    return true;
  }

  return (
    <div className="hof-admin">
      <div className="hof-admin-modes" role="group" aria-label="Parte do Hall da Fama">
        <button type="button" className="button button-outline button-small" aria-pressed={mode === 'system'} onClick={() => setMode('system')}><Trophy size={14} aria-hidden="true" /> Competições do sistema</button>
        <button type="button" className="button button-outline button-small" aria-pressed={mode === 'historical'} onClick={() => setMode('historical')}><Archive size={14} aria-hidden="true" /> Edições anteriores ao sistema</button>
        <button type="button" className="button button-outline button-small" aria-pressed={mode === 'categories'} onClick={() => setMode('categories')}><ListChecks size={14} aria-hidden="true" /> Premiações</button>
      </div>
      <FormField label="Motivo das alterações">
        <FormInput value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: final conferida pela organização" maxLength={300} />
      </FormField>
      <FormError message={error} />
      {done && <p className="lineup-saved"><CheckCircle2 size={14} aria-hidden="true" /> {done} Registrado no histórico.</p>}
      {mode === 'system' && <SystemHonours categories={categories} reason={reason} run={run} />}
      {mode === 'historical' && <HistoricalHonours categories={categories} reason={reason} run={run} />}
      {mode === 'categories' && <Categories categories={categories} reason={reason} run={run} reload={loadCategories} />}
    </div>
  );
}

type Run = (action: () => PromiseLike<{ error: { message: string } | null }>, ok: string, after?: () => Promise<void> | void) => Promise<boolean>;
type PartProps = { categories: Category[]; reason: string; run: Run };

function HonourActions({ h, canPublish, publishHint, onPublish, onRemove }: { h: Honour; canPublish: boolean; publishHint?: string; onPublish: (on: boolean) => void; onRemove: () => void }) {
  return (
    <span className="hof-admin-actions">
      <span className={`hof-status is-${h.status.toLowerCase()}`}>{h.status === 'PUBLISHED' ? 'Publicado' : 'Rascunho'}</span>
      {h.status === 'DRAFT' && <button type="button" className="button button-primary button-small" disabled={!canPublish} title={canPublish ? undefined : publishHint} onClick={() => onPublish(true)}>Publicar</button>}
      {h.status === 'PUBLISHED' && <button type="button" className="button button-outline button-small" onClick={() => onPublish(false)}>Despublicar</button>}
      {h.status === 'DRAFT' && <button type="button" className="button button-outline button-small" onClick={onRemove}>Excluir</button>}
    </span>
  );
}

// ------------------------------------------------------------- system
function SystemHonours({ categories, reason, run }: PartProps) {
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
  const [placeChoice, setPlaceChoice] = useState<Record<string, string>>({});
  const [award, setAward] = useState({ category: '', player: '', notes: '' });

  useEffect(() => { setSeasonId(''); }, [competitionId]);
  useEffect(() => { if (!seasonId && seasons.length === 1) setSeasonId(seasons[0].id); }, [seasons, seasonId]);

  async function load() {
    if (!seasonId) return;
    setLoading(true);
    const [st, stages, hon] = await Promise.all([
      supabase.from('season_teams').select('id, team:team_id ( name )').eq('season_id', seasonId),
      supabase.from('stages').select('id, stage_order, tie_breakers').eq('season_id', seasonId),
      supabase.from('season_honours').select(HONOUR_COLUMNS).eq('season_id', seasonId),
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
    const rosterPlayers = ((rosters.data ?? []) as unknown as { player_id: string; season_team_id: string; player: { nickname: string } | { nickname: string }[] | null }[])
      .map((r) => ({ player_id: r.player_id, season_team_id: r.season_team_id, nickname: one(r.player)?.nickname ?? 'Jogador' }));
    setTeams(seasonTeams);
    setPlayers(rosterPlayers.sort((a, b) => a.nickname.localeCompare(b.nickname, 'pt-BR')));
    setHonours((hon.data ?? []) as Honour[]);
    setPodium(suggestPodium(stageRows, roundRows, matches, standingRows));
    setPlaceChoice({});
    setLoading(false);
  }
  useEffect(() => { void load(); }, [seasonId]); // eslint-disable-line react-hooks/exhaustive-deps

  const teamName = (id: string | null) => teams.find((t) => t.id === id)?.team?.name ?? '—';
  const playerName = (id: string | null) => players.find((p) => p.player_id === id)?.nickname ?? 'Jogador';
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Premiação';
  const awards = useMemo(() => honours.filter((h) => h.kind === 'AWARD'), [honours]);

  const save = (kind: HonourKind, payload: Record<string, unknown>, existing?: Honour) =>
    run(() => supabase.rpc('save_season_honour', { p_id: existing?.id ?? null, p_honour: { season_id: seasonId, kind, ...payload }, p_reason: reason.trim() }), 'Rascunho salvo.', load);
  const actions = (h: Honour) => (
    <HonourActions h={h} canPublish={finished} publishHint="Só depois que a competição for encerrada"
      onPublish={(on) => void run(() => supabase.rpc('publish_season_honour', { p_id: h.id, p_publish: on, p_reason: reason.trim() }), on ? 'Publicado.' : 'Despublicado.', load)}
      onRemove={() => void run(() => supabase.rpc('delete_season_honour', { p_id: h.id, p_reason: reason.trim() }), 'Rascunho excluído.', load)} />
  );

  return (
    <>
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
      </div>
      {competition && !finished && <p className="lineup-source is-missing">A competição ainda não foi encerrada: dá para preparar rascunhos, mas a publicação fica bloqueada.</p>}

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
            <p className="admin-hint">Registre só as premiações realmente entregues nesta edição; nenhuma é obrigatória.</p>
            {awards.length === 0 && <p className="admin-empty-text">Nenhuma premiação registrada.</p>}
            <ul className="hof-admin-list">
              {awards.map((a) => <li key={a.id}><strong>{categoryName(a.award_category_id)}</strong><span>{playerName(a.player_id)}{a.season_team_id ? ` · ${teamName(a.season_team_id)}` : ''}</span>{actions(a)}</li>)}
            </ul>
            <div className="hof-admin-award">
              <FormField label="Prêmio">
                <FormSelect value={award.category} onChange={(e) => setAward((a) => ({ ...a, category: e.target.value }))}>
                  <option value="">Escolha</option>
                  {categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </FormSelect>
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
              <button type="button" className="button button-primary" disabled={!award.category || !award.player}
                onClick={() => { const [player_id, season_team_id] = award.player.split('|'); void save('AWARD', { award_category_id: award.category, player_id, season_team_id, notes: award.notes }).then((ok) => { if (ok) setAward({ category: '', player: '', notes: '' }); }); }}>
                Salvar rascunho
              </button>
            </div>
          </section>
        </>
      ))}
    </>
  );
}

// ------------------------------------------------- before the system
function HistoricalHonours({ categories, reason, run }: PartProps) {
  const [editions, setEditions] = useState<Edition[]>([]);
  const [editionId, setEditionId] = useState('');
  const [form, setForm] = useState(EMPTY_EDITION);
  const [honours, setHonours] = useState<Honour[]>([]);
  const [teams, setTeams] = useState<Named[]>([]);
  const [players, setPlayers] = useState<Named[]>([]);
  const [place, setPlace] = useState<Record<string, { team: string; name: string }>>({});
  const [entry, setEntry] = useState({ kind: 'AWARD' as 'AWARD' | 'TOP_SCORER', category: '', player: '', playerName: '', team: '', teamName: '', goals: '', notes: '' });

  async function loadEditions() {
    const { data } = await supabase.from('historical_editions').select('id, competition_name, edition_name, category, edition_year, started_on, ended_on, source, notes').order('edition_year', { ascending: false, nullsFirst: false });
    setEditions((data ?? []) as Edition[]);
  }
  async function loadHonours(id = editionId) {
    if (!id) { setHonours([]); return; }
    const { data } = await supabase.from('season_honours').select(HONOUR_COLUMNS).eq('historical_edition_id', id);
    setHonours((data ?? []) as Honour[]);
    setPlace({});
  }
  useEffect(() => {
    void loadEditions();
    void Promise.all([
      supabase.from('teams').select('id, name').order('name'),
      supabase.from('players').select('id, nickname').order('nickname'),
    ]).then(([t, p]) => {
      setTeams((t.data ?? []) as Named[]);
      setPlayers(((p.data ?? []) as { id: string; nickname: string }[]).map((x) => ({ id: x.id, name: x.nickname })));
    });
  }, []);
  useEffect(() => {
    const e = editions.find((x) => x.id === editionId);
    setForm(e ? { competition_name: e.competition_name, edition_name: e.edition_name ?? '', category: e.category ?? '', edition_year: e.edition_year ? String(e.edition_year) : '', started_on: e.started_on ?? '', ended_on: e.ended_on ?? '', source: e.source, notes: e.notes ?? '' } : EMPTY_EDITION);
    void loadHonours(editionId);
  }, [editionId, editions]); // eslint-disable-line react-hooks/exhaustive-deps

  const edition = editions.find((x) => x.id === editionId);
  const hasPublished = honours.some((h) => h.status === 'PUBLISHED');
  const teamLabel = (h: Honour) => teams.find((t) => t.id === h.team_id)?.name ?? h.team_name ?? '';
  const playerLabel = (h: Honour) => players.find((p) => p.id === h.player_id)?.name ?? h.player_name ?? 'Jogador';
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Premiação';

  const saveEdition = () => run(
    () => supabase.rpc('save_historical_edition', { p_id: editionId || null, p_edition: form, p_reason: reason.trim() }).then((r) => { if (!r.error && r.data && !editionId) setEditionId(r.data as string); return r; }),
    editionId ? 'Edição atualizada.' : 'Edição cadastrada.', loadEditions);
  const deleteEdition = () => run(() => supabase.rpc('delete_historical_edition', { p_id: editionId, p_reason: reason.trim() }), 'Edição excluída.', async () => { setEditionId(''); await loadEditions(); });
  const save = (kind: HonourKind, payload: Record<string, unknown>, existing?: Honour) =>
    run(() => supabase.rpc('save_season_honour', { p_id: existing?.id ?? null, p_honour: { historical_edition_id: editionId, kind, ...payload }, p_reason: reason.trim() }), 'Rascunho salvo.', () => loadHonours());
  const actions = (h: Honour) => (
    <HonourActions h={h} canPublish
      onPublish={(on) => void run(() => supabase.rpc('publish_season_honour', { p_id: h.id, p_publish: on, p_reason: reason.trim() }), on ? 'Confirmado e publicado.' : 'Despublicado.', () => loadHonours())}
      onRemove={() => void run(() => supabase.rpc('delete_season_honour', { p_id: h.id, p_reason: reason.trim() }), 'Rascunho excluído.', () => loadHonours())} />
  );
  const teamPayload = (team: string, name: string) => (team ? { team_id: team } : name.trim() ? { team_name: name.trim() } : {});
  const field = (key: keyof typeof EMPTY_EDITION) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value })), disabled: hasPublished });

  return (
    <>
      <p className="admin-hint">
        Edições disputadas antes do sistema não têm súmulas. Por isso, campeão, vice, terceiro, artilharia e premiações são registros digitados pela administração com base no que a FBF confirmou, e o site os mostra como "registro anterior ao sistema".
        Nada é presumido: cada registro começa como rascunho e só aparece depois que um administrador o confirma e publica.
      </p>
      <div className="hof-admin-filters">
        <FormField label="Edição">
          <FormSelect value={editionId} onChange={(e) => setEditionId(e.target.value)}>
            <option value="">Nova edição</option>
            {editions.map((e) => <option key={e.id} value={e.id}>{editionTitle(e)}{e.edition_year ? ` (${e.edition_year})` : ''}</option>)}
          </FormSelect>
        </FormField>
      </div>

      <section className="hof-admin-block">
        <h3><Archive size={16} aria-hidden="true" /> {edition ? 'Dados da edição' : 'Cadastrar edição anterior ao sistema'} <span className="hof-admin-badge">anterior ao sistema</span></h3>
        {hasPublished && <p className="admin-hint">A edição tem registros publicados; para alterar os dados dela, despublique-os antes.</p>}
        <div className="hof-admin-edition">
          <FormField label="Competição"><FormInput {...field('competition_name')} maxLength={80} placeholder="Ex.: Copa FBF" /></FormField>
          <FormField label="Edição (opcional)"><FormInput {...field('edition_name')} maxLength={80} placeholder="Ex.: 3ª edição" /></FormField>
          <FormField label="Categoria (opcional)"><FormInput {...field('category')} maxLength={40} /></FormField>
          <FormField label="Ano"><FormInput {...field('edition_year')} inputMode="numeric" maxLength={4} /></FormField>
          <FormField label="Início (opcional)"><FormInput type="date" {...field('started_on')} /></FormField>
          <FormField label="Fim (opcional)"><FormInput type="date" {...field('ended_on')} /></FormField>
          <FormField label="Fonte da confirmação"><FormInput {...field('source')} maxLength={300} placeholder="Ex.: ata da organização, anúncio no Discord" /></FormField>
          <FormField label="Observação (opcional)"><FormInput {...field('notes')} maxLength={500} /></FormField>
        </div>
        <span className="hof-admin-actions">
          <button type="button" className="button button-primary button-small" disabled={hasPublished || form.competition_name.trim().length < 2 || form.source.trim().length < 3} onClick={() => void saveEdition()}>{edition ? 'Salvar edição' : 'Cadastrar edição'}</button>
          {edition && honours.length === 0 && <button type="button" className="button button-outline button-small" onClick={() => void deleteEdition()}>Excluir edição</button>}
        </span>
      </section>

      {edition && (
        <>
          <section className="hof-admin-block">
            <h3><Crown size={16} aria-hidden="true" /> Pódio</h3>
            <ul className="hof-admin-list">
              {PLACES.map(({ kind, label }) => {
                const h = honours.find((x) => x.kind === kind);
                const p = place[kind] ?? { team: h?.team_id ?? '', name: h?.team_name ?? '' };
                const changed = (p.team || p.name.trim()) && (p.team !== (h?.team_id ?? '') || p.name.trim() !== (h?.team_name ?? ''));
                return (
                  <li key={kind}>
                    <strong>{label}</strong>
                    {h?.status === 'PUBLISHED' ? <span>{teamLabel(h)}</span> : (
                      <>
                        <FormSelect value={p.team} aria-label={`${label}: equipe cadastrada`} onChange={(e) => setPlace((c) => ({ ...c, [kind]: { team: e.target.value, name: '' } }))}>
                          <option value="">Equipe cadastrada</option>
                          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </FormSelect>
                        <span className="hof-admin-or">ou</span>
                        <FormInput value={p.name} aria-label={`${label}: nome da equipe`} placeholder="nome (equipe não cadastrada)" maxLength={60} onChange={(e) => setPlace((c) => ({ ...c, [kind]: { team: '', name: e.target.value } }))} />
                      </>
                    )}
                    {h ? actions(h) : <span className="hof-status">Não registrado</span>}
                    {h?.status !== 'PUBLISHED' && changed && (
                      <button type="button" className="button button-outline button-small" onClick={() => void save(kind, teamPayload(p.team, p.name), h)}>{h ? 'Salvar alteração' : 'Salvar rascunho'}</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="hof-admin-block">
            <h3><Goal size={16} aria-hidden="true" /> Artilharia e premiações</h3>
            <p className="admin-hint">Registre só o que a FBF confirmou. Empate na artilharia: registre cada artilheiro.</p>
            {honours.filter((h) => h.kind === 'TOP_SCORER' || h.kind === 'AWARD').length === 0 && <p className="admin-empty-text">Nenhum registro.</p>}
            <ul className="hof-admin-list">
              {honours.filter((h) => h.kind === 'TOP_SCORER' || h.kind === 'AWARD').map((h) => (
                <li key={h.id}>
                  <strong>{h.kind === 'TOP_SCORER' ? 'Artilheiro' : categoryName(h.award_category_id)}</strong>
                  <span>{playerLabel(h)}{h.goals != null ? ` · ${h.goals} gols` : ''}{teamLabel(h) ? ` · ${teamLabel(h)}` : ''}</span>
                  {actions(h)}
                </li>
              ))}
            </ul>
            <div className="hof-admin-award">
              <FormField label="Tipo">
                <FormSelect value={entry.kind} onChange={(e) => setEntry((x) => ({ ...x, kind: e.target.value as 'AWARD' | 'TOP_SCORER' }))}>
                  <option value="AWARD">Premiação individual</option>
                  <option value="TOP_SCORER">Artilheiro</option>
                </FormSelect>
              </FormField>
              {entry.kind === 'AWARD' ? (
                <FormField label="Prêmio">
                  <FormSelect value={entry.category} onChange={(e) => setEntry((x) => ({ ...x, category: e.target.value }))}>
                    <option value="">Escolha</option>
                    {categories.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </FormSelect>
                </FormField>
              ) : (
                <FormField label="Gols (se confirmado)"><FormInput value={entry.goals} inputMode="numeric" maxLength={3} onChange={(e) => setEntry((x) => ({ ...x, goals: e.target.value.replace(/\D/g, '') }))} /></FormField>
              )}
              <FormField label="Jogador cadastrado">
                <FormSelect value={entry.player} onChange={(e) => setEntry((x) => ({ ...x, player: e.target.value, playerName: '' }))}>
                  <option value="">—</option>
                  {players.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </FormSelect>
              </FormField>
              <FormField label="ou nome (não cadastrado)"><FormInput value={entry.playerName} maxLength={40} onChange={(e) => setEntry((x) => ({ ...x, playerName: e.target.value, player: '' }))} /></FormField>
              <FormField label="Equipe (opcional)">
                <FormSelect value={entry.team} onChange={(e) => setEntry((x) => ({ ...x, team: e.target.value, teamName: '' }))}>
                  <option value="">—</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </FormSelect>
              </FormField>
              <FormField label="ou nome da equipe"><FormInput value={entry.teamName} maxLength={60} onChange={(e) => setEntry((x) => ({ ...x, teamName: e.target.value, team: '' }))} /></FormField>
              <button type="button" className="button button-primary"
                disabled={!(entry.player || entry.playerName.trim().length >= 2) || (entry.kind === 'AWARD' && !entry.category)}
                onClick={() => void save(entry.kind, {
                  ...(entry.kind === 'AWARD' ? { award_category_id: entry.category } : { goals: entry.goals || null }),
                  ...(entry.player ? { player_id: entry.player } : { player_name: entry.playerName.trim() }),
                  ...teamPayload(entry.team, entry.teamName),
                }).then((ok) => { if (ok) setEntry((x) => ({ ...x, player: '', playerName: '', goals: '', team: '', teamName: '' })); })}>
                Salvar rascunho
              </button>
            </div>
          </section>
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------ categories
function Categories({ categories, reason, run, reload }: PartProps & { reload: () => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const save = (c: Category | null, payload: Record<string, unknown>, ok: string) =>
    run(() => supabase.rpc('save_award_category', { p_id: c?.id ?? null, p_category: { name: c?.name, description: c?.description, sort_order: c?.sort_order, ...payload }, p_reason: reason.trim() }), ok, reload);
  return (
    <section className="hof-admin-block">
      <h3><ListChecks size={16} aria-hidden="true" /> Categorias de premiação</h3>
      <p className="admin-hint">
        A lista de premiações que podem ser registradas nas edições. Nenhuma é obrigatória: cada edição registra só as que foram entregues.
        Uma premiação já publicada não pode ser renomeada (desative-a e crie outra) e uma premiação já usada não pode ser excluída.
      </p>
      <ul className="hof-admin-list">
        {categories.map((c) => {
          const value = draft[c.id] ?? c.name;
          return (
            <li key={c.id} className={c.active ? undefined : 'is-inactive'}>
              <strong>{c.name}</strong>
              <FormInput value={value} aria-label={`Nome de ${c.name}`} maxLength={60} onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))} />
              <span className="hof-admin-actions">
                <span className={`hof-status ${c.active ? 'is-published' : ''}`}>{c.active ? 'Ativa' : 'Desativada'}</span>
                {value.trim() !== c.name && value.trim().length >= 3 && <button type="button" className="button button-outline button-small" onClick={() => void save(c, { name: value.trim() }, 'Premiação renomeada.')}>Renomear</button>}
                <button type="button" className="button button-outline button-small" onClick={() => void save(c, { active: !c.active }, c.active ? 'Premiação desativada.' : 'Premiação reativada.')}>{c.active ? 'Desativar' : 'Reativar'}</button>
                <button type="button" className="button button-outline button-small" onClick={() => void run(() => supabase.rpc('delete_award_category', { p_id: c.id, p_reason: reason.trim() }), 'Premiação excluída.', reload)}>Excluir</button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="hof-admin-award">
        <FormField label="Nova premiação"><FormInput value={name} maxLength={60} placeholder="Ex.: Melhor fixo" onChange={(e) => setName(e.target.value)} /></FormField>
        <button type="button" className="button button-primary" disabled={name.trim().length < 3}
          onClick={() => void save(null, { name: name.trim(), sort_order: (categories[categories.length - 1]?.sort_order ?? 0) + 10 }, 'Premiação criada.').then((ok) => { if (ok) setName(''); })}>
          Criar premiação
        </button>
      </div>
    </section>
  );
}
