// Transmissions on the air for the global mini player. Two light public
// queries (streamers marked "Ao vivo" and streamers of LIVE matches), every
// 30 seconds while the tab is visible and right away when the visitor comes
// back to it. The list only changes when its content changes, so the player
// is never recreated by a refresh.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { mergeLiveStreams, signature, type LiveEntry, type LiveMatchRow, type LiveStreamer } from '@/lib/liveStreams';

export const LIVE_REFRESH_MS = 30000;
const STREAMER_FIELDS = 'id, display_name, platform, channel, is_live, live_since';

export function useLiveStreams() {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const sig = useRef('');
  useEffect(() => {
    let active = true;
    let busy = false;
    const load = async () => {
      if (busy || document.hidden) return;
      busy = true;
      const [s, m] = await Promise.all([
        supabase.from('streamers').select(STREAMER_FIELDS).eq('is_live', true),
        supabase.from('matches').select(`id, home_score, away_score, home_team:home_team_id ( team:team_id ( name ) ), away_team:away_team_id ( team:team_id ( name ) ), match_streamers ( streamer:streamer_id ( ${STREAMER_FIELDS} ) )`).eq('status', 'LIVE'),
      ]);
      busy = false;
      if (!active || s.error || m.error) return; // keep the last good list on a failed refresh
      const next = mergeLiveStreams((s.data ?? []) as LiveStreamer[], (m.data ?? []) as unknown as LiveMatchRow[]);
      const nextSig = signature(next);
      if (nextSig !== sig.current) { sig.current = nextSig; setEntries(next); }
    };
    void load();
    const timer = window.setInterval(() => void load(), LIVE_REFRESH_MS);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, []);
  return entries;
}
