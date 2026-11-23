// Hall da Fama (route /hall-da-fama). Finished competitions of the system and
// editions played before it. Titles and individual awards are the official
// honours published by the FBF; top scorers of the system come from the
// official statistics, those before the system are confirmed records; MVP
// leaders appear only when the MVP is published. Nothing here is decided by
// the page.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Archive, Award, Crown, Goal, Medal, Trophy } from 'lucide-react';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { usePageTitle } from '@/lib/pageTitle';
import { useHallOfFame, type HofHonour, type HofTeam } from '@/lib/hallOfFameData';
import { titleTable } from '@/lib/honours';
import { EmptyState, LoadingCard, PageIntro, PlayerPhoto, TeamLogo } from '@/components/ui';

const PLACES: { kind: HofHonour['kind']; label: string; icon: typeof Trophy }[] = [
  { kind: 'CHAMPION', label: 'Campeão', icon: Crown },
  { kind: 'RUNNER_UP', label: 'Vice-campeão', icon: Medal },
  { kind: 'THIRD_PLACE', label: 'Terceiro lugar', icon: Medal },
];

function TeamName({ team, size }: { team: HofTeam; size: number }) {
  const body = <><TeamLogo src={team.logo_url} name={team.name} size={size} /> {team.name}</>;
  return team.id ? <Link to={`/times/${team.id}`} className="hof-team">{body}</Link> : <span className="hof-team">{body}</span>;
}

export function HallOfFamePage() {
  usePageTitle('Hall da Fama');
  const refreshVersion = useAdminDataVersion();
  const { loading, error, data } = useHallOfFame(refreshVersion);

  const view = useMemo(() => {
    if (!data) return null;
    const byEdition = (id: string) => data.honours.filter((h) => h.editionId === id);
    const titles = titleTable(data.honours.map((h) => ({ season_id: h.editionId, kind: h.kind, team_id: h.team?.id ?? null, team_name: h.team?.name ?? null }))).filter((t) => t.titles > 0);
    const editions = data.editions.filter((e) => byEdition(e.id).length > 0 || data.scorers.some((x) => x.seasonId === e.id));
    return { editions, byEdition, titles, hasHistorical: editions.some((e) => e.historical) };
  }, [data]);

  const playerLink = (id: string | null, name: string | null) => {
    if (!id) return <span className="hof-player">{name ?? 'Jogador'}</span>;
    const p = data?.players.get(id);
    return <Link to={`/jogadores/${p?.slug ?? id}`} className="hof-player"><PlayerPhoto src={p?.photo_url ?? null} name={p?.nickname ?? '?'} size={28} /> {p?.nickname ?? 'Jogador'}</Link>;
  };

  return (
    <>
      <PageIntro eyebrow="História da FBF" title="Hall da Fama" description="Campeões, artilheiros e premiações das competições encerradas. Títulos e prêmios são registros oficiais da FBF; artilheiros vêm das súmulas oficiais." />
      <section className="container content-section hof-page">
        {error ? <EmptyState icon={<Trophy />} title="Não foi possível carregar o Hall da Fama" description="Tente atualizar a página em instantes." />
          : loading || !data || !view ? <LoadingCard />
          : view.editions.length === 0 ? (
            <EmptyState icon={<Trophy />} title="Ainda não há competições encerradas" description="Quando uma competição terminar e a FBF confirmar o campeão, ele aparece aqui junto com o artilheiro e as premiações." />
          ) : (
            <>
              {view.titles.length > 0 && (
                <div className="hof-block">
                  <h2><Trophy size={18} aria-hidden="true" /> Maiores campeões</h2>
                  <ol className="hof-titles">
                    {view.titles.map((t) => {
                      const team = t.teamId ? data.teams.get(t.teamId) : null;
                      const name = team?.name ?? t.teamName ?? 'Equipe';
                      const body = <><TeamLogo src={team?.logo_url ?? null} name={name} size={32} /><strong>{name}</strong></>;
                      return (
                        <li key={t.key}>
                          {t.teamId ? <Link to={`/times/${t.teamId}`}>{body}</Link> : <span className="hof-titles-name">{body}</span>}
                          <span><b>{t.titles}</b> {t.titles === 1 ? 'título' : 'títulos'}</span>
                          <small>{t.runnerUps ? `${t.runnerUps} vice` : ''}{t.runnerUps && t.thirds ? ' · ' : ''}{t.thirds ? `${t.thirds} 3º` : ''}</small>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              <div className="hof-seasons">
                {view.editions.map((e) => {
                  const honours = view.byEdition(e.id);
                  const awards = honours.filter((h) => h.kind === 'AWARD');
                  const recordedScorers = honours.filter((h) => h.kind === 'TOP_SCORER');
                  const scorers = data.scorers.find((x) => x.seasonId === e.id);
                  const mvp = data.mvpLeaders?.find((m) => m.seasonId === e.id);
                  const hasPodium = honours.some((h) => h.kind === 'CHAMPION');
                  return (
                    <article key={e.id} className={`hof-season${e.historical ? ' is-historical' : ''}`}>
                      <header>
                        {e.competitionId ? <Link to={`/competicoes/${e.competitionId}`}><h3>{e.title}</h3></Link> : <h3>{e.title}</h3>}
                        <span className="hof-tags">
                          {e.yearLabel && e.historical && <span className="hof-year">{e.yearLabel}</span>}
                          {e.category && <span className="hof-category">{e.category}</span>}
                        </span>
                      </header>
                      {e.historical && <p className="hof-historical"><Archive size={14} aria-hidden="true" /> Registro anterior ao sistema, confirmado pela FBF.</p>}
                      {hasPodium ? (
                        <ul className="hof-podium">
                          {PLACES.map(({ kind, label, icon: Icon }) => {
                            const h = honours.find((x) => x.kind === kind);
                            if (!h?.team) return null;
                            return (
                              <li key={kind} className={`is-${kind.toLowerCase()}`}>
                                <span className="hof-place"><Icon size={14} aria-hidden="true" /> {label}</span>
                                <TeamName team={h.team} size={kind === 'CHAMPION' ? 44 : 32} />
                                {h.notes && <small>{h.notes}</small>}
                              </li>
                            );
                          })}
                        </ul>
                      ) : <p className="hof-pending">Campeão ainda não confirmado pela FBF.</p>}
                      <dl className="hof-facts">
                        {scorers && (
                          <div><dt><Goal size={14} aria-hidden="true" /> {scorers.players.length > 1 ? 'Artilheiros' : 'Artilheiro'}</dt>
                            <dd>{scorers.players.map((p) => <span key={p.playerId}>{playerLink(p.playerId, null)}</span>)} <b>{scorers.goals} {scorers.goals === 1 ? 'gol' : 'gols'}</b></dd></div>
                        )}
                        {recordedScorers.length > 0 && (
                          <div><dt><Goal size={14} aria-hidden="true" /> {recordedScorers.length > 1 ? 'Artilheiros' : 'Artilheiro'}</dt>
                            <dd>{recordedScorers.map((h) => <span key={h.id}>{playerLink(h.player_id, h.player_name)}{h.goals != null && <b> {h.goals} {h.goals === 1 ? 'gol' : 'gols'}</b>}{h.team && <small> {h.team.name}</small>}</span>)}</dd></div>
                        )}
                        {mvp && (
                          <div><dt><Award size={14} aria-hidden="true" /> Mais MVPs</dt>
                            <dd>{mvp.playerIds.map((p) => <span key={p}>{playerLink(p, null)}</span>)} <b>{mvp.count}</b></dd></div>
                        )}
                        {awards.map((a) => (
                          <div key={a.id}><dt><Award size={14} aria-hidden="true" /> {a.award ?? 'Premiação'}</dt><dd>{playerLink(a.player_id, a.player_name)}{a.team && <small> {a.team.name}</small>}{a.notes && <small> {a.notes}</small>}</dd></div>
                        ))}
                      </dl>
                      {e.historical && e.source && <p className="hof-source">Fonte: {e.source}</p>}
                    </article>
                  );
                })}
              </div>
              <p className="ranking-note is-rules">
                Artilheiros: gols oficiais da competição (gols contra não contam); empates dividem o posto. Campeões e premiações individuais são confirmados e publicados pela FBF.
                {view.hasHistorical && ' Nas edições anteriores ao sistema não há súmulas: todos os dados, inclusive a artilharia, são registros confirmados pela FBF.'}
              </p>
            </>
          )}
      </section>
    </>
  );
}
