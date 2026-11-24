// The composition of the shareable image (1080×1350), drawn as SVG.
import type { AvatarConfig, Formation, RosterPlayer } from '@/lib/tactics';
import { initials } from '@/lib/tactics';
import { AvatarDisc, CourtMarkings, PlayerToken } from './TacticsArt';
import { COURT, toCourt } from './courtGeometry';

export type ShareInput = {
  team: { id: string; name: string; logo_url: string | null };
  seasonName: string | null;
  formation: Formation;
  players: Map<string, RosterPlayer>;
  avatarOf: (id: string) => AvatarConfig;
};

export const SHARE_W = 1080;
export const SHARE_H = 1350;
const FONT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

export function ShareCard({ team, seasonName, formation, players, avatarOf, logo }: ShareInput & { logo: string | null }) {
  const bench = formation.bench.map((id) => players.get(id)).filter(Boolean) as RosterPlayer[];
  const courtW = 620;
  const courtH = (courtW / COURT.w) * COURT.h;
  const rowH = Math.min(92, (courtH - 70) / Math.max(1, bench.length));
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={SHARE_W} height={SHARE_H} viewBox={`0 0 ${SHARE_W} ${SHARE_H}`}>
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1d1611" />
          <stop offset="100%" stopColor="#0f0b08" />
        </linearGradient>
        <clipPath id="logo-clip"><circle cx="110" cy="112" r="52" /></clipPath>
      </defs>
      <rect width={SHARE_W} height={SHARE_H} fill="url(#bg)" />
      <rect x="0" y="0" width={SHARE_W} height="8" fill="#c2560f" />
      {/* header */}
      <circle cx="110" cy="112" r="56" fill="#2a1f17" stroke="#f2a35e" strokeWidth="3" />
      {logo ? <image href={logo} x="58" y="60" width="104" height="104" clipPath="url(#logo-clip)" preserveAspectRatio="xMidYMid slice" />
        : <text x="110" y="112" textAnchor="middle" dominantBaseline="central" fontFamily={FONT} fontWeight="700" fontSize="44" fill="#f2a35e">{initials(team.name)}</text>}
      <text x="190" y="92" fontFamily={FONT} fontWeight="700" fontSize="22" letterSpacing="4" fill="#f2a35e">MAPA TÁTICO{seasonName ? ` · ${seasonName.toUpperCase()}` : ''}</text>
      <text x="190" y="146" fontFamily={FONT} fontWeight="800" fontSize={team.name.length > 22 ? 44 : 56} fill="#f3ebe0">{team.name}</text>
      {/* court */}
      <svg x="60" y="210" width={courtW} height={courtH} viewBox={`0 0 ${COURT.w} ${COURT.h}`}>
        <CourtMarkings idPrefix="share" />
        {formation.starters.map((s) => {
          const p = players.get(s.player_id);
          const c = toCourt(s.x, s.y);
          return <PlayerToken key={s.player_id} config={avatarOf(s.player_id)} name={p?.nickname ?? '?'} role={s.role} number={p?.shirt_number ?? null} x={c.x} y={c.y} uid={`s-${s.player_id.slice(0, 8)}`} />;
        })}
      </svg>
      {/* bench */}
      <text x="720" y="252" fontFamily={FONT} fontWeight="700" fontSize="22" letterSpacing="3" fill="#f2a35e">BANCO DE RESERVAS</text>
      <line x1="720" y1="270" x2="1020" y2="270" stroke="rgba(243,235,224,0.2)" strokeWidth="2" />
      {bench.length === 0 && <text x="720" y="320" fontFamily={FONT} fontSize="22" fill="rgba(243,235,224,0.6)">Sem reservas</text>}
      {bench.map((p, i) => {
        const y = 320 + i * rowH;
        return (
          <g key={p.player_id}>
            <g transform={`translate(752 ${y})`}><AvatarDisc config={avatarOf(p.player_id)} r={Math.min(30, rowH / 2 - 8)} number={p.shirt_number} uid={`sb-${p.player_id.slice(0, 8)}`} /></g>
            <text x="800" y={y - 4} fontFamily={FONT} fontWeight="700" fontSize="24" fill="#f3ebe0">{p.nickname.length > 16 ? `${p.nickname.slice(0, 15)}…` : p.nickname}</text>
            <text x="800" y={y + 24} fontFamily={FONT} fontSize="18" fill="rgba(243,235,224,0.6)">{[p.position, p.shirt_number != null ? `#${p.shirt_number}` : null].filter(Boolean).join(' · ')}</text>
          </g>
        );
      })}
      {/* footer */}
      <text x="60" y={SHARE_H - 50} fontFamily={FONT} fontWeight="800" fontSize="26" fill="#f3ebe0">FBF</text>
      <text x="118" y={SHARE_H - 50} fontFamily={FONT} fontSize="20" fill="rgba(243,235,224,0.6)">Federação Brasileira de Futsal · apresentação do elenco (não é escalação oficial)</text>
    </svg>
  );
}

