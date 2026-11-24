// Mapa tático of a club in one season, on the team page.
// View: the three starters on the court and the bench beside it (below on
// phones). Edit (admins and the club's managers): drag on the court, drag a
// reserve from its handle onto the court, or tap a player and then tap where
// it goes (court, an empty place, another player to swap, or "Enviar ao
// banco"). Nothing here is an official match lineup.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, CheckCircle2, Download, GripVertical, Lightbulb, Palette, Pencil, RefreshCw, Save, Undo2, Users } from 'lucide-react';
import { useTeamTactics } from '@/lib/tacticsData';
import {
  DEFAULT_ROLES, MAX_STARTERS, defaultAvatar, demote, move, normalizeRole, promote, resolveFormation, sameFormation, setRole, spotFor,
  suggestStarters, swap, reorderBench, type Formation, type RosterPlayer,
} from '@/lib/tactics';
import { FormError, TeamLogo } from '@/components/ui';
import { CourtMarkings, EmptySlot, MiniAvatar, PlayerToken } from './TacticsArt';
import { COURT, fromCourt, toCourt } from './courtGeometry';
import { AvatarEditor } from './AvatarEditor';
import { exportFormationImage } from './shareImage';

export type MapPlayer = RosterPlayer & { slug: string | null };
type Props = { team: { id: string; name: string; logo_url: string | null }; seasonName: string | null; seasonTeamId: string | null; roster: MapPlayer[] };
type Drag = { id: string; from: 'court' | 'bench'; startX: number; startY: number; x: number; y: number; moved: boolean };

export function TacticalMap({ team, seasonName, seasonTeamId, roster }: Props) {
  const navigate = useNavigate();
  const t = useTeamTactics(team.id, seasonTeamId);
  const byId = useMemo(() => new Map(roster.map((p) => [p.player_id, p])), [roster]);
  const live = useMemo(() => resolveFormation(t.saved, roster), [t.saved, roster]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Formation>(live);
  const [baseVersion, setBaseVersion] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null); // only to draw the ghost of a reserve being dragged
  const dragRef = useRef<Drag | null>(null);
  const movedRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error' | 'conflict'; text: string } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [avatarFor, setAvatarFor] = useState<string | null>(null);
  const [customRole, setCustomRole] = useState('');
  const [exporting, setExporting] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const shown = editing ? draft : live;
  const dirty = editing && !sameFormation(draft, live);
  const avatarOf = useCallback((id: string) => t.avatars.get(id) ?? defaultAvatar(byId.get(id) ?? { player_id: id, nickname: '?', position: null }), [t.avatars, byId]);

  useEffect(() => { if (!editing) setDraft(live); }, [live, editing]);
  useEffect(() => { setEditing(false); setSelected(null); setMessage(null); }, [seasonTeamId]);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const startEdit = () => { setDraft(live); setBaseVersion(t.version); setEditing(true); setSelected(null); setMessage(null); setConfirmDiscard(false); };
  const stopEdit = () => { setEditing(false); setSelected(null); setConfirmDiscard(false); setDrag(null); };
  const cancel = () => { if (dirty) setConfirmDiscard(true); else stopEdit(); };

  async function save() {
    setBusy(true); setMessage(null);
    const r = await t.saveFormation(draft, baseVersion);
    setBusy(false);
    if (r.ok) { setMessage({ kind: 'ok', text: 'Escalação salva.' }); stopEdit(); return; }
    setMessage(r.conflict
      ? { kind: 'conflict', text: 'Outra pessoa salvou esta escalação enquanto você editava. Recarregue para ver a versão atual (suas mudanças não foram salvas).' }
      : { kind: 'error', text: r.message || 'Não foi possível salvar a escalação.' });
  }

  // ---- geometry
  const toFrac = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint(); pt.x = clientX; pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    const f = fromCourt(p.x, p.y);
    return { fx: f.fx, fy: f.fy, inside: p.x >= 0 && p.x <= COURT.w && p.y >= 0 && p.y <= COURT.h };
  };
  const starterAt = (fx: number, fy: number) => draft.starters.find((s) => {
    const a = toCourt(s.x, s.y); const b = toCourt(fx, fy);
    return Math.hypot(a.x - b.x, a.y - b.y) < 32;
  });
  const isStarter = (id: string | null) => Boolean(id && draft.starters.some((s) => s.player_id === id));

  // ---- taps (the touch-friendly path: select, then choose the destination)
  const tapPlayer = (id: string) => {
    if (selected && selected !== id) {
      if (isStarter(selected) !== isStarter(id)) { // starter ⇄ reserve
        const [s, r] = isStarter(selected) ? [selected, id] : [id, selected];
        setDraft((f) => swap(f, s, r)); setSelected(null); return;
      }
    }
    setSelected((cur) => (cur === id ? null : id));
  };
  const tapCourt = (fx: number, fy: number) => {
    if (!selected) return;
    if (isStarter(selected)) { setDraft((f) => move(f, selected, fx, fy)); return; }
    const next = promote(draft, selected, { x: fx, y: fy });
    if (next) { setDraft(next); setSelected(null); }
  };
  const tapSlot = (role: string, spot: { x: number; y: number }) => {
    if (!selected) return;
    if (isStarter(selected)) { setDraft((f) => move(f, selected, spot.x, spot.y)); return; }
    const next = promote(draft, selected, spot, role);
    if (next) { setDraft(next); setSelected(null); }
  };

  // ---- pointer drag (mouse and touch)
  // The live drag lives in a ref: a quick tap fires pointerdown and pointerup
  // before React re-renders, and the state would still be empty at pointerup.
  // A tap (no movement) is handled by the click that follows.
  const beginDrag = (e: React.PointerEvent, id: string, from: Drag['from']) => {
    if (!editing) return;
    if (from === 'bench') e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { id, from, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moved: false };
    movedRef.current = false;
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const moved = d.moved || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 6;
    dragRef.current = { ...d, x: e.clientX, y: e.clientY, moved };
    if (!moved) return;
    if (d.from === 'court') {
      const f = toFrac(e.clientX, e.clientY);
      if (f) setDraft((x) => move(x, d.id, f.fx, f.fy));
    } else setDrag(dragRef.current);
  };
  const endDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    movedRef.current = d.moved;
    if (!d.moved) { if (d.from === 'bench') tapPlayer(d.id); return; }
    if (d.from === 'bench') {
      const f = toFrac(e.clientX, e.clientY);
      if (!f || !f.inside) return;
      const target = starterAt(f.fx, f.fy);
      if (target) { setDraft((x) => swap(x, target.player_id, d.id)); return; }
      const next = promote(draft, d.id, { x: f.fx, y: f.fy });
      if (next) setDraft(next);
      else setMessage({ kind: 'error', text: 'A quadra já tem três titulares: solte o reserva sobre um titular para trocá-los.' });
    }
  };

  const emptyRoles = DEFAULT_ROLES.map((d) => d.role).filter((r) => !shown.starters.some((s) => s.role === r)).slice(0, MAX_STARTERS - shown.starters.length);
  const slots = emptyRoles.map((role, i) => ({ role, spot: spotFor(role, [...shown.starters, ...emptyRoles.slice(0, i).map((r) => spotFor(r, shown.starters))]) }));
  const sel = selected ? byId.get(selected) ?? null : null;
  const selStarter = selected ? draft.starters.find((s) => s.player_id === selected) ?? null : null;
  const goTo = (id: string) => { const p = byId.get(id); if (p) navigate(`/jogadores/${p.slug ?? p.player_id}`); };

  async function downloadImage() {
    setExporting(true);
    try {
      await exportFormationImage({ team, seasonName, formation: live, players: byId, avatarOf });
    } catch {
      setMessage({ kind: 'error', text: 'Não foi possível gerar a imagem.' });
    }
    setExporting(false);
  }

  if (!seasonTeamId) return null;
  return (
    <section className={`tac-section${editing ? ' is-editing' : ''}`} aria-labelledby="tac-title">
      <header className="tac-head">
        <div className="tac-identity">
          <TeamLogo src={team.logo_url} name={team.name} size={44} />
          <div>
            <span className="tac-kicker">Mapa tático{seasonName ? ` · ${seasonName}` : ''}</span>
            <h2 id="tac-title">{team.name}</h2>
          </div>
        </div>
        <div className="tac-actions">
          {!editing && roster.length > 0 && <button type="button" className="button button-outline button-small" onClick={() => void downloadImage()} disabled={exporting || t.loading}><Download size={14} aria-hidden="true" /> {exporting ? 'Gerando...' : 'Baixar imagem'}</button>}
          {!editing && t.canEdit && roster.length > 0 && <button type="button" className="button button-primary button-small" onClick={startEdit} disabled={t.loading}><Pencil size={14} aria-hidden="true" /> Editar escalação</button>}
        </div>
      </header>
      <p className="tac-note">Apresentação do elenco definida pelo clube. Não é a escalação oficial de nenhuma partida.</p>

      {message && (
        <p className={`tac-message is-${message.kind}`} role={message.kind === 'ok' ? 'status' : 'alert'}>
          {message.kind === 'ok' && <CheckCircle2 size={14} aria-hidden="true" />} {message.text}
          {message.kind === 'conflict' && <button type="button" className="button button-outline button-small" onClick={() => { setMessage(null); stopEdit(); void t.reload(); }}><RefreshCw size={13} aria-hidden="true" /> Recarregar</button>}
        </p>
      )}
      {t.error && <FormError message="Não foi possível carregar o mapa tático." />}

      {roster.length === 0 ? (
        <div className="tac-empty"><Users size={18} aria-hidden="true" /> O elenco desta temporada ainda não foi registrado.</div>
      ) : (
        <div className="tac-layout">
          <div className="tac-court-wrap">
            <svg ref={svgRef} viewBox={`0 0 ${COURT.w} ${COURT.h}`} className="tac-court" role="img"
              aria-label={`Quadra com ${shown.starters.length} titular(es): ${shown.starters.map((s) => `${byId.get(s.player_id)?.nickname} (${s.role})`).join(', ') || 'nenhum'}`}
              onPointerMove={onDragMove} onPointerUp={endDrag} onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
              onClick={(e) => { if (!editing || (e.target as Element).closest('.tac-token, .tac-slot')) return; const f = toFrac(e.clientX, e.clientY); if (f?.inside) tapCourt(f.fx, f.fy); }}>
              <CourtMarkings idPrefix={`c-${seasonTeamId.slice(0, 6)}`} />
              {editing && <rect className="tac-hit-court" x={COURT.x0} y={COURT.y0} width={COURT.x1 - COURT.x0} height={COURT.y1 - COURT.y0} fill="transparent" />}
              {slots.map(({ role, spot }) => {
                const p = toCourt(spot.x, spot.y);
                return (
                  <g key={`slot-${role}`} className={editing ? 'tac-slot is-clickable' : 'tac-slot'} onClick={(e) => { if (!editing) return; e.stopPropagation(); tapSlot(role, spot); }}>
                    <EmptySlot x={p.x} y={p.y} role={role} active={Boolean(editing && selected && !isStarter(selected))} />
                  </g>
                );
              })}
              {shown.starters.map((s) => {
                const p = byId.get(s.player_id);
                const c = toCourt(s.x, s.y);
                return (
                  <g key={s.player_id} className={`tac-token${editing ? ' is-editable' : ' is-link'}`}
                    onPointerDown={(e) => beginDrag(e, s.player_id, 'court')}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!editing) { goTo(s.player_id); return; }
                      if (movedRef.current) { movedRef.current = false; return; } // end of a drag, not a tap
                      tapPlayer(s.player_id);
                    }}
                    tabIndex={0} role={editing ? 'button' : 'link'} aria-label={`${p?.nickname} (${s.role})${editing ? ', toque para selecionar' : ', abrir perfil'}`}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (editing) tapPlayer(s.player_id); else goTo(s.player_id); } }}>
                    <PlayerToken config={avatarOf(s.player_id)} name={p?.nickname ?? '?'} role={s.role} number={p?.shirt_number ?? null} x={c.x} y={c.y}
                      uid={`t-${s.player_id.slice(0, 8)}`} selected={editing && selected === s.player_id} />
                  </g>
                );
              })}
            </svg>
            {editing && <p className="tac-hint">Arraste os titulares na quadra. Para trocar ou escalar, toque em um jogador e depois no destino: na quadra, numa vaga ou em outro jogador.</p>}
          </div>

          <aside className="tac-bench" aria-label="Banco de reservas">
            <h3>Banco de reservas <span>{shown.bench.length}</span></h3>
            {shown.bench.length === 0 ? <p className="tac-bench-empty">Sem reservas nesta temporada.</p> : (
              <ol>
                {shown.bench.map((id, i) => {
                  const p = byId.get(id);
                  if (!p) return null;
                  const isSel = editing && selected === id;
                  return (
                    <li key={id} className={isSel ? 'is-selected' : undefined}>
                      {editing && (
                        <span className="tac-grip" onPointerDown={(e) => beginDrag(e, id, 'bench')} onPointerMove={onDragMove} onPointerUp={endDrag}
                          role="button" tabIndex={-1} aria-label={`Arrastar ${p.nickname} para a quadra`} title="Arraste para a quadra"><GripVertical size={16} /></span>
                      )}
                      <button type="button" className="tac-bench-player" onClick={() => (editing ? tapPlayer(id) : goTo(id))} aria-pressed={editing ? isSel : undefined}>
                        <MiniAvatar config={avatarOf(id)} number={p.shirt_number} size={40} uid={`b-${id.slice(0, 8)}`} />
                        <span className="tac-bench-info"><strong>{p.nickname}</strong><small>{[p.position, p.shirt_number != null ? `#${p.shirt_number}` : null].filter(Boolean).join(' · ') || 'Posição não definida'}</small></span>
                      </button>
                      {editing && (
                        <span className="tac-order">
                          <button type="button" className="icon-button" aria-label={`Subir ${p.nickname} no banco`} disabled={i === 0} onClick={() => setDraft((f) => reorderBench(f, id, -1))}><ArrowUp size={14} /></button>
                          <button type="button" className="icon-button" aria-label={`Descer ${p.nickname} no banco`} disabled={i === shown.bench.length - 1} onClick={() => setDraft((f) => reorderBench(f, id, 1))}><ArrowDown size={14} /></button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}

            {editing && (
              <div className="tac-panel" aria-live="polite">
                {!sel ? (
                  <>
                    <p className="tac-panel-empty">Toque em um jogador para escalá-lo, trocá-lo, mudar a posição ou editar o avatar.</p>
                    {draft.starters.length === 0 && <button type="button" className="button button-outline button-small" onClick={() => setDraft(suggestStarters(roster))}><Lightbulb size={14} aria-hidden="true" /> Sugerir pelas posições do cadastro</button>}
                  </>
                ) : (
                  <>
                    <p className="tac-panel-title"><MiniAvatar config={avatarOf(sel.player_id)} number={sel.shirt_number} size={30} uid="panel" /> <strong>{sel.nickname}</strong> <span>{selStarter ? 'titular' : 'reserva'}</span></p>
                    {selStarter ? (
                      <>
                        <div className="tac-roles" role="group" aria-label="Posição na quadra">
                          {DEFAULT_ROLES.map((r) => <button key={r.role} type="button" aria-pressed={selStarter.role === r.role} onClick={() => setDraft((f) => setRole(f, sel.player_id, r.role))} title={r.label}>{r.role}</button>)}
                          <input className="form-input" aria-label="Outra posição (até 4 letras)" placeholder="Outra" maxLength={4} value={customRole}
                            onChange={(e) => setCustomRole(e.target.value.toUpperCase())}
                            onKeyDown={(e) => { if (e.key === 'Enter') { const r = normalizeRole(customRole); if (r) { setDraft((f) => setRole(f, sel.player_id, r)); setCustomRole(''); } } }}
                            onBlur={() => { const r = normalizeRole(customRole); if (r) { setDraft((f) => setRole(f, sel.player_id, r)); setCustomRole(''); } }} />
                        </div>
                        <button type="button" className="button button-outline button-small" onClick={() => { setDraft((f) => demote(f, sel.player_id)); setSelected(null); }}>Enviar ao banco</button>
                        <p className="tac-panel-tip">Para trocar com um reserva, toque no reserva. Para mover, toque no lugar da quadra.</p>
                      </>
                    ) : (
                      <>
                        <button type="button" className="button button-outline button-small" disabled={draft.starters.length >= MAX_STARTERS}
                          onClick={() => { const n = promote(draft, sel.player_id); if (n) { setDraft(n); setSelected(null); } }}>Colocar na quadra</button>
                        <p className="tac-panel-tip">{draft.starters.length >= MAX_STARTERS ? 'A quadra está completa: toque em um titular para trocar.' : 'Ou toque no lugar da quadra ou numa vaga.'}</p>
                      </>
                    )}
                    <button type="button" className="button button-outline button-small" onClick={() => setAvatarFor(sel.player_id)}><Palette size={14} aria-hidden="true" /> Editar avatar</button>
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      {editing && (
        <div className="tac-editbar">
          {confirmDiscard ? (
            <>
              <span>Descartar as alterações não salvas?</span>
              <button type="button" className="button button-outline button-small" onClick={() => setConfirmDiscard(false)}>Continuar editando</button>
              <button type="button" className="button button-danger button-small" onClick={stopEdit}><Undo2 size={14} aria-hidden="true" /> Descartar</button>
            </>
          ) : (
            <>
              <span>{dirty ? 'Alterações não salvas' : 'Nenhuma alteração'}</span>
              <button type="button" className="button button-outline button-small" onClick={cancel} disabled={busy}>Cancelar</button>
              <button type="button" className="button button-primary button-small" onClick={() => void save()} disabled={busy || !dirty}><Save size={14} aria-hidden="true" /> {busy ? 'Salvando...' : 'Salvar'}</button>
            </>
          )}
        </div>
      )}

      {drag?.moved && drag.from === 'bench' && byId.get(drag.id) && (
        <div className="tac-ghost" style={{ left: drag.x, top: drag.y }} aria-hidden="true">
          <MiniAvatar config={avatarOf(drag.id)} number={byId.get(drag.id)!.shirt_number} size={52} uid="ghost" />
        </div>
      )}

      {avatarFor && byId.get(avatarFor) && (
        <AvatarEditor player={byId.get(avatarFor)!} current={t.avatars.get(avatarFor) ?? null}
          onSave={(config) => t.saveAvatar(avatarFor, config)} onClose={() => setAvatarFor(null)} />
      )}
    </section>
  );
}
