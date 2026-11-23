// "Escalação": who played a FINISHED match, through save_match_lineup(), which
// validates everything on the server, never touches the score or the events
// and keeps every change in the match history. Players with official goals,
// assists or goalkeeper records are proven participants and stay selected.
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Lock, Users } from 'lucide-react';
import { supabase, type Match } from '@/lib/supabase';
import { useRosters } from '@/lib/hooks';
import { refreshAdminData } from '@/lib/adminRefresh';
import { FormError } from '@/components/ui';

type Side = 'home' | 'away';
type Participation = { player_id: string; season_team_id: string; source: 'REPLAY' | 'SHEET'; seconds_played: number | null; player: { nickname: string } | null };
type Evidence = { player_id: string | null; team_id: string; kind: 'gol/assistência' | 'goleiro' };

export function MatchLineupDialog({ match, teamNames, onDone }: { match: Match; teamNames?: { home: string; away: string }; onDone: () => void }) {
  const homeId = match.home_team_id ?? '';
  const awayId = match.away_team_id ?? '';
  const names: Record<Side, string> = teamNames ?? { home: match.home_team?.team?.name ?? 'Mandante', away: match.away_team?.team?.name ?? 'Visitante' };
  const { rosters: homeRoster, loading: loadingHome } = useRosters(homeId || undefined);
  const { rosters: awayRoster, loading: loadingAway } = useRosters(awayId || undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState('');
  const [current, setCurrent] = useState<Participation[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [selected, setSelected] = useState<Record<string, Side>>({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    const [fp, parts, ev, gk] = await Promise.all([
      supabase.rpc('match_lineup_fingerprint', { p_match_id: match.id }),
      supabase.from('match_participations').select('player_id, season_team_id, source, seconds_played, player:player_id ( nickname )').eq('match_id', match.id),
      supabase.from('match_events').select('player_id, team_id').eq('match_id', match.id).in('event_type', ['GOAL', 'ASSIST']),
      supabase.from('goalkeeper_participations').select('player_id, team_id').eq('match_id', match.id),
    ]);
    if (fp.error) {
      setError(fp.error.code === '42501' ? 'Sem permissão para editar esta partida.' : 'Não foi possível carregar a escalação.');
      setLoading(false);
      return;
    }
    const p = (parts.data ?? []) as unknown as Participation[];
    const e: Evidence[] = [
      ...((ev.data ?? []) as { player_id: string | null; team_id: string }[]).map((x) => ({ ...x, kind: 'gol/assistência' as const })),
      ...((gk.data ?? []) as { player_id: string; team_id: string }[]).map((x) => ({ ...x, kind: 'goleiro' as const })),
    ];
    setFingerprint(fp.data as string);
    setCurrent(p);
    setEvidence(e);
    const sel: Record<string, Side> = {};
    for (const row of p) sel[row.player_id] = row.season_team_id === homeId ? 'home' : 'away';
    for (const row of e) if (row.player_id) sel[row.player_id] = row.team_id === homeId ? 'home' : 'away';
    setSelected(sel);
    setLoading(false);
  }
  useEffect(() => { void load(); }, [match.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // proven by official events or goalkeeper records: always part of the lineup
  const proven = useMemo(() => {
    const m = new Map<string, { side: Side; kinds: Set<string> }>();
    for (const e of evidence) {
      if (!e.player_id) continue;
      const side: Side = e.team_id === homeId ? 'home' : 'away';
      const entry = m.get(e.player_id) ?? { side, kinds: new Set<string>() };
      entry.kinds.add(e.kind);
      m.set(e.player_id, entry);
    }
    return m;
  }, [evidence, homeId]);

  // a lineup row in conflict with the official events (edited later)
  const conflicts = current.filter((c) => {
    const pr = proven.get(c.player_id);
    return pr && (c.season_team_id === homeId ? 'home' : 'away') !== pr.side;
  });

  const lists = useMemo(() => {
    const build = (side: Side) => {
      const roster = (side === 'home' ? homeRoster : awayRoster).filter((r) => r.player).map((r) => ({ id: r.player_id, nickname: r.player!.nickname, position: r.player!.position ?? '', inRoster: true }));
      const teamId = side === 'home' ? homeId : awayId;
      // players kept from a previous lineup who are no longer in the roster
      const extra = current.filter((c) => c.season_team_id === teamId && !roster.some((r) => r.id === c.player_id))
        .map((c) => ({ id: c.player_id, nickname: c.player?.nickname ?? 'Jogador', position: '', inRoster: false }));
      return [...roster, ...extra].sort((a, b) => a.nickname.localeCompare(b.nickname, 'pt-BR'));
    };
    return { home: build('home'), away: build('away') };
  }, [homeRoster, awayRoster, current, homeId, awayId]);

  const source = current.length === 0 ? null : current.every((c) => c.source === 'REPLAY') ? 'REPLAY' : 'SHEET';
  const selectedEntries = Object.entries(selected);
  const sortedKey = (entries: [string, Side][]) => JSON.stringify([...entries].sort(([a], [b]) => a.localeCompare(b)));
  const originalKey = useMemo(() => sortedKey(current.map((c) => [c.player_id, c.season_team_id === homeId ? 'home' : 'away'])), [current, homeId]);
  // a first lineup can always be saved; afterwards only when something changed
  const changed = current.length === 0 || sortedKey(selectedEntries) !== originalKey;
  const counts = { home: selectedEntries.filter(([, s]) => s === 'home').length, away: selectedEntries.filter(([, s]) => s === 'away').length };

  function toggle(id: string, side: Side) {
    if (proven.has(id)) return;
    setSelected((s) => {
      const next = { ...s };
      if (next[id] === side) delete next[id]; else next[id] = side;
      return next;
    });
  }

  async function save() {
    if (reason.trim().length < 3) { setError('Informe o motivo (por exemplo: "escalação conferida com a organização").'); return; }
    setBusy(true);
    setError(null);
    // the seconds already known (from recordings) are kept for players who stay on the same side
    const lineup = selectedEntries.map(([player_id, side]) => {
      const prev = current.find((c) => c.player_id === player_id && (c.season_team_id === homeId ? 'home' : 'away') === side);
      return { player_id, side, seconds_played: prev?.seconds_played ?? null };
    });
    const { error: err } = await supabase.rpc('save_match_lineup', { p_match_id: match.id, p_fingerprint: fingerprint, p_lineup: lineup, p_reason: reason.trim() });
    setBusy(false);
    if (err) {
      setError(err.code === '55000' ? 'A escalação foi alterada por outra pessoa enquanto você editava. Ela foi recarregada; confira e salve de novo.' : err.message || 'Não foi possível salvar a escalação.');
      if (err.code === '55000') void load();
      return;
    }
    setSaved(true);
    refreshAdminData();
    await load();
  }

  if (loading || loadingHome || loadingAway) return <p className="admin-empty-text">Carregando escalação...</p>;
  if (error && !fingerprint) return <FormError message={error} />;

  return (
    <div className="lineup-dialog">
      <p className="admin-hint">
        Marque todos os jogadores que entraram em campo, inclusive quem não marcou gol. Placar, gols e assistências <strong>não</strong> são alterados aqui.
        Quem tem gol, assistência ou registro de goleiro nesta partida já conta como participante e fica marcado.
      </p>
      {source && (
        <p className="lineup-source">
          <CheckCircle2 size={14} aria-hidden="true" /> {source === 'REPLAY' ? 'Escalação registrada pela súmula das gravações.' : 'Escalação informada pela organização.'} {current.length} jogador(es).
        </p>
      )}
      {!source && <p className="lineup-source is-missing"><Users size={14} aria-hidden="true" /> Escalação ainda não registrada: até lá, só contam como participantes os jogadores com gols, assistências ou registro de goleiro.</p>}
      {conflicts.length > 0 && (
        <p className="replay-error-text">Atenção: {conflicts.map((c) => c.player?.nickname ?? 'um jogador').join(', ')} está na escalação de uma equipe, mas tem gols/assistências pela outra. Vale a súmula; salve a escalação para corrigir.</p>
      )}
      <div className="lineup-columns">
        {(['home', 'away'] as Side[]).map((side) => (
          <fieldset key={side} className="lineup-team">
            <legend>{names[side]} <span>{counts[side]} marcado(s)</span></legend>
            {lists[side].length === 0 && <p className="admin-empty-text">Elenco vazio.</p>}
            {lists[side].map((p) => {
              const pr = proven.get(p.id);
              const checked = selected[p.id] === side;
              const otherSide = selected[p.id] && selected[p.id] !== side;
              return (
                <label key={p.id} className={`lineup-player${pr ? ' is-proven' : ''}${otherSide ? ' is-other' : ''}`}>
                  <input type="checkbox" checked={checked} disabled={Boolean(pr) || Boolean(otherSide)} onChange={() => toggle(p.id, side)} />
                  <span className="lineup-name">{p.nickname}{p.position ? <small> · {p.position}</small> : null}{!p.inRoster && <small> · fora do elenco atual</small>}</span>
                  {pr && <span className="lineup-proof" title="Participação comprovada pela súmula"><Lock size={11} aria-hidden="true" /> {[...pr.kinds].join(' e ')}</span>}
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
      <label className="lineup-reason">
        <span>Motivo da alteração</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: escalação conferida com a organização" maxLength={300} />
      </label>
      <FormError message={error} />
      {saved && !error && <p className="lineup-saved"><CheckCircle2 size={14} aria-hidden="true" /> Escalação salva e registrada no histórico da partida.</p>}
      <div className="deletion-actions">
        <button type="button" className="button button-outline" onClick={onDone}>Fechar</button>
        <button type="button" className="button button-primary" disabled={busy || !changed || selectedEntries.length === 0} onClick={() => void save()}>{busy ? 'Salvando...' : 'Salvar escalação'}</button>
      </div>
    </div>
  );
}
