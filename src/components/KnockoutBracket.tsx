import { Link } from 'react-router-dom';
import { ArrowRight, Trophy } from 'lucide-react';
import type { Match, Stage } from '@/lib/supabase';
import { TeamLogo } from '@/components/ui';

type BracketSeries = {
  id: string;
  roundNumber: number;
  matches: Match[];
};

function roundLabel(roundNumber: number, finalRound: number) {
  const remaining = finalRound - roundNumber;
  if (remaining === 0) return 'Final';
  if (remaining === 1) return 'Semifinais';
  if (remaining === 2) return 'Quartas de final';
  if (remaining === 3) return 'Oitavas de final';
  return `Fase eliminatória ${roundNumber}`;
}

function teamName(match: Match, side: 'home' | 'away') {
  const team = side === 'home' ? match.home_team : match.away_team;
  const source = side === 'home' ? match.home_source_outcome : match.away_source_outcome;
  if (team?.team?.name) return team.team.name;
  if (source) return source === 'WINNER' ? 'Aguardando vencedor' : 'Aguardando perdedor';
  return 'A definir';
}

function seriesAggregate(series: Match[], homeTeamId: string | null, awayTeamId: string | null) {
  if (series.length < 2 || !homeTeamId || !awayTeamId
      || series.some((match) => match.status !== 'FINISHED' || match.home_score === null || match.away_score === null)) {
    return null;
  }
  const totals = new Map([[homeTeamId, 0], [awayTeamId, 0]]);
  for (const match of series) {
    if (![match.home_team_id, match.away_team_id].includes(homeTeamId)
        || ![match.home_team_id, match.away_team_id].includes(awayTeamId)) return null;
    if (match.home_team_id === homeTeamId) {
      totals.set(homeTeamId, (totals.get(homeTeamId) ?? 0) + (match.home_score ?? 0));
      totals.set(awayTeamId, (totals.get(awayTeamId) ?? 0) + (match.away_score ?? 0));
    } else {
      totals.set(homeTeamId, (totals.get(homeTeamId) ?? 0) + (match.away_score ?? 0));
      totals.set(awayTeamId, (totals.get(awayTeamId) ?? 0) + (match.home_score ?? 0));
    }
  }
  return { home: totals.get(homeTeamId) ?? 0, away: totals.get(awayTeamId) ?? 0 };
}

export function KnockoutBracket({ matches, stages }: { matches: Match[]; stages: Stage[] }) {
  const knockoutMatches = matches.filter((match) => match.round?.phase_type === 'KNOCKOUT' && match.round.bracket_round !== null);
  if (knockoutMatches.length === 0) return null;

  const stagesById = new Map<string, Map<number, Map<string, BracketSeries>>>();
  for (const match of knockoutMatches) {
    const roundNumber = match.round?.bracket_round ?? 0;
    const rounds = stagesById.get(match.round?.stage_id ?? '') ?? new Map<number, Map<string, BracketSeries>>();
    const roundSeries = rounds.get(roundNumber) ?? new Map<string, BracketSeries>();
    const seriesId = match.series_id ?? match.id;
    const series = roundSeries.get(seriesId) ?? {
      id: seriesId,
      roundNumber,
      matches: [],
    };
    series.matches.push(match);
    roundSeries.set(seriesId, series);
    rounds.set(roundNumber, roundSeries);
    stagesById.set(match.round?.stage_id ?? '', rounds);
  }

  return (
    <section className="knockout-section">
      <div className="section-heading">
        <div><span className="section-kicker">Chave eliminatória</span><h2>Caminho até a final</h2></div>
        <Trophy size={22} />
      </div>
      {[...stagesById.entries()].map(([stageId, rounds]) => {
        const finalRound = Math.max(...rounds.keys());
        const stage = stages.find((item) => item.id === stageId);
        return (
          <div className="knockout-stage" key={stageId}>
            {stage && <h3>{stage.name}</h3>}
            <div className="knockout-board">
              {[...rounds.entries()].sort(([a], [b]) => a - b).map(([roundNumber, seriesMap]) => (
                <div className="knockout-round" key={roundNumber}>
                  <h3>{roundLabel(roundNumber, finalRound)}</h3>
                  {[...seriesMap.values()].map((series) => {
                    const orderedMatches = [...series.matches].sort((a, b) => a.series_leg - b.series_leg);
                    const firstMatch = orderedMatches[0];
                    const isThirdPlace = firstMatch.round?.name === 'Disputa do terceiro lugar';
                    const aggregate = seriesAggregate(
                      orderedMatches,
                      firstMatch.home_team_id,
                      firstMatch.away_team_id,
                    );
                    return (
                      <article className="knockout-series" key={series.id}>
                        {isThirdPlace && <p className="knockout-series-label">Disputa do terceiro lugar</p>}
                        <div className="knockout-team">
                          <TeamLogo src={firstMatch.home_team?.team?.logo_url ?? null} name={teamName(firstMatch, 'home')} size={26} />
                          <span>{teamName(firstMatch, 'home')}</span>
                        </div>
                        <div className="knockout-team">
                          <TeamLogo src={firstMatch.away_team?.team?.logo_url ?? null} name={teamName(firstMatch, 'away')} size={26} />
                          <span>{teamName(firstMatch, 'away')}</span>
                        </div>
                        {orderedMatches.map((match) => (
                          <Link className="knockout-leg" key={match.id} to={`/partidas/${match.id}`}>
                            <span>{orderedMatches.length > 1 ? (match.series_leg === 1 ? 'Ida' : 'Volta') : match.round?.name}</span>
                            <strong>{(match.status === 'FINISHED' || match.status === 'LIVE')
                              && match.home_score !== null && match.away_score !== null
                              ? `${match.home_score} × ${match.away_score}${match.home_penalty_score !== null && match.away_penalty_score !== null
                                ? ` (${match.home_penalty_score}–${match.away_penalty_score} pên.)`
                                : ''}${match.status === 'LIVE' ? ' · AO VIVO' : ''}`
                              : match.status === 'CANCELLED' ? 'Cancelada' : match.status === 'POSTPONED' ? 'Adiada' : 'Pendente'}</strong>
                            <ArrowRight size={14} />
                          </Link>
                        ))}
                        {aggregate && (
                          <p className="knockout-aggregate">
                            Agregado <strong>{aggregate.home} × {aggregate.away}</strong>
                          </p>
                        )}
                      </article>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
