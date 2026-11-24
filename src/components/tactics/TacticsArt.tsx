// Mapa tático: drawing only (SVG), no data access. The court is drawn top-down,
// vertical, attacking up; positions are fractions of the playing area, so the
// same formation looks the same at any size.
import { type ReactNode } from 'react';
import { inkOn, type AvatarConfig, type AvatarSymbol } from '@/lib/tactics';
import { COURT } from './courtGeometry';


const LINE = 'rgba(243, 235, 224, 0.82)';
const LINE_SOFT = 'rgba(243, 235, 224, 0.28)';

/** The court markings (futsal proportions, as used in the FBF HaxBall rooms). */
export function CourtMarkings({ idPrefix = 'court' }: { idPrefix?: string }) {
  const { x0, y0, x1, y1 } = COURT;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const w = x1 - x0;
  const stripes = 8;
  const area = 96; // penalty "D" radius
  return (
    <g>
      <defs>
        <radialGradient id={`${idPrefix}-glow`} cx="50%" cy="50%" r="65%">
          <stop offset="0%" stopColor="#3a2a1b" />
          <stop offset="100%" stopColor="#1a130e" />
        </radialGradient>
        <linearGradient id={`${idPrefix}-goal`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f2a35e" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#f2a35e" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={COURT.w} height={COURT.h} rx="18" fill="#120e0b" />
      <rect x={x0} y={y0} width={w} height={y1 - y0} fill={`url(#${idPrefix}-glow)`} />
      {Array.from({ length: stripes }, (_, i) => i % 2 === 0 ? null : (
        <rect key={i} x={x0} y={y0 + (i * (y1 - y0)) / stripes} width={w} height={(y1 - y0) / stripes} fill="#ffffff" opacity="0.025" />
      ))}
      <g fill="none" stroke={LINE} strokeWidth="2.4" strokeLinecap="round">
        <rect x={x0} y={y0} width={w} height={y1 - y0} rx="3" />
        <line x1={x0} y1={cy} x2={x1} y2={cy} />
        <circle cx={cx} cy={cy} r="54" />
        <path d={`M ${cx - area} ${y0} A ${area} ${area} 0 0 0 ${cx + area} ${y0}`} />
        <path d={`M ${cx - area} ${y1} A ${area} ${area} 0 0 1 ${cx + area} ${y1}`} />
        <path d={`M ${x0 + 12} ${y0} A 12 12 0 0 1 ${x0} ${y0 + 12}`} />
        <path d={`M ${x1 - 12} ${y0} A 12 12 0 0 0 ${x1} ${y0 + 12}`} />
        <path d={`M ${x0} ${y1 - 12} A 12 12 0 0 1 ${x0 + 12} ${y1}`} />
        <path d={`M ${x1} ${y1 - 12} A 12 12 0 0 0 ${x1 - 12} ${y1}`} />
      </g>
      <g fill="none" stroke={LINE_SOFT} strokeWidth="1.4" strokeDasharray="5 7">
        <path d={`M ${cx - area - 46} ${y0} A ${area + 46} ${area + 46} 0 0 0 ${cx + area + 46} ${y0}`} />
        <path d={`M ${cx - area - 46} ${y1} A ${area + 46} ${area + 46} 0 0 1 ${cx + area + 46} ${y1}`} />
      </g>
      <g fill={LINE}>
        <circle cx={cx} cy={cy} r="4" />
        <circle cx={cx} cy={y0 + 72} r="3.2" />
        <circle cx={cx} cy={y1 - 72} r="3.2" />
      </g>
      {/* goals */}
      <rect x={cx - 42} y={y0 - 18} width="84" height="18" rx="3" fill={`url(#${idPrefix}-goal)`} stroke="#f2a35e" strokeWidth="2.2" />
      <rect x={cx - 42} y={y1} width="84" height="18" rx="3" fill={`url(#${idPrefix}-goal)`} stroke="#f2a35e" strokeWidth="2.2" transform={`rotate(180 ${cx} ${y1 + 9})`} />
    </g>
  );
}

/** Symbols drawn in a 24×24 box, filled shapes that stay readable when small. */
export function SymbolGlyph({ symbol, color }: { symbol: AvatarSymbol; color: string }) {
  const s = { fill: color };
  switch (symbol) {
    case 'ball':
      return (
        <g>
          <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="2.2" />
          <path d="M12 7.2l3.8 2.8-1.45 4.5h-4.7L8.2 10z" {...s} />
          <path d="M12 2v5.2M15.8 10l4.9-1.7M14.35 14.5l3 4.1M9.65 14.5l-3 4.1M8.2 10L3.3 8.3" stroke={color} strokeWidth="1.6" fill="none" />
        </g>
      );
    case 'glove':
      return <path d="M7 21c-1.7-1.1-2.6-3-2.6-5.2V9.6c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v3h.6V4.9c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6V11h.6V3.6c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6V11h.6V5.4c0-.9.7-1.6 1.6-1.6s1.6.7 1.6 1.6v9c0 3.8-2.6 6.6-6.3 6.6z" {...s} />;
    case 'star':
      return <path d="M12 2.2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.1l-6.1 3.5 1.5-6.8L2.2 9.2l6.9-.7z" {...s} />;
    case 'shield':
      return <path d="M12 2l8 3v6.4c0 5-3.4 8.9-8 10.6-4.6-1.7-8-5.6-8-10.6V5z" {...s} />;
    case 'crown':
      return <path d="M3 18.5h18l-1.4-11-4.6 4.3L12 4.5l-3 7.3-4.6-4.3zM3.2 20.2h17.6v1.8H3.2z" {...s} />;
    case 'bolt':
      return <path d="M13.6 1.8L4.4 13.4h6.2l-1.8 8.8 9.8-12h-6.4z" {...s} />;
    case 'flame':
      return <path d="M12 22c-4.3 0-7.3-3-7.3-7 0-3.6 2.4-5.6 3.9-8.4.5 1.8 1.4 3 2.7 3.6-.2-3.4 1.2-6.4 3.7-8.2-.2 3.1 1.6 4.9 3.1 6.9 1.2 1.6 2.2 3.4 2.2 6 0 4.1-3.6 7.1-8.3 7.1z" {...s} />;
    case 'target':
      return (
        <g fill="none" stroke={color} strokeWidth="2.2">
          <circle cx="12" cy="12" r="9.5" />
          <circle cx="12" cy="12" r="5.4" />
          <circle cx="12" cy="12" r="1.8" fill={color} />
        </g>
      );
    default:
      return null;
  }
}

/** The circle of one player (no name), drawn at (0,0) with radius r. */
export function AvatarDisc({ config, r, number, uid }: { config: AvatarConfig; r: number; number: number | null; uid: string }) {
  const { background, border, style, symbol, label } = config;
  const face = style === 'ring' ? '#17110d' : background;
  const ink = style === 'ring' ? background : inkOn(background);
  const clip = `split-${uid}`;
  const text = symbol === 'number' ? (number != null ? String(number) : label) : label;
  const glyph = symbol !== 'initial' && symbol !== 'number';
  return (
    <g>
      <circle r={r + 3} fill="rgba(0,0,0,0.38)" cy="2.5" />
      {style === 'split' ? (
        <>
          <defs><clipPath id={clip}><rect x={0} y={-r} width={r} height={2 * r} /></clipPath></defs>
          <circle r={r} fill={background} />
          <circle r={r} fill={border} clipPath={`url(#${clip})`} />
        </>
      ) : <circle r={r} fill={face} />}
      <circle r={style === 'ring' ? r - 3 : r} fill="none" stroke={style === 'ring' ? background : border} strokeWidth={style === 'ring' ? 6 : 3} />
      {style === 'ring' && <circle r={r + 1.5} fill="none" stroke={border} strokeWidth="1.5" />}
      {glyph ? (
        <g transform={`translate(${-r * 0.5} ${-r * 0.5}) scale(${r / 24})`} style={style === 'split' ? { filter: 'drop-shadow(0 0 1.2px rgba(0,0,0,.85))' } : undefined}>
          <SymbolGlyph symbol={symbol} color={style === 'split' ? '#ffffff' : ink} />
        </g>
      ) : (
        <text textAnchor="middle" dominantBaseline="central" fontFamily="'Space Grotesk', 'Segoe UI', system-ui, sans-serif" fontWeight="700"
          fontSize={text.length > 2 ? r * 0.62 : r * 0.78} fill={style === 'split' ? '#ffffff' : ink}
          stroke={style === 'split' ? 'rgba(0,0,0,.55)' : 'none'} strokeWidth={style === 'split' ? 2 : 0} paintOrder="stroke">{text || '?'}</text>
      )}
      {config.show_number && number != null && symbol !== 'number' && (
        <g transform={`translate(${-r * 0.74} ${r * 0.62})`}>
          <circle r={r * 0.36} fill="#f3ebe0" stroke="#17110d" strokeWidth="1.5" />
          <text textAnchor="middle" dominantBaseline="central" fontFamily="'Space Grotesk', system-ui, sans-serif" fontWeight="700" fontSize={r * 0.4} fill="#17110d">{number}</text>
        </g>
      )}
    </g>
  );
}

/** A starter on the court: disc, role chip and name. */
export function PlayerToken({ config, name, role, number, x, y, uid, selected, dimmed, children }: {
  config: AvatarConfig; name: string; role: string; number: number | null; x: number; y: number; uid: string; selected?: boolean; dimmed?: boolean; children?: ReactNode;
}) {
  const r = 27;
  const shown = name.length > 15 ? `${name.slice(0, 14)}…` : name;
  const pillW = Math.max(54, shown.length * 7.4 + 18);
  return (
    <g transform={`translate(${x} ${y})`} opacity={dimmed ? 0.55 : 1}>
      {selected && <circle r={r + 9} fill="none" stroke="#ffd166" strokeWidth="2.5" strokeDasharray="5 4" />}
      <AvatarDisc config={config} r={r} number={number} uid={uid} />
      <g transform={`translate(${r * 0.72} ${-r * 0.86})`}>
        <rect x="-15" y="-9" width="30" height="18" rx="9" fill="#c2560f" stroke="#17110d" strokeWidth="1.5" />
        <text textAnchor="middle" dominantBaseline="central" fontFamily="'Space Grotesk', system-ui, sans-serif" fontWeight="700" fontSize="10.5" fill="#fff" letterSpacing=".04em">{role}</text>
      </g>
      <g transform={`translate(0 ${r + 17})`}>
        <rect x={-pillW / 2} y="-11" width={pillW} height="22" rx="11" fill="rgba(18,14,11,0.86)" stroke="rgba(243,235,224,0.22)" />
        <text textAnchor="middle" dominantBaseline="central" fontFamily="'Manrope', 'Segoe UI', system-ui, sans-serif" fontWeight="700" fontSize="12.5" fill="#f3ebe0">{shown}</text>
      </g>
      {children}
    </g>
  );
}

/** An empty place on the court (fewer than three starters): never filled with an invented player. */
export function EmptySlot({ x, y, role, active }: { x: number; y: number; role: string; active?: boolean }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="27" fill={active ? 'rgba(255,209,102,0.12)' : 'rgba(243,235,224,0.04)'} stroke={active ? '#ffd166' : 'rgba(243,235,224,0.45)'} strokeWidth="2" strokeDasharray="6 5" />
      <text textAnchor="middle" dominantBaseline="central" fontFamily="'Space Grotesk', system-ui, sans-serif" fontWeight="700" fontSize="12" fill="rgba(243,235,224,0.7)">{role}</text>
      <text y="44" textAnchor="middle" fontFamily="'Manrope', system-ui, sans-serif" fontWeight="700" fontSize="11.5" fill="rgba(243,235,224,0.55)">Vaga</text>
    </g>
  );
}

/** A small standalone avatar (bench, editor preview). */
export function MiniAvatar({ config, number, size = 40, uid }: { config: AvatarConfig; number: number | null; size?: number; uid: string }) {
  return (
    <svg width={size} height={size} viewBox="-34 -34 68 68" aria-hidden="true" className="tac-mini-avatar">
      <AvatarDisc config={config} r={28} number={number} uid={uid} />
    </svg>
  );
}
