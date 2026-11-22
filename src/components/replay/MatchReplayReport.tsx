// Public statistics of a match whose sheet was validated from recordings.
// Shown only after an administrator confirmed the sheet (the report is public
// only for finished matches). Players not identified in the FBF registry are
// labelled as such; the recordings themselves stay private.
import { useEffect, useMemo, useState } from 'react';
import { FileVideo } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { PublicReport } from '@/lib/replay/consolidate';
import { formatClock } from '@/lib/time';
import { PitchMap, type PitchPoint } from './PitchMap';

type ReportRow = { report: PublicReport; files_count: number; confirmed_at: string; analyzer_version: string };

export function useMatchReplayReport(matchId?: string) {
  const [row, setRow] = useState<ReportRow | null>(null);
  useEffect(() => {
    let active = true;
    setRow(null);
    if (!matchId) return () => { active = false; };
    supabase.from('match_replay_reports').select('report, files_count, confirmed_at, analyzer_version').eq('match_id', matchId).maybeSingle()
      .then(({ data, error }) => { if (active && !error && data) setRow(data as unknown as ReportRow); });
    return () => { active = false; };
  }, [matchId]);
  return row;
}

const pct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : '—');

export function MatchReplayReport({ row, homeName, awayName }: { row: ReportRow; homeName: string; awayName: string }) {
  const report = row.report;
  const [view, setView] = useState('ball');
  const teamName = (side: 'home' | 'away' | null) => (side === 'home' ? homeName : side === 'away' ? awayName : '—');
  const players = useMemo(() => [...report.players].sort((a, b) => (a.side ?? '').localeCompare(b.side ?? '') || b.stats.playedTicks - a.stats.playedTicks), [report.players]);
  const totalPossession = report.teams.home.possessionTicks + report.teams.away.possessionTicks;
  const selected = view.startsWith('p:') ? players[Number(view.slice(2))] : null;
  const heat = view === 'ball' ? report.ballHeat : view === 'home' || view === 'away'
    ? players.filter((p) => p.side === view && p.heat).reduce<typeof report.ballHeat>((acc, p) => {
      if (!p.heat) return acc;
      if (!acc) return { cols: p.heat.cols, rows: p.heat.rows, cells: [...p.heat.cells] };
      if (acc.cols === p.heat.cols && acc.rows === p.heat.rows) p.heat.cells.forEach((v, i) => { acc.cells[i] += v; });
      return acc;
    }, null) : selected?.heat ?? null;
  const points: PitchPoint[] = [
    ...report.shots.filter((s) => !selected || s.playerId === selected.playerId).map((s) => ({ from: s.from, at: s.to, kind: (s.onTarget ? 'shot-on' : 'shot-off') as PitchPoint['kind'], side: s.side })),
    ...report.goals.filter((g) => g.ball && (!selected || g.playerId === selected.playerId)).map((g) => ({ from: g.from, at: g.ball!, kind: 'goal' as const, side: g.side, title: `Gol aos ${formatClock(g.minute)}` })),
  ];
  const rows: [string, number, number, boolean?][] = [
    ['Posse de bola', report.teams.home.possessionTicks, report.teams.away.possessionTicks, true],
    ['Finalizações', report.teams.home.shots, report.teams.away.shots],
    ['Chutes no gol', report.teams.home.shotsOnTarget, report.teams.away.shotsOnTarget],
    ['Passes', report.teams.home.passes, report.teams.away.passes],
    ['Chutes (todos os toques de chute)', report.teams.home.kicks, report.teams.away.kicks],
  ];
  return (
    <section className="replay-report">
      <div className="replay-report-heading">
        <h2 className="match-page-heading">Estatísticas da partida</h2>
        <span className="replay-badge"><FileVideo size={14} /> Súmula validada a partir de {row.files_count} {row.files_count === 1 ? 'gravação' : 'gravações'}</span>
      </div>
      {report.games.length > 0 && (
        <p className="replay-periods">
          {report.games.map((g) => `${g.label}: ${homeName} ${g.home} × ${g.away} ${awayName} (${formatClock(g.durationSeconds)})`).join(' · ')}
        </p>
      )}
      <div className="replay-team-stats">
        <div className="replay-team-names"><strong>{homeName}</strong><strong>{awayName}</strong></div>
        {rows.map(([label, h, a, isPct]) => {
          const total = h + a;
          return (
            <div key={label} className="replay-stat-row">
              <span>{isPct ? pct(h, total) : h}</span>
              <div className="replay-stat-bar" aria-hidden="true"><i style={{ width: total ? `${(h / total) * 100}%` : '50%' }} /></div>
              <span>{isPct ? pct(a, total) : a}</span>
              <small>{label}</small>
            </div>
          );
        })}
        <p className="replay-footnote">Bola no campo: {pct(report.thirds[0], report.thirds[0] + report.thirds[1] + report.thirds[2])} no terço defensivo de {homeName}, {pct(report.thirds[1], report.thirds[0] + report.thirds[1] + report.thirds[2])} no meio, {pct(report.thirds[2], report.thirds[0] + report.thirds[1] + report.thirds[2])} no terço defensivo de {awayName}.</p>
      </div>

      <div className="table-scroll">
        <table className="replay-table">
          <thead>
            <tr><th>Jogador</th><th>Time</th><th title="Gols">G</th><th title="Assistências">A</th><th title="Finalizações">Fin.</th><th title="Chutes no gol">No gol</th><th title="Passes certos">Passes</th><th title="Chutes">Chutes</th><th title="Participação na posse de bola">Posse</th><th title="Tempo em campo">Tempo</th></tr>
          </thead>
          <tbody>
            {players.map((p, i) => (
              <tr key={`${p.playerId ?? p.name}-${i}`}>
                <td>{p.name}{!p.identified && <em className="replay-unidentified"> (não identificado)</em>}</td>
                <td>{teamName(p.side)}</td>
                <td>{p.stats.goals}</td><td>{p.stats.assists}</td><td>{p.stats.shots}</td><td>{p.stats.shotsOnTarget}</td>
                <td>{p.stats.passes}</td><td>{p.stats.kicks}</td><td>{pct(p.stats.possessionTicks, totalPossession)}</td><td>{formatClock(Math.round(p.stats.playedTicks / 60))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {report.stadium && (
        <div className="replay-maps">
          <div className="replay-map-controls">
            <label htmlFor="replay-map-view">Mapa de calor</label>
            <select id="replay-map-view" value={view} onChange={(e) => setView(e.target.value)}>
              <option value="ball">Bola</option>
              <option value="home">{homeName} (equipe)</option>
              <option value="away">{awayName} (equipe)</option>
              {players.map((p, i) => <option key={i} value={`p:${i}`}>{p.name} · {teamName(p.side)}</option>)}
            </select>
            <span className="replay-map-legend"><i className="lg-goal" /> gol <i className="lg-on" /> chute no gol <i className="lg-off" /> finalização para fora</span>
          </div>
          <PitchMap stadium={report.stadium} heat={heat} points={points} tone={view === 'ball' ? 'ball' : (selected?.side ?? (view as 'home' | 'away'))} label={`${view === 'ball' ? 'Posição da bola' : selected ? selected.name : teamName(view as 'home' | 'away')} · ${homeName} ataca para a direita`} />
        </div>
      )}
      <p className="replay-footnote">Dados extraídos automaticamente das gravações oficiais (analisador {row.analyzer_version}) e conferidos por um administrador. Finalizações: chutes cuja trajetória vai em direção ao gol adversário; chutes no gol: trajetória entre as traves.</p>
    </section>
  );
}
