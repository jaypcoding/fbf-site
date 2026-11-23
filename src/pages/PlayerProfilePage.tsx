// Public profile of a player (/jogadores/<slug> or /jogadores/<id>). All the
// numbers come from the official views through usePlayerProfile.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CircleUserRound, Users } from 'lucide-react';
import { useAdminDataVersion } from '@/lib/adminRefresh';
import { usePageTitle } from '@/lib/pageTitle';
import { formatMatchDate, plural } from '@/lib/format';
import { usePlayerProfile, type SeasonLine } from '@/lib/playerProfile';
import { FEATURE_MVP } from '@/lib/features';
import { EmptyState, LoadingCard, PlayerPhoto, TeamLogo } from '@/components/ui';

const RESULT_LABEL: Record<'W' | 'D' | 'L', string> = { W: 'V', D: 'E', L: 'D' };
const RESULT_TITLE: Record<'W' | 'D' | 'L', string> = { W: 'Vitória', D: 'Empate', L: 'Derrota' };
const MATCHES_PAGE = 10;

function PerformanceBars({ lines, label }: { lines: SeasonLine[]; label: (l: SeasonLine) => string }) {
  // shown only with two or more seasons: a single season is already in the numbers above
  const max = Math.max(1, ...lines.map((l) => Math.max(l.goals, l.assists)));
  return (
    <figure className="perf-bars" aria-label="Gols e assistências por temporada">
      <figcaption>
        <span>Gols e assistências por temporada</span>
        <span className="perf-legend"><i className="is-goals" aria-hidden="true" /> Gols <i className="is-assists" aria-hidden="true" /> Assistências</span>
      </figcaption>
      {lines.slice(0, 6).map((l) => (
        <div key={l.key} className="perf-row">
          <span className="perf-label">{label(l)}</span>
          <div className="perf-track">
            <div className="perf-bar-line"><span className="perf-bar is-goals" style={{ width: `${(l.goals / max) * 100}%` }} title={`${l.goals} gols`} /><b>{l.goals}</b></div>
            <div className="perf-bar-line"><span className="perf-bar is-assists" style={{ width: `${(l.assists / max) * 100}%` }} title={`${l.assists} assistências`} /><b>{l.assists}</b></div>
          </div>
        </div>
      ))}
    </figure>
  );
}

export function PlayerDetailPage() {
  const { id } = useParams();
  const refreshVersion = useAdminDataVersion();
  const { loading, error, profile } = usePlayerProfile(id, refreshVersion);
  const [showAll, setShowAll] = useState(false);
  usePageTitle(profile?.player.nickname ?? (loading ? null : 'Jogador'));

  if (loading) return <section className="container detail-section"><LoadingCard /></section>;
  if (error) return <section className="container detail-section"><EmptyState icon={<CircleUserRound />} title="Não foi possível carregar o jogador" description="Tente novamente mais tarde." actionLabel="Ver todos os jogadores" actionTo="/jogadores" /></section>;
  if (!profile) return <section className="container detail-section"><EmptyState icon={<CircleUserRound />} title="Jogador não encontrado" description="O jogador que você procura ainda não está cadastrado." actionLabel="Ver todos os jogadores" actionTo="/jogadores" /></section>;

  const { player, totals, matches, seasons, teams, keeper, incomplete, names } = profile;
  const current = teams[0];
  const visible = showAll ? matches : matches.slice(0, MATCHES_PAGE);
  const seasonLabel = (l: SeasonLine) => [names.competitions[l.competitionId], names.seasons[l.seasonId]].filter(Boolean).join(' · ');

  return (
    <section className="container detail-section player-profile">
      <Link to="/jogadores" className="back-link">← Todos os jogadores</Link>
      <div className="detail-hero">
        <div>
          <span className="status-pill"><span /> {player.position}</span>
          <h1>{player.nickname}</h1>
          <p>{[player.full_name, player.nationality].filter(Boolean).join(' · ') || 'Jogador registrado na FBF.'}</p>
        </div>
        <div className="detail-emblem"><PlayerPhoto src={player.photo_url} name={player.nickname} size={74} /></div>
      </div>
      <div className="detail-meta">
        <div><span>Equipe mais recente</span><strong>{current ? <Link to={`/times/${current.teamId}`} className="inline-link">{current.teamName}</Link> : '—'}</strong></div>
        <div><span>Temporada</span><strong>{current ? [current.competitionName, current.seasonName].filter(Boolean).join(' · ') || '—' : '—'}</strong></div>
        <div><span>Posição</span><strong>{player.position}</strong></div>
        <div><span>Camisa</span><strong>{current?.shirt ?? '—'}</strong></div>
      </div>

      <div className="stat-grid profile-stats">
        <div><span>Partidas</span><strong>{totals.matches}</strong></div>
        <div><span>V · E · D</span><strong>{totals.wins} · {totals.draws} · {totals.losses}</strong></div>
        <div title="Pontos conquistados pela equipe nas partidas do jogador ÷ pontos possíveis (vitória 3, empate 1)"><span>Aproveitamento</span><strong>{totals.pointsPct === null ? '—' : `${totals.pointsPct.toLocaleString('pt-BR')}%`}</strong></div>
        <div><span>Gols</span><strong>{totals.goals}</strong></div>
        <div><span>Assistências</span><strong>{totals.assists}</strong></div>
        <div title="Participações em gol: gols + assistências"><span>Gols + assist.</span><strong>{totals.contributions}</strong></div>
        <div><span>Gols contra</span><strong>{totals.ownGoals}</strong></div>
        {FEATURE_MVP && <div className="is-mvp"><span>MVPs</span><strong>{totals.mvps}</strong></div>}
        {keeper && keeper.games > 0 && <div><span>Goleiro · clean sheets</span><strong>{keeper.clean_sheets}<small> em {keeper.games}</small></strong></div>}
      </div>

      {incomplete.length > 0 && (
        <p className="standings-notice profile-notice" role="note">
          <strong>Histórico incompleto:</strong>{' '}
          {incomplete.map((i) => `${i.matches} ${i.matches === 1 ? 'partida' : 'partidas'} de ${i.teamName}`).join(', ')} sem escalação registrada.
          Nelas só contam os jogadores com gol, assistência ou registro de goleiro; as partidas e vitórias deste perfil podem estar abaixo do real até a organização registrar a escalação.
        </p>
      )}

      <h2 className="match-page-heading">Desempenho por competição</h2>
      {seasons.length === 0 ? (
        <EmptyState icon={<Users />} title="Sem partidas registradas" description="As partidas aparecem aqui quando o jogador tiver participação registrada em uma súmula oficial." />
      ) : (
        <>
          <div className="profile-table-wrap">
            <table className="profile-table">
              <thead><tr><th>Competição</th><th>Equipe</th><th title="Partidas">J</th><th title="Vitórias">V</th><th title="Empates">E</th><th title="Derrotas">D</th><th title="Gols">G</th><th title="Assistências">A</th><th title="Gols contra">GC</th>{FEATURE_MVP && <th title="MVPs">MVP</th>}</tr></thead>
              <tbody>
                {seasons.map((l) => (
                  <tr key={l.key}>
                    <td>{seasonLabel(l) || '—'}</td>
                    <td><Link to={`/times/${l.teamId}`} className="profile-team"><TeamLogo src={names.teams[l.teamId]?.logo ?? null} name={names.teams[l.teamId]?.name ?? ''} size={22} />{names.teams[l.teamId]?.name ?? '—'}</Link></td>
                    <td>{l.matches}</td><td>{l.wins}</td><td>{l.draws}</td><td>{l.losses}</td><td><strong>{l.goals}</strong></td><td>{l.assists}</td><td>{l.ownGoals}</td>{FEATURE_MVP && <td>{l.mvps}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {seasons.length >= 2 && <PerformanceBars lines={seasons} label={seasonLabel} />}
        </>
      )}

      <h2 className="match-page-heading">Partidas</h2>
      {matches.length === 0 ? <p className="admin-empty-text">Nenhuma partida com participação registrada.</p> : (
        <>
          <ol className="profile-matches">
            {visible.map((m) => (
              <li key={m.match_id}>
                <Link to={`/partidas/${m.match_id}`} className="profile-match">
                  <span className={`profile-result result-${(m.result ?? 'x').toLowerCase()}`} title={m.result ? RESULT_TITLE[m.result] : 'Sem resultado'}>{m.result ? RESULT_LABEL[m.result] : '—'}</span>
                  <span className="profile-match-main">
                    <span className="profile-match-teams"><strong>{m.teamName}</strong> {m.teamScore ?? '–'} × {m.opponentScore ?? '–'} {m.opponentName}{m.penalties ? <small> (pên. {m.penalties})</small> : null}</span>
                    <small>{[m.competitionName, m.stageName, m.roundName].filter(Boolean).join(' · ')}{m.scheduled_at ? ` · ${formatMatchDate(m.scheduled_at)}` : ''}</small>
                  </span>
                  <span className="profile-match-tags">
                    {m.goals > 0 && <span className="profile-tag">{m.goals} {m.goals === 1 ? 'gol' : 'gols'}</span>}
                    {m.assists > 0 && <span className="profile-tag">{m.assists} assist.</span>}
                    {m.own_goals > 0 && <span className="profile-tag is-negative">{m.own_goals} contra</span>}
                    {m.was_goalkeeper && <span className="profile-tag">goleiro</span>}
                    {FEATURE_MVP && m.mvp && <span className="profile-tag is-mvp">MVP · {m.mvpPoints} pts</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
          {matches.length > MATCHES_PAGE && <button type="button" className="button button-outline profile-more" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Mostrar menos' : `Ver todas as ${matches.length} partidas`}</button>}
        </>
      )}

      <h2 className="match-page-heading">Histórico de equipes</h2>
      {teams.length === 0 ? <EmptyState icon={<Users />} title="Sem histórico de equipes" description="Este jogador ainda não foi vinculado a nenhuma equipe em uma temporada." /> : (
        <div className="team-grid">{teams.map((t) => (
          <Link key={t.seasonTeamId} to={`/times/${t.teamId}`} className="team-card">
            <div className="team-card-logo"><TeamLogo src={t.teamLogo} name={t.teamName} size={56} /></div>
            <h3>{t.teamName}</h3>
            <span className="team-card-season">{[t.competitionName, t.seasonName].filter(Boolean).join(' · ') || 'Temporada'}</span>
            <span className="team-card-season">{plural(t.matches, 'partida', 'partidas')}</span>
          </Link>
        ))}</div>
      )}
    </section>
  );
}
