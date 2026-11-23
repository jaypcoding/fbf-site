// Rankings of the FBF (route /estatisticas). Totals from the official views;
// ranking rules in src/lib/stats/rankings.ts. Filters live in the URL.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BarChart3, Info } from 'lucide-react';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { usePageTitle } from '@/lib/pageTitle';
import { useRankingsData } from '@/lib/rankingsData';
import { aggregate, rank, CATEGORIES, MIN_MATCHES_EFFICIENCY, type CategoryKey } from '@/lib/stats/rankings';
import { EmptyState, LoadingCard, PageIntro, PlayerPhoto } from '@/components/ui';
import { GoalkeeperRanking } from '@/components/GoalkeeperRanking';

const PAGE = 30;
const PARTICIPATION_BASED: CategoryKey[] = ['matches', 'wins', 'pointsPct', 'goalsPerMatch', 'assistsPerMatch', 'contributionsPerMatch'];

export function StatsPage() {
  usePageTitle('Rankings');
  const refreshVersion = useAdminDataVersion();
  const { loading, error, data } = useRankingsData(refreshVersion);
  const [params, setParams] = useSearchParams();
  const [showAll, setShowAll] = useState(false);
  const competition = params.get('competicao') ?? '';
  const season = params.get('temporada') ?? '';
  const team = params.get('equipe') ?? '';
  const category = params.get('categoria') ?? '';
  const categories = CATEGORIES.filter((c) => !c.needsMvp || data?.mvpEnabled === true);
  const current = categories.find((c) => c.key === params.get('ranking')) ?? categories[0];

  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
    setShowAll(false);
  };

  const view = useMemo(() => {
    if (!data) return null;
    const visibleComps = data.competitions.filter((c) => c.status !== 'CANCELLED');
    const compIds = competition ? new Set([competition]) : category ? new Set(visibleComps.filter((c) => c.category === category).map((c) => c.id)) : new Set(visibleComps.map((c) => c.id));
    const filter = { competitionIds: compIds, seasonId: season || null, teamId: team || null };
    const totals = aggregate(data.summary, data.keeper, filter, data.mvps);
    const nameOf = (id: string) => data.players.get(id)?.nickname ?? '';
    const ranking = rank(totals, current, nameOf);
    // options of the filters inside the current scope
    const teamsInScope = [...new Set(data.summary.filter((r) => compIds.has(r.competition_id) && (!season || r.season_id === season)).map((r) => r.team_id))]
      .map((id) => data.teams.get(id)).filter(Boolean).sort((a, b) => a!.name.localeCompare(b!.name, 'pt-BR'));
    const all = [...totals.values()];
    return {
      ranking, nameOf, visibleComps, teamsInScope,
      seasonsInScope: competition ? data.seasons.filter((s) => s.competition_id === competition) : [],
      categoriesList: [...new Set(visibleComps.map((c) => c.category).filter(Boolean))] as string[],
      summary: { goals: all.reduce((s, t) => s + t.goals, 0), assists: all.reduce((s, t) => s + t.assists, 0), ownGoals: all.reduce((s, t) => s + t.ownGoals, 0), players: all.filter((t) => t.matches > 0).length },
    };
  }, [data, competition, season, team, category, current]);

  const scopeLabel = !data ? '' : competition ? [data.competitions.find((c) => c.id === competition)?.name, data.seasons.find((s) => s.id === season)?.name].filter(Boolean).join(' · ') : category ? `Histórico · categoria ${category}` : 'Histórico geral';
  const fmt = (v: number) => (current.format ? current.format(v) : v.toLocaleString('pt-BR'));
  const entries = view ? (showAll ? view.ranking.entries : view.ranking.entries.slice(0, PAGE)) : [];

  return (
    <>
      <PageIntro eyebrow="Dados oficiais" title="Rankings" description="Classificações individuais calculadas a partir das súmulas oficiais da FBF: partidas finalizadas, eventos e participações registradas." />
      <section className="container stats-section rankings-page">
        {error ? <EmptyState icon={<BarChart3 />} title="Não foi possível carregar os rankings" description="Tente atualizar a página em instantes." /> : loading || !data || !view ? <LoadingCard /> : (
          <>
            <p className="rankings-compare"><Link to={`/comparar${competition ? `?competicao=${competition}` : ''}`} className="inline-link">Comparar jogadores lado a lado</Link></p>
            <div className="rankings-filters" role="group" aria-label="Filtros dos rankings">
              <label><span>Competição</span>
                <select value={competition} onChange={(e) => set({ competicao: e.target.value, temporada: '', equipe: '', categoria: '' })}>
                  <option value="">Histórico geral (todas)</option>
                  {view.visibleComps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label><span>Temporada</span>
                <select value={season} disabled={!competition} onChange={(e) => set({ temporada: e.target.value, equipe: '' })}>
                  <option value="">{competition ? 'Todas as temporadas' : 'Escolha uma competição'}</option>
                  {view.seasonsInScope.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
              <label><span>Equipe</span>
                <select value={team} onChange={(e) => set({ equipe: e.target.value })}>
                  <option value="">Todas as equipes</option>
                  {view.teamsInScope.map((t) => <option key={t!.id} value={t!.id}>{t!.name}</option>)}
                </select>
              </label>
              {view.categoriesList.length > 1 && (
                <label><span>Categoria</span>
                  <select value={category} disabled={Boolean(competition)} onChange={(e) => set({ categoria: e.target.value, equipe: '' })}>
                    <option value="">Todas</option>
                    {view.categoriesList.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
            </div>

            <div className="stat-preview-grid is-four">
              <div className="stat-preview"><span>Gols</span><strong>{view.summary.goals}</strong><small>{scopeLabel}</small></div>
              <div className="stat-preview"><span>Assistências</span><strong>{view.summary.assists}</strong><small>{scopeLabel}</small></div>
              <div className="stat-preview"><span>Gols contra</span><strong>{view.summary.ownGoals}</strong><small>Contam para o adversário</small></div>
              <div className="stat-preview"><span>Jogadores</span><strong>{view.summary.players}</strong><small>Com participação comprovada</small></div>
            </div>

            <nav className="ranking-tabs" aria-label="Rankings">
              {categories.map((c) => (
                <button key={c.key} type="button" className={`ranking-tab${c.key === current.key ? ' active' : ''}${c.informative ? ' is-informative' : ''}`} aria-pressed={c.key === current.key} onClick={() => set({ ranking: c.key === categories[0].key ? '' : c.key })}>{c.label}</button>
              ))}
            </nav>

            <p className="ranking-min-rule"><Info size={14} aria-hidden="true" /> Rankings de eficiência (aproveitamento e médias por partida) exigem <strong>no mínimo {MIN_MATCHES_EFFICIENCY} partidas</strong> no recorte escolhido.</p>

            <div className="ranking-board">
              <div className="ranking-board-head">
                <h2>{current.label}</h2>
                <span>{scopeLabel}</span>
              </div>
              {current.efficiency && (
                <p className="ranking-note is-min">
                  Mínimo de {MIN_MATCHES_EFFICIENCY} {current.key === 'keeperConcededPerMatch' ? 'partidas como goleiro' : 'partidas'}.
                  {view.ranking.belowMinimum > 0 ? ` ${view.ranking.belowMinimum} ${view.ranking.belowMinimum === 1 ? 'jogador ainda não alcançou' : 'jogadores ainda não alcançaram'} o mínimo e não ${view.ranking.belowMinimum === 1 ? 'aparece' : 'aparecem'}.` : ''}
                  {current.key === 'pointsPct' && ' Aproveitamento = pontos conquistados ÷ pontos possíveis (vitória 3, empate 1).'}
                  {current.key === 'keeperConcededPerMatch' && ' Menor é melhor; conta só os gols sofridos enquanto o jogador estava no gol.'}
                </p>
              )}
              {current.informative && <p className="ranking-note">Categoria informativa, não é premiação. Gols contra contam para a equipe adversária.</p>}
              {PARTICIPATION_BASED.includes(current.key) && <p className="ranking-note">Partidas e vitórias contam apenas participações comprovadas: escalação registrada, gol, assistência ou registro de goleiro.</p>}
              {view.ranking.entries.length === 0 ? (
                <p className="feed-empty">{current.efficiency ? `Ainda não há jogadores com ${MIN_MATCHES_EFFICIENCY} partidas neste recorte.` : 'Ainda não há registros neste recorte.'}</p>
              ) : (
                <ol className="ranking-list">
                  {entries.map((e) => {
                    const p = data.players.get(e.totals.playerId);
                    const teamNames = e.totals.teamIds.map((id) => data.teams.get(id)?.name).filter(Boolean);
                    return (
                      <li key={e.totals.playerId}>
                        <Link to={`/jogadores/${p?.slug ?? e.totals.playerId}`} className={`ranking-row${e.position <= 3 ? ` podium-${e.position}` : ''}`}>
                          <span className="stats-pos" title={e.tied ? 'Empatado nesta posição' : undefined}>{e.position}{e.tied ? '=' : ''}</span>
                          <PlayerPhoto src={p?.photo_url ?? null} name={p?.nickname ?? '?'} size={32} />
                          <span className="ranking-player"><strong>{p?.nickname ?? 'Jogador'}</strong><small>{teamNames.length > 2 ? `${teamNames.length} equipes` : teamNames.join(' · ')}</small></span>
                          <span className="ranking-sample">{current.key === 'keeperConcededPerMatch' ? `${e.totals.keeperMatches} J no gol` : `${e.totals.matches} J`}</span>
                          <span className="ranking-value">{fmt(e.value)}{!current.format && <small> {e.value === 1 ? current.unit[0] : current.unit[1]}</small>}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              )}
              {view.ranking.entries.length > PAGE && <button type="button" className="button button-outline profile-more" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Mostrar menos' : `Ver todos (${view.ranking.entries.length})`}</button>}
              <p className="ranking-note is-rules">Empates dividem a posição (indicados com “=”); a ordem dentro do empate é alfabética e não é critério de desempate.</p>
            </div>
          </>
        )}
      </section>
      <section className="container content-section">
        <div className="section-heading"><div><span className="section-kicker">Goleiros / CS</span><h2>Tempo sem sofrer gol</h2></div></div>
        {(season || team) && <p className="ranking-note">Este ranking oficial de goleiros considera a competição escolhida (sem filtro de temporada ou equipe).</p>}
        <GoalkeeperRanking competitionId={competition || undefined} />
      </section>
    </>
  );
}
