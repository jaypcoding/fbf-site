// Mapa tático: data of one club in one season (formation, avatars, permission).
// Reads only presentation tables plus the existing registrations; writes go
// through save_team_formation / save_team_player_avatar, which check the
// permission and the roster again in the database.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import type { AvatarConfig, Formation } from '@/lib/tactics';

export type TacticsState = {
  loading: boolean;
  error: boolean;
  saved: Formation | null;
  version: number;
  updatedAt: string | null;
  avatars: Map<string, AvatarConfig>;
  canEdit: boolean;
};

export function useTeamTactics(teamId: string | undefined, seasonTeamId: string | null) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [state, setState] = useState<TacticsState>({ loading: true, error: false, saved: null, version: 0, updatedAt: null, avatars: new Map(), canEdit: false });

  const load = useCallback(async () => {
    if (!teamId || !seasonTeamId) { setState((s) => ({ ...s, loading: false, saved: null, version: 0 })); return; }
    setState((s) => ({ ...s, loading: true, error: false }));
    const [f, a, c] = await Promise.all([
      supabase.from('team_formations').select('starters, bench, version, updated_at').eq('season_team_id', seasonTeamId).maybeSingle(),
      supabase.from('team_player_avatars').select('player_id, config').eq('team_id', teamId),
      userId ? supabase.rpc('can_edit_team_presentation', { p_team_id: teamId }) : Promise.resolve({ data: false, error: null }),
    ]);
    if (f.error || a.error) { setState((s) => ({ ...s, loading: false, error: true })); return; }
    const row = f.data as { starters: Formation['starters']; bench: string[]; version: number; updated_at: string } | null;
    setState({
      loading: false, error: false,
      saved: row ? { starters: row.starters ?? [], bench: row.bench ?? [] } : null,
      version: row?.version ?? 0, updatedAt: row?.updated_at ?? null,
      avatars: new Map(((a.data ?? []) as { player_id: string; config: AvatarConfig }[]).map((x) => [x.player_id, x.config])),
      canEdit: Boolean(c.data),
    });
  }, [teamId, seasonTeamId, userId]);

  useEffect(() => { void load(); }, [load]);

  const saveFormation = useCallback(async (formation: Formation, expectedVersion: number) => {
    const { data, error } = await supabase.rpc('save_team_formation', { p_season_team_id: seasonTeamId, p_expected_version: expectedVersion, p_formation: formation });
    if (error) return { ok: false as const, conflict: error.code === '55000', message: error.message };
    setState((s) => ({ ...s, saved: formation, version: data as number, updatedAt: new Date().toISOString() }));
    return { ok: true as const };
  }, [seasonTeamId]);

  const saveAvatar = useCallback(async (playerId: string, config: AvatarConfig | null) => {
    const { error } = await supabase.rpc('save_team_player_avatar', { p_team_id: teamId, p_player_id: playerId, p_config: config });
    if (error) return { ok: false as const, message: error.message };
    setState((s) => {
      const avatars = new Map(s.avatars);
      if (config) avatars.set(playerId, config); else avatars.delete(playerId);
      return { ...s, avatars };
    });
    return { ok: true as const };
  }, [teamId]);

  return { ...state, reload: load, saveFormation, saveAvatar };
}
