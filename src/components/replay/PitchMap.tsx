// Field drawn from the stadium stored in the recording (same coordinates and
// proportions), with a heat map (tick counts per cell) and optional points.
// Coordinates are in the sheet frame: the home team attacks to the right.
import type { HeatGrid, StadiumSketch } from '@/lib/replay/stats';

export type PitchPoint = { from?: [number, number] | null; at: [number, number]; kind: 'goal' | 'shot-on' | 'shot-off' | 'pass'; side: 'home' | 'away'; title?: string };

function arcPath(x0: number, y0: number, x1: number, y1: number, curve: number): string {
  if (!curve) return `M${x0} ${y0}L${x1} ${y1}`;
  const rad = (curve * Math.PI) / 180;
  const k = 1 / Math.tan(rad / 2);
  const hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
  const cx = x0 + hx - hy * k, cy = y0 + hy + hx * k;
  const r = Math.hypot(x0 - cx, y0 - cy);
  const cross = (x0 - cx) * (y1 - cy) - (y0 - cy) * (x1 - cx);
  const large = Math.abs(curve) > 180 ? 1 : 0;
  let sweep = cross > 0 ? 1 : 0;
  if (large) sweep = 1 - sweep;
  return `M${x0} ${y0}A${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
}

export function PitchMap({ stadium, heat, points = [], tone = 'home', label }: {
  stadium: StadiumSketch;
  heat?: HeatGrid | null;
  points?: PitchPoint[];
  tone?: 'home' | 'away' | 'ball';
  label: string;
}) {
  const w = stadium.width || stadium.bgWidth || 400;
  const h = stadium.height || stadium.bgHeight || 200;
  const max = heat ? Math.max(1, ...heat.cells) : 1;
  const cellW = heat ? (2 * w) / heat.cols : 0;
  const cellH = heat ? (2 * h) / heat.rows : 0;
  const color = tone === 'away' ? '37, 99, 196' : tone === 'ball' ? '30, 30, 30' : '212, 102, 22';
  return (
    <figure className="pitch-map">
      <svg viewBox={`${-w} ${-h} ${2 * w} ${2 * h}`} role="img" aria-label={label}>
        <rect x={-w} y={-h} width={2 * w} height={2 * h} className="pitch-ground" />
        {heat && heat.cells.map((v, i) => {
          if (v === 0) return null;
          const c = i % heat.cols, r = Math.floor(i / heat.cols);
          const a = Math.pow(v / max, 0.6) * 0.85;
          return <rect key={i} x={-w + c * cellW} y={-h + r * cellH} width={cellW + 0.5} height={cellH + 0.5} fill={`rgba(${color}, ${a.toFixed(3)})`} />;
        })}
        {stadium.lines.map(([x0, y0, x1, y1, curve], i) => (
          <path key={i} d={arcPath(x0, y0, x1, y1, curve)} className="pitch-line" />
        ))}
        {stadium.goals.map((g, i) => <line key={`g${i}`} x1={g.x0} y1={g.y0} x2={g.x1} y2={g.y1} className="pitch-goal" />)}
        {points.map((p, i) => (
          <g key={`p${i}`} className={`pitch-point point-${p.kind} side-${p.side}`}>
            {p.title && <title>{p.title}</title>}
            {p.from && <line x1={p.from[0]} y1={p.from[1]} x2={p.at[0]} y2={p.at[1]} />}
            <circle cx={p.kind === 'goal' || p.kind === 'pass' ? p.at[0] : (p.from ?? p.at)[0]} cy={p.kind === 'goal' || p.kind === 'pass' ? p.at[1] : (p.from ?? p.at)[1]} r={p.kind === 'goal' ? 9 : 6} />
          </g>
        ))}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
