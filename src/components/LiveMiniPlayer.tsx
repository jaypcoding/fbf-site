import { useState } from 'react';
import { Minus, Plus, Radio, X } from 'lucide-react';
import { useLiveStreams, type LiveStream } from '@/lib/hooks';
import type { Streamer } from '@/lib/supabase';

function embedUrl(streamer: Streamer) {
  if (streamer.platform === 'TWITCH') {
    return `https://player.twitch.tv/?channel=${encodeURIComponent(streamer.channel)}&parent=${window.location.hostname}`;
  }
  return `https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(streamer.channel)}`;
}

export function LiveMiniPlayer() {
  const { streams } = useLiveStreams();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const active: LiveStream | undefined = streams.find((s) => s.key === selectedKey) ?? streams[0];
  if (dismissed || !active) return null;

  return (
    <div className={`live-mini${collapsed ? ' is-collapsed' : ''}`} role="complementary" aria-label="Transmissão ao vivo">
      <div className="live-mini-header">
        <div className="live-mini-title"><span />Ao vivo</div>
        <div className="live-mini-controls">
          <button onClick={() => setCollapsed((value) => !value)} title={collapsed ? 'Expandir' : 'Minimizar'} aria-label={collapsed ? 'Expandir' : 'Minimizar'}>
            {collapsed ? <Plus size={15} /> : <Minus size={15} />}
          </button>
          <button onClick={() => setDismissed(true)} title="Fechar" aria-label="Fechar"><X size={15} /></button>
        </div>
      </div>
      {streams.length > 1 && (
        <div className="live-mini-tabs">
          {streams.map((s) => (
            <button key={s.key} className={s.key === active.key ? 'active' : ''} onClick={() => setSelectedKey(s.key)}>
              <Radio size={11} /> {s.streamer.display_name}
            </button>
          ))}
        </div>
      )}
      <div className="live-mini-body">
        <iframe src={embedUrl(active.streamer)} title={`Transmissão de ${active.streamer.display_name}`} allow="autoplay; fullscreen" />
      </div>
      <div className="live-mini-match">{active.homeName} {active.homeScore ?? 0} × {active.awayScore ?? 0} {active.awayName}</div>
    </div>
  );
}
