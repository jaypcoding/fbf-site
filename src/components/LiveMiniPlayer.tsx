// Global mini player of the transmissions on the air. Mounted once in the app
// shell (outside the routes), so it keeps playing while the visitor moves
// between pages. Only the selected transmission loads a player; the others
// stay in the list. Players start muted. Closing or minimizing never changes
// the streamer's status. Hidden in the admin panel and the login pages.
import { useEffect, useMemo, useState } from 'react';
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

  if (!active || HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))) return null;
  const { streamer, match } = active;
  const count = entries.length;

  if (mode === 'closed') {
    return (
      <button type="button" className="live-mini-reopen" onClick={() => setMode('open')} aria-label={`Abrir transmissão ao vivo (${count})`}>
        <span className="live-dot" aria-hidden="true" /> Ao vivo{count > 1 ? ` · ${count}` : ''}
      </button>
    );
  }

  return (
    <aside className={`live-mini${mode === 'min' ? ' is-collapsed' : ''}`} aria-label="Transmissão ao vivo">
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
          <button type="button" onClick={() => setMode(mode === 'min' ? 'open' : 'min')} title={mode === 'min' ? 'Expandir' : 'Minimizar'} aria-label={mode === 'min' ? 'Expandir' : 'Minimizar'}>
            {mode === 'min' ? <Plus size={15} /> : <Minus size={15} />}
          </button>
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
  );
}
