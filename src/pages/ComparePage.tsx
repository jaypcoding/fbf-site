// Comparador de jogadores (route /comparar). Up to three players, the same
// scope for everybody (all, one competition or one season) and, optionally,
// only the matches in which all of them took part. Numbers come from the
// official per-match statistics, totalled by the same function as the
// rankings (src/lib/stats/compare.ts); MVPs only when the MVP is published.
// The state lives in the address (?jogadores=a,b&competicao=..&temporada=..&comuns=1)
// so a comparison can be shared.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Info, Plus, Swords, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchMvpEnabled } from '@/lib/features';
import { usePageTitle } from '@/lib/pageTitle';
import { compareTotals, COMPARE_METRICS, headToHead, leaders, MIN_MATCHES_EFFICIENCY, type MatchStatRow } from '@/lib/stats/compare';
import type { KeeperMatchRow, MvpAwardRow } from '@/lib/stats/rankings';
import { EmptyState, FormField, FormSelect, LoadingCard, PageIntro, PlayerPhoto } from '@/components/ui';

type Player = { id: string; nickname: string; slug: string | null; photo_url: string | null; position: string | null };
type Competition = { id: string; name: string; status: string };
type Season = { id: string; name: string; competition_id: string };
const MAX_PLAYERS = 3;

function useBase() {
  const [state, setState] = useState<{ players: Player[]; competitions: Competition[]; seasons: Season[]; mvpEnabled: boolean } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([
      supabase.from('players').select('id, nickname, slug, photo_url, position').order('nickname'),
      supabase.from('competitions').select('id, name, status').not('status', 'in', '(DRAFT,CANCELLED)').order('name'),
      supabase.from('seasons').select('id, name, competition_id'),
      fetchMvpEnabled(),
    ]).then(([p, c, s, mvpEnabled]) => {
      if (!active) return;
      if (p.error || c.error || s.error) { setError(true); return; }
      setState({ players: (p.data ?? []) as Player[], competitions: (c.data ?? []) as Competition[], seasons: (s.data ?? []) as Season[], mvpEnabled });
    });
    return () => { active = false; };
  }, []);
  return { base: state, error };
}

function usePlayerStats(ids: string[], mvpEnabled: boolean) {
  const key = ids.slice().sort().join(',');
  const [state, setState] = useState<{ key: string; rows: MatchStatRow[]; keeper: KeeperMatchRow[]; mvps: MvpAwardRow[]; error: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    if (ids.length === 0) { setState({ key, rows: [], keeper: [], mvps: [], error: false }); return () => { active = false; }; }
    void Promise.all([
      supabase.from('player_match_stats').select('match_id, player_id, competition_id, season_id, team_id, side, result, goals, assists, own_goals, was_goalkeeper').in('player_id', ids),
      supabase.from('player_match_keeping').select('player_id, competition_id, season_id, team_id, match_id, goals_conceded').in('player_id', ids),
      mvpEnabled ? supabase.rpc('mvp_results') : Promise.resolve({ data: [], error: null }),
    ]).then(([s, k, m]) => {
      if (!active) return;
      const error = Boolean(s.error || k.error || m.error);
      setState({
        key, error,
        rows: (s.data ?? []) as MatchStatRow[],
        keeper: (k.data ?? []) as KeeperMatchRow[],
        mvps: ((m.data ?? []) as MvpAwardRow[]).filter((x) => ids.includes(x.player_id)),
      });
    });
    return () => { active = false; };
  }, [key, mvpEnabled]); // eslint-disable-line react-hooks/exhaustive-deps
  return state?.key === key ? state : null;
}

export function ComparePage() {
  usePageTitle('Comparar jogadores');
  const [params, setParams] = useSearchParams();
  const { base, error } = useBase();

  const slugs = (params.get('jogadores') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_PLAYERS);
  const competitionId = params.get('competicao') ?? '';
  const seasonId = params.get('temporada') ?? '';
  const onlyCommon = params.get('comuns') === '1';
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    setParams(next, { replace: true });
  };

  const bySlug = useMemo(() => new Map((base?.players ?? []).flatMap((p) => [[p.slug ?? p.id, p], [p.id, p]] as [string, Player][])), [base]);
  const chosen = slugs.map((s) => bySlug.get(s)).filter((p): p is Player => Boolean(p));
  const ids = chosen.map((p) => p.id);
  const stats = usePlayerStats(ids, base?.mvpEnabled ?? false);
  const [adding, setAdding] = useState('');

  const scope = { competitionId: competitionId || null, seasonId: seasonId || null };
  const result = useMemo(() => (stats && ids.length ? compareTotals(stats.rows, stats.keeper, stats.mvps, ids, scope, onlyCommon) : null),
    [stats, ids.join(','), competitionId, seasonId, onlyCommon]); // eslint-disable-line react-hooks/exhaustive-deps
  const h2h = useMemo(() => (stats && ids.length === 2 ? headToHead(stats.rows, ids[0], ids[1], scope) : null),
    [stats, ids.join(','), competitionId, seasonId]); // eslint-disable-line react-hooks/exhaustive-deps

  const seasons = (base?.seasons ?? []).filter((s) => s.competition_id === competitionId);
  const metrics = COMPARE_METRICS.filter((m) => !m.needsMvp || base?.mvpEnabled);
  const totals = result ? ids.map((id) => result.totals.get(id)!) : [];
  const setPlayers = (list: Player[]) => set({ jogadores: list.map((p) => p.slug ?? p.id).join(',') || null });
  const sampleWarning = totals.length > 1 && totals.some((t) => t.matches < MIN_MATCHES_EFFICIENCY);
  const uneven = totals.length > 1 && Math.max(...totals.map((t) => t.matches)) >= 2 * Math.max(1, Math.min(...totals.map((t) => t.matches)));

  return (
    <>
      <PageIntro eyebrow="Estatísticas" title="Comparar jogadores" description="Compare até três jogadores com as estatísticas oficiais, no mesmo recorte: todas as competições, uma competição ou uma temporada." />
      <section className="container content-section compare-page">
        {error ? <EmptyState icon={<ArrowLeftRight />} title="Não foi possível carregar o comparador" description="Tente atualizar a página em instantes." />
          : !base ? <LoadingCard /> : (
            <>
              <div className="compare-controls">
                <div className="compare-players">
                  {chosen.map((p) => (
                    <span key={p.id} className="compare-chip">
                      <PlayerPhoto src={p.photo_url} name={p.nickname} size={24} /> {p.nickname}
                      <button type="button" aria-label={`Remover ${p.nickname}`} onClick={() => setPlayers(chosen.filter((x) => x.id !== p.id))}><X size={14} /></button>
                    </span>
                  ))}
                  {chosen.length < MAX_PLAYERS && (
                    <span className="compare-add">
                      <FormSelect value={adding} aria-label="Adicionar jogador" onChange={(e) => { const p = base.players.find((x) => x.id === e.target.value); if (p) setPlayers([...chosen, p]); setAdding(''); }}>
                        <option value="">{chosen.length === 0 ? 'Escolha um jogador' : 'Adicionar jogador'}</option>
                        {base.players.filter((p) => !ids.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.nickname}</option>)}
                      </FormSelect>
                      <Plus size={14} aria-hidden="true" />
                    </span>
                  )}
                </div>
                <div className="compare-scope">
                  <FormField label="Competição">
                    <FormSelect value={competitionId} onChange={(e) => set({ competicao: e.target.value || null, temporada: null })}>
                      <option value="">Todas as competições</option>
                      {base.competitions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </FormSelect>
                  </FormField>
                  <FormField label="Temporada">
                    <FormSelect value={seasonId} disabled={!competitionId} onChange={(e) => set({ temporada: e.target.value || null })}>
                      <option value="">{competitionId ? 'Todas as temporadas' : 'Escolha a competição'}</option>
                      {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </FormSelect>
                  </FormField>
                  <label className="compare-common">
                    <input type="checkbox" checked={onlyCommon} disabled={chosen.length < 2} onChange={(e) => set({ comuns: e.target.checked ? '1' : null })} />
                    <span>Só partidas em que todos atuaram{result && chosen.length > 1 ? ` (${result.common.size})` : ''}</span>
                  </label>
                </div>
              </div>

              {chosen.length === 0 ? (
                <EmptyState icon={<ArrowLeftRight />} title="Escolha os jogadores" description="Selecione dois ou três jogadores para comparar. Dá para abrir a comparação também pelo perfil de um jogador." />
              ) : !stats ? <LoadingCard /> : stats.error ? (
                <EmptyState icon={<ArrowLeftRight />} title="Não foi possível carregar as estatísticas" description="Tente atualizar a página em instantes." />
              ) : (
                <>
                  {(sampleWarning || uneven) && (
                    <p className="compare-warning"><Info size={14} aria-hidden="true" />
                      {sampleWarning ? ` Médias e aproveitamento só são destacados com ao menos ${MIN_MATCHES_EFFICIENCY} partidas de cada jogador.` : ''}
                      {uneven ? ' As quantidades de partidas são bem diferentes; para comparar nas mesmas condições, use "Só partidas em que todos atuaram" ou escolha uma competição ou temporada.' : ''}
                    </p>
                  )}
                  <div className="compare-table-wrap">
                    <table className="compare-table">
                      <thead>
                        <tr>
                          <th scope="col"><span className="sr-only">Estatística</span></th>
                          {chosen.map((p) => (
                            <th key={p.id} scope="col"><Link to={`/jogadores/${p.slug ?? p.id}`} className="compare-head"><PlayerPhoto src={p.photo_url} name={p.nickname} size={40} /><span>{p.nickname}</span>{p.position && <small>{p.position}</small>}</Link></th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {metrics.map((m) => {
                          const lead = leaders(m, totals);
                          return (
                            <tr key={m.key}>
                              <th scope="row">{m.label}{lead.reason === 'sample' && chosen.length > 1 && totals.some((t) => m.value(t) !== null) && <small className="compare-sample">sem destaque: amostra mínima de {MIN_MATCHES_EFFICIENCY}</small>}</th>
                              {totals.map((t) => {
                                const v = m.value(t);
                                const best = lead.ids.includes(t.playerId);
                                return <td key={t.playerId} className={best ? 'is-best' : undefined}>{v === null ? '—' : m.format ? m.format(v) : v}{best && <span className="sr-only"> (melhor)</span>}</td>;
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {h2h && (
                    <div className="compare-h2h">
                      <h2><Swords size={18} aria-hidden="true" /> Confronto direto</h2>
                      {h2h.matches === 0 ? <p>{chosen[0].nickname} e {chosen[1].nickname} não se enfrentaram em partidas oficiais com participação comprovada{competitionId ? ' neste recorte' : ''}.</p> : (
                        <p><strong>{h2h.matches}</strong> {h2h.matches === 1 ? 'partida' : 'partidas'}: {chosen[0].nickname} venceu <strong>{h2h.aWins}</strong>, {chosen[1].nickname} venceu <strong>{h2h.bWins}</strong>, <strong>{h2h.draws}</strong> {h2h.draws === 1 ? 'empate' : 'empates'}.</p>
                      )}
                      {h2h.together > 0 && <p>Jogaram juntos em <strong>{h2h.together}</strong> {h2h.together === 1 ? 'partida' : 'partidas'}: {h2h.togetherWins} V, {h2h.togetherDraws} E, {h2h.togetherLosses} D.</p>}
                    </div>
                  )}
                  <p className="ranking-note is-rules">
                    Contam só as partidas oficiais com participação comprovada (súmula, escalação registrada ou lances), as mesmas usadas nos rankings e nos perfis; partidas antigas sem escalação ainda podem faltar.
                    O destaque marca o melhor valor; médias e aproveitamento só são destacados quando todos têm ao menos {MIN_MATCHES_EFFICIENCY} partidas (no gol, {MIN_MATCHES_EFFICIENCY} partidas no gol).
                    {base.mvpEnabled ? '' : ' MVPs aparecem quando o MVP for publicado.'}
                  </p>
                </>
              )}
            </>
          )}
      </section>
    </>
  );
}
