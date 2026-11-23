// MVP of the match: highlighted winner(s) and the full, explainable breakdown
// of every candidate, read from the official view match_mvp_scores (the
// calculation happens in the database; nothing here decides the result).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Award, ChevronDown } from 'lucide-react';
import { useMatchMvp, type MvpRow } from '@/lib/mvp';
import { PlayerPhoto } from '@/components/ui';
import { formatClock } from '@/lib/time';

const pts = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

function Breakdown({ r }: { r: MvpRow }) {
  const items: [string, string][] = [];
  if (r.goals) items.push([`${r.goals} ${r.goals === 1 ? 'gol' : 'gols'}`, pts(r.points_goals)]);
  if (r.assists) items.push([`${r.assists} ${r.assists === 1 ? 'assistência' : 'assistências'}`, pts(r.points_assists)]);
  if (r.was_goalkeeper) items.push([r.keeper_time_unknown ? 'goleiro (minuto de gol sofrido desconhecido)' : `${r.keeper_blocks} × 2 min sem sofrer gol`, pts(r.points_keeper)]);
  if (r.won) items.push(['vitória', pts(r.points_win)]);
  if (r.own_goals) items.push([`${r.own_goals} ${r.own_goals === 1 ? 'gol contra' : 'gols contra'}`, pts(r.points_own_goals)]);
  return <ul className="mvp-breakdown">{items.map(([label, value]) => <li key={label}><span>{label}</span><strong className={value.startsWith('−') ? 'is-negative' : ''}>{value}</strong></li>)}</ul>;
}

export function MatchMvp({ matchId, homeName, awayName, homeTeamId, refreshKey = 0 }: { matchId: string; homeName: string; awayName: string; homeTeamId?: string | null; refreshKey?: number }) {
  const { data, players, lineups } = useMatchMvp(matchId, refreshKey);
  const [open, setOpen] = useState(false);
  if (data === null) return null; // MVP not published (and not a manager preview)
  const { rows, status, preview } = data;
  const teamName = (side: 'home' | 'away') => (side === 'home' ? homeName : awayName);
  const mvps = rows.filter((r) => r.is_mvp);
  const name = (id: string) => players[id]?.nickname ?? 'Jogador';
  const link = (id: string) => `/jogadores/${players[id]?.slug ?? id}`;
  const missingLineup = Object.entries(lineups).filter(([, ok]) => !ok).map(([st]) => (st === homeTeamId ? homeName : awayName));

  return (
    <section className="mvp-section" aria-labelledby="mvp-title">
      <h2 id="mvp-title" className="match-page-heading">MVP da partida</h2>
      {preview && <p className="mvp-preview">Prévia para a organização: o MVP ainda não está publicado e visitantes não veem esta seção.</p>}
      {status === 'WALKOVER' ? (
        <p className="mvp-empty">Sem MVP: partida identificada pela organização como W.O.</p>
      ) : status === 'PENDING_REVIEW' && !preview && rows.length === 0 ? (
        <p className="mvp-empty">MVP pendente de revisão: há gol registrado sem autor e a organização ainda vai conferir a partida.</p>
      ) : status === 'PENDING_REVIEW' ? (
        <p className="mvp-empty">MVP pendente de revisão: há gol registrado sem autor. Confirme no painel se foi W.O. ou uma partida normal (botão Escalação).</p>
      ) : status === 'UNAVAILABLE' ? (
        <p className="mvp-empty">Sem MVP: o resultado foi registrado sem os eventos da partida.</p>
      ) : rows.length === 0 ? (
        <p className="mvp-empty">Sem MVP: a partida não tem jogadores com participação registrada.</p>
      ) : mvps.length === 0 ? (
        <p className="mvp-empty">Sem MVP: nenhum jogador terminou com pontuação positiva.</p>
      ) : (
        <div className={`mvp-winners${mvps.length > 1 ? ' is-shared' : ''}`}>
          {mvps.map((r) => (
            <div key={r.player_id} className="mvp-card">
              <span className="mvp-badge"><Award size={14} aria-hidden="true" /> {mvps.length > 1 ? 'MVP compartilhado' : 'MVP'}</span>
              <div className="mvp-who">
                <PlayerPhoto src={players[r.player_id]?.photo_url ?? null} name={name(r.player_id)} size={48} />
                <div className="mvp-who-text"><Link to={link(r.player_id)} className="mvp-name">{name(r.player_id)}</Link><span>{teamName(r.side)}</span></div>
                <strong className="mvp-total">{r.total}<small>pts</small></strong>
              </div>
              <Breakdown r={r} />
            </div>
          ))}
        </div>
      )}
      {rows.length > 0 && (
        <div className="mvp-explain">
          <button type="button" className="mvp-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <ChevronDown size={15} aria-hidden="true" className={open ? 'is-open' : ''} /> Como a pontuação foi calculada
          </button>
          {open && (
            <>
              <div className="mvp-table-wrap">
                <table className="mvp-table">
                  <thead><tr><th>Jogador</th><th>Gols</th><th>Assist.</th><th>Goleiro</th><th>Vitória</th><th>Contra</th><th>Total</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.player_id} className={r.is_mvp ? 'is-mvp' : ''}>
                        <td><Link to={link(r.player_id)}>{name(r.player_id)}</Link><small>{teamName(r.side)}</small></td>
                        <td>{r.goals} <small>({pts(r.points_goals)})</small></td>
                        <td>{r.assists} <small>({pts(r.points_assists)})</small></td>
                        <td>{r.was_goalkeeper ? <>{r.keeper_time_unknown ? '—' : `${r.keeper_blocks}×`} <small>({pts(r.points_keeper)}) · {formatClock(r.keeper_seconds)} no gol, {r.keeper_goals_conceded} sofrido(s)</small></> : '—'}</td>
                        <td>{r.won ? <small>(+2)</small> : '—'}</td>
                        <td>{r.own_goals ? <>{r.own_goals} <small>({pts(r.points_own_goals)})</small></> : '—'}</td>
                        <td><strong>{r.total}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mvp-rules">
                Fórmula oficial da FBF: gol +3 · assistência +2 · +1 a cada 2 minutos completos como goleiro sem sofrer gol (cada gol sofrido interrompe a contagem) · vitória +2 · gol contra −3.
                Disputa de pênaltis conta como empate. Empate na maior pontuação divide o MVP; sem pontuação positiva, não há MVP.
                Concorrem os jogadores com participação registrada: escalação, gol, assistência ou registro de goleiro.
                {missingLineup.length > 0 && <> <strong>Escalação não registrada ({missingLineup.join(' e ')}):</strong> nessa equipe só aparecem os jogadores com gol, assistência ou registro de goleiro.</>}
                {data.review === 'VALID' && data.goalsWithoutAuthor > 0 && <> A organização confirmou que a partida foi disputada normalmente; {data.goalsWithoutAuthor === 1 ? 'o gol sem autor registrado não dá pontos' : 'os gols sem autor registrado não dão pontos'} a ninguém.</>}
                {rows.some((r) => r.keeper_time_unknown) && <> Um gol sofrido sem minuto informado impede dividir o tempo do goleiro; por isso o goleiro dessa equipe não recebeu pontos de tempo sem sofrer gol.</>}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
