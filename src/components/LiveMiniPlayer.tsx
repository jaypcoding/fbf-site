// Global mini player of the transmissions on the air. Mounted once in the app
// shell (outside the routes), so it keeps playing while the visitor moves
// between pages. Only the selected transmission loads a player; the others
// stay in the list. Players start muted. Closing or minimizing never changes
// the streamer's status. Hidden in the admin panel and the login pages.
// It never covers page controls: it rises above any bottom bar marked with
// [data-live-mini-avoid], steps aside (a small "Ao vivo" button) while a page
// sets <html data-live-mini-park> (e.g. the tactical map editor), and a spacer
// at the end of the page keeps the last content reachable above it. While an
// element marked [data-live-mini-shy] (the tactical court, the bench) is inside
// the corner area of the open player, it folds into its header bar
// (the player stays loaded, it is not recreated); "Expandir" shows it anyway.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ExternalLink, ListVideo, Minus, Plus, Radio, X } from 'lucide-react';
import { useLiveStreams } from '@/lib/liveStreamsData';
import { pickActive } from '@/lib/liveStreams';
import { channelUrl, mutedEmbedUrl, platformLabel } from '@/lib/streaming';

type Mode = 'open' | 'min' | 'closed';
const MODE_KEY = 'fbf-live-mini-mode';
const PICK_KEY = 'fbf-live-mini-pick';
const HIDDEN_PREFIXES = ['/painel', '/login', '/recuperar-senha', '/redefinir-senha'];
const readPick = (): string | null => { try { return sessionStorage.getItem(PICK_KEY); } catch { return null; } };
const LIFT_VAR = '--live-mini-lift';

/** True while a page asks the mini player to step aside (<html data-live-mini-park>). */
function useParked() {
  const read = () => typeof document !== 'undefined' && 'liveMiniPark' in document.documentElement.dataset;
  const [parked, setParked] = useState(read);
  useEffect(() => {
    const obs = new MutationObserver(() => setParked(read()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-live-mini-park'] });
    return () => obs.disconnect();
  }, []);
  return parked;
}

// area the open player takes in the corner (with its margins): 16:9 video + header + footer
const openArea = (vw: number, vh: number, lift: number) => {
  const width = vw <= 600 ? vw : (vw <= 1024 ? 300 : 340) + 32;
  return { left: vw - width, right: vw, top: vh - lift - (vw <= 600 ? vw * 0.5625 + 110 : width * 0.5625 + 110), bottom: vh };
};

/** Keeps the player above bottom bars marked [data-live-mini-avoid] (save bars, sticky controls)
 *  and reports when a [data-live-mini-shy] element is inside the area the open player would take. */
function useAvoidLift(enabled: boolean, onShy: (shy: boolean) => void) {
  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) { root.style.removeProperty(LIFT_VAR); onShy(false); return undefined; }
    let frame = 0;
    let last = -1;
    const measure = () => {
      frame = 0;
      const vh = window.innerHeight;
      let lift = 0;
      document.querySelectorAll('[data-live-mini-avoid]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.top < vh && r.bottom > vh - 200) lift = Math.max(lift, Math.ceil(vh - r.top));
      });
      if (lift !== last) { last = lift; root.style.setProperty(LIFT_VAR, `${lift}px`); }
      let shy = false;
      const area = openArea(window.innerWidth, vh, lift);
      document.querySelectorAll('[data-live-mini-shy]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.left < area.right && r.right > area.left && r.top < area.bottom && r.bottom > area.top) shy = true;
      });
      onShy(shy);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const obs = new MutationObserver(schedule);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => { if (frame) window.cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); obs.disconnect(); root.style.removeProperty(LIFT_VAR); };
  }, [enabled, onShy]);
}

const readMode = (): Mode => { try { const v = sessionStorage.getItem(MODE_KEY); return v === 'min' || v === 'closed' ? v : 'open'; } catch { return 'open'; } };

export function LiveMiniPlayer() {
  const entries = useLiveStreams();
  const { pathname } = useLocation();
  const [selectedKey, setSelectedState] = useState<string | null>(readPick);
  const [mode, setModeState] = useState<Mode>(readMode);
  const [listOpen, setListOpen] = useState(false);
  // the visitor's choice lasts for the browser session (a reload keeps the same transmission)
  const setSelectedKey = (k: string | null) => { setSelectedState(k); try { if (k) sessionStorage.setItem(PICK_KEY, k); else sessionStorage.removeItem(PICK_KEY); } catch { /* private mode */ } };
  const setMode = (m: Mode) => { setModeState(m); try { sessionStorage.setItem(MODE_KEY, m); } catch { /* private mode */ } };

  const active = useMemo(() => pickActive(entries, selectedKey), [entries, selectedKey]);
  // when the chosen transmission leaves the air, the next one is shown (pickActive); forget the old choice
  useEffect(() => { if (selectedKey && entries.length > 0 && !entries.some((e) => e.key === selectedKey)) setSelectedKey(null); }, [entries, selectedKey]);
  useEffect(() => { if (entries.length < 2) setListOpen(false); }, [entries.length]);

  const parked = useParked();
  const [unparked, setUnparked] = useState(false); // the visitor reopened it during the edit: their choice
  useEffect(() => { if (!parked) setUnparked(false); }, [parked]);
  const hidden = !active || HIDDEN_PREFIXES.some((p) => pathname.startsWith(p));
  const [shy, setShy] = useState(false);
  const [forceOpen, setForceOpen] = useState(false); // "Expandir" while folded: the visitor's choice
  useEffect(() => { if (!shy) setForceOpen(false); }, [shy]);
  useAvoidLift(!hidden, setShy);

  // spacer at the end of the page, the height of the open player, so nothing stays hidden under it
  const boxRef = useRef<HTMLElement | null>(null);
  const [space, setSpace] = useState(0);
  const showBox = !hidden && mode !== 'closed' && (!parked || unparked);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!showBox || !el) { setSpace(0); return undefined; }
    const update = () => setSpace(Math.ceil(el.getBoundingClientRect().height) + 24);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showBox, mode, listOpen]);

  if (hidden) return null;
  const folded = shy && !forceOpen && mode === 'open';
  const { streamer, match } = active;
  const count = entries.length;

  if (parked && !unparked && mode !== 'closed') {
    return (
      <button type="button" className="live-mini-reopen is-parked" onClick={() => setUnparked(true)} title="O mini player foi recolhido durante a edição" aria-label={`Mostrar transmissão ao vivo (${count})`}>
        <span className="live-dot" aria-hidden="true" /> Ao vivo{count > 1 ? ` · ${count}` : ''}
      </button>
    );
  }

  if (mode === 'closed') {
    return (
      <button type="button" className="live-mini-reopen" onClick={() => setMode('open')} aria-label={`Abrir transmissão ao vivo (${count})`}>
        <span className="live-dot" aria-hidden="true" /> Ao vivo{count > 1 ? ` · ${count}` : ''}
      </button>
    );
  }

  return (
    <>
    <aside ref={boxRef} className={`live-mini${mode === 'min' ? ' is-collapsed' : ''}${folded ? ' is-folded' : ''}`} aria-label="Transmissão ao vivo">
      <div className="live-mini-header">
        <div className="live-mini-title">
          <span className="live-badge-mini"><span className="live-dot" aria-hidden="true" /> Ao vivo</span>
          <span className="live-mini-who"><strong>{streamer.display_name}</strong><small>{platformLabel(streamer.platform)}</small></span>
        </div>
        <div className="live-mini-controls">
          {count > 1 && (
            <button type="button" onClick={() => { setListOpen((v) => !v); if (mode === 'min') setMode('open'); }} aria-expanded={listOpen} aria-controls="live-mini-list"
              title="Escolher transmissão" aria-label={`Escolher transmissão (${count} ao vivo)`} className="live-mini-switch">
              <ListVideo size={15} aria-hidden="true" /> {count}
            </button>
          )}
          {folded ? (
            <button type="button" onClick={() => setForceOpen(true)} title="Expandir" aria-label="Expandir"><Plus size={15} /></button>
          ) : (
            <button type="button" onClick={() => setMode(mode === 'min' ? 'open' : 'min')} title={mode === 'min' ? 'Expandir' : 'Minimizar'} aria-label={mode === 'min' ? 'Expandir' : 'Minimizar'}>
              {mode === 'min' ? <Plus size={15} /> : <Minus size={15} />}
            </button>
          )}
          <button type="button" onClick={() => { setMode('closed'); setListOpen(false); }} title="Fechar" aria-label="Fechar o mini player"><X size={15} /></button>
        </div>
      </div>
      {listOpen && count > 1 && (
        <ul id="live-mini-list" className="live-mini-list" aria-label="Transmissões ao vivo">
          {entries.map((e) => (
            <li key={e.key}>
              <button type="button" aria-pressed={e.key === active.key} onClick={() => { setSelectedKey(e.key); setListOpen(false); }}>
                <span className={`live-platform is-${e.streamer.platform.toLowerCase()}`}>{platformLabel(e.streamer.platform)}</span>
                <span className="live-mini-item"><strong>{e.streamer.display_name}</strong><small>{e.streamer.platform === 'YOUTUBE' ? 'canal do YouTube' : `@${e.streamer.channel}`}{e.match ? ` · ${e.match.homeName} × ${e.match.awayName}` : ''}</small></span>
                {e.key === active.key && <Radio size={13} aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      {mode === 'open' && (
        <>
          <div className="live-mini-body">
            <iframe key={active.key} src={mutedEmbedUrl(streamer.platform, streamer.channel, window.location.hostname)}
              title={`Transmissão de ${streamer.display_name} no ${platformLabel(streamer.platform)}`} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen loading="lazy" />
          </div>
          <div className="live-mini-foot">
            {match ? <Link to={`/partidas/${match.matchId}`}>{match.homeName} {match.homeScore ?? 0} × {match.awayScore ?? 0} {match.awayName}</Link>
              : <span>Começa sem som: ative o áudio no player.</span>}
            <a href={channelUrl(streamer.platform, streamer.channel)} target="_blank" rel="noreferrer noopener" aria-label={`Abrir no ${platformLabel(streamer.platform)}`}>
              {platformLabel(streamer.platform)} <ExternalLink size={11} aria-hidden="true" />
            </a>
          </div>
        </>
      )}
      {mode === 'min' && count > 1 && !listOpen && (
        <button type="button" className="live-mini-more" onClick={() => setListOpen(true)}><ChevronDown size={13} aria-hidden="true" /> {count} transmissões ao vivo</button>
      )}
    </aside>
    {space > 0 && <div className="live-mini-spacer" style={{ height: space }} aria-hidden="true" />}
    </>
  );
}
