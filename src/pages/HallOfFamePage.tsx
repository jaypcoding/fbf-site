// Hall da Fama (route /hall-da-fama). Only finished competitions. Titles and
// individual awards are the official honours published by the FBF; top
// scorers come from the official statistics; MVP leaders appear only when the
// MVP is published. Nothing here is decided by the page.
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Award, Crown, Goal, Medal, Trophy } from 'lucide-react';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { usePageTitle } from '@/lib/pageTitle';
import { useHallOfFame, type HofHonour, type HofSeason } from '@/lib/hallOfFameData';
import { titleTable } from '@/lib/honours';
import { EmptyState, LoadingCard, PageIntro, PlayerPhoto, TeamLogo } from '@/components/ui';

const PLACES: { kind: HofHonour['kind']; label: string; icon: typeof Trophy }[] = [
  { kind: 'CHAMPION', label: 'Campeão', icon: Crown },
  { kind: 'RUNNER_UP', label: 'Vice-campeão', icon: Medal },
  { kind: 'THIRD_PLACE', label: 'Terceiro lugar', icon: Medal },
];

export function HallOfFamePage() {
  usePageTitle('Hall da Fama');
  const refreshVersion = useAdminDataVersion();
  const { loading, error, data } = useHallOfFame(refreshVersion);

  const view = useMemo(() => {
    if (!data) return null;
    // newest first: end date when known, otherwise the name
    const seasons = [...data.seasons].sort((a, b) => (b.ends_at ?? '').localeCompare(a.ends_at ?? '') || b.competition.name.localeCompare(a.competition.name, 'pt-BR'));
    const bySeason = (id: string) => data.honours.filter((h) => h.season_id === id);
    const titles = titleTable(data.honours.map((h) => ({ season_id: h.season_id, kind: h.kind, team_id: h.team?.id ?? null }))).filter((t) => t.titles > 0);
    const withContent = seasons.filter((s) => bySeason(s.id).length > 0 || data.scorers.some((x) => x.seasonId === s.id));
    return { seasons: withContent, bySeason, titles };
  }, [data]);

  const playerLink = (id: string) => {
    const p = data?.players.get(id);
    return <Link to={`/jogadores/${p?.slug ?? id}`} className="hof-player"><PlayerPhoto src={p?.photo_url ?? null} name={p?.nickname ?? '?'} size={28} /> {p?.nickname ?? 'Jogador'}</Link>;
  };
  const seasonTitle = (s: HofSeason) => (s.name && s.name !== s.competition.name ? `${s.competition.name} · ${s.name}` : s.competition.name);

  return (
    <>
      <PageIntro eyebrow="História da FBF" title="Hall da Fama" description="Campeões, artilheiros e premiações das competições encerradas. Títulos e prêmios são registros oficiais da FBF; artilheiros vêm das súmulas oficiais." />
      <section className="container content-section hof-page">
        {error ? <EmptyState icon={<Trophy />} title="Não foi possível carregar o Hall da Fama" description="Tente atualizar a página em instantes." />
          : loading || !data || !view ? <LoadingCard />
          : view.seasons.length === 0 ? (
            <EmptyState icon={<Trophy />} title="Ainda não há competições encerradas" description="Quando uma competição terminar e a FBF confirmar o campeão, ele aparece aqui junto com o artilheiro e as premiações." />
          ) : (
            <>
              {view.titles.length > 0 && (
                <div className="hof-block">
                  <h2><Trophy size={18} aria-hidden="true" /> Maiores campeões</h2>
                  <ol className="hof-titles">
                    {view.titles.map((t) => {
                      const team = data.teams.get(t.teamId);
                      return (
                        <li key={t.teamId}>
                          <Link to={`/times/${t.teamId}`}><TeamLogo src={team?.logo_url ?? null} name={team?.name ?? '?'} size={32} /><strong>{team?.name ?? 'Equipe'}</strong></Link>
                          <span><b>{t.titles}</b> {t.titles === 1 ? 'título' : 'títulos'}</span>
                          <small>{t.runnerUps ? `${t.runnerUps} vice` : ''}{t.runnerUps && t.thirds ? ' · ' : ''}{t.thirds ? `${t.thirds} 3º` : ''}</small>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              <div className="hof-seasons">
                {view.seasons.map((s) => {
                  const honours = view.bySeason(s.id);
                  const awards = honours.filter((h) => h.kind === 'AWARD');
                  const scorers = data.scorers.find((x) => x.seasonId === s.id);
                  const mvp = data.mvpLeaders?.find((m) => m.seasonId === s.id);
                  const champion = honours.find((h) => h.kind === 'CHAMPION');
                  return (
                    <article key={s.id} className="hof-season">
                      <header>
                        <Link to={`/competicoes/${s.competition.id}`}><h3>{seasonTitle(s)}</h3></Link>
                        {s.competition.category && <span className="hof-category">{s.competition.category}</span>}
                      </header>
                      {champion ? (
                        <ul className="hof-podium">
                          {PLACES.map(({ kind, label, icon: Icon }) => {
                            const h = honours.find((x) => x.kind === kind);
                            if (!h?.team) return null;
                            return (
                              <li key={kind} className={`is-${kind.toLowerCase()}`}>
                                <span className="hof-place"><Icon size={14} aria-hidden="true" /> {label}</span>
                                <Link to={`/times/${h.team.id}`} className="hof-team"><TeamLogo src={h.team.logo_url} name={h.team.name} size={kind === 'CHAMPION' ? 44 : 32} /> {h.team.name}</Link>
                                {h.notes && <small>{h.notes}</small>}
                              </li>
                            );
                          })}
                        </ul>
                      ) : <p className="hof-pending">Campeão ainda não confirmado pela FBF.</p>}
                      <dl className="hof-facts">
                        {scorers && (
                          <div><dt><Goal size={14} aria-hidden="true" /> {scorers.players.length > 1 ? 'Artilheiros' : 'Artilheiro'}</dt>
                            <dd>{scorers.players.map((p) => <span key={p.playerId}>{playerLink(p.playerId)}</span>)} <b>{scorers.goals} {scorers.goals === 1 ? 'gol' : 'gols'}</b></dd></div>
                        )}
                        {mvp && (
                          <div><dt><Award size={14} aria-hidden="true" /> Mais MVPs</dt>
                            <dd>{mvp.playerIds.map((p) => <span key={p}>{playerLink(p)}</span>)} <b>{mvp.count}</b></dd></div>
                        )}
                        {awards.map((a) => (
                          <div key={a.id}><dt><Award size={14} aria-hidden="true" /> {a.award_name}</dt><dd>{a.player_id && playerLink(a.player_id)}{a.notes && <small> {a.notes}</small>}</dd></div>
                        ))}
                      </dl>
                    </article>
                  );
                })}
              </div>
              <p className="ranking-note is-rules">Artilheiros: gols oficiais da competição (gols contra não contam); empates dividem o posto. Campeões e premiações individuais são confirmados e publicados pela FBF.</p>
            </>
          )}
      </section>
    </>
  );
}
