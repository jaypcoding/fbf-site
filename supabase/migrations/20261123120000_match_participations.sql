/*
# Official participation of players in matches (Phase 1 of the expansion)

Until now the database only knew who scored, assisted or kept goal. This
migration records WHO PLAYED each finished match, so that matches played,
wins, draws, losses and the MVP win bonus can be computed from official data.

1. New table `match_participations` (additive; no existing row is changed)
   - one row per player per match (primary key match_id + player_id: a player
     can never be counted twice in the same match, nor play for both teams);
   - `season_team_id` is the team he played for in THAT season, so the history
     stays even if he later leaves the roster or changes team;
   - `source`: REPLAY (written when a sheet from recordings is confirmed) or
     SHEET (lineup informed by an organizer);
   - foreign keys are RESTRICT, like the other match history tables (replays,
     sheet edits): a reset or deletion of a match with a registered lineup is
     refused instead of losing the history silently.

2. Who writes it
   - Nobody writes the table directly (no INSERT/UPDATE/DELETE grants).
   - Confirming a sheet from recordings writes the identified players of the
     sheet (trigger on the review becoming CONFIRMED, inside the same
     transaction; a re-confirmation replaces the previous lineup).
   - `save_match_lineup` lets an organizer of the competition (or an admin)
     register or correct the lineup of a finished match WITHOUT touching the
     score or the events; every change is kept in match_edit_history.

3. Participation evidence
   Players with official goals, assists or goalkeeper records are proven
   participants even without a lineup (view player_match_participation in the
   next migration). A lineup can never put such a player in the other team.

4. Security
   - Public read, like match_events (the table holds no private data).
   - Writes only through the SECURITY DEFINER paths above, which check
     can_manage_match.
*/

CREATE TABLE IF NOT EXISTS public.match_participations (
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE RESTRICT,
  season_team_id uuid NOT NULL REFERENCES public.season_teams(id) ON DELETE RESTRICT,
  seconds_played integer CHECK (seconds_played IS NULL OR seconds_played BETWEEN 0 AND 86400),
  source text NOT NULL CHECK (source IN ('REPLAY', 'SHEET')),
  review_id uuid REFERENCES public.match_replay_reviews(id) ON DELETE RESTRICT,
  recorded_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, player_id),
  CHECK ((source = 'REPLAY') = (review_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS match_participations_player_id_idx ON public.match_participations(player_id);
CREATE INDEX IF NOT EXISTS match_participations_season_team_id_idx ON public.match_participations(season_team_id);

COMMENT ON TABLE public.match_participations IS 'Players who took part in a finished match (lineup). Written only by sheet confirmation and save_match_lineup.';

ALTER TABLE public.match_participations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_participations_public_select ON public.match_participations;
CREATE POLICY match_participations_public_select ON public.match_participations FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.match_participations FROM anon, authenticated;
GRANT SELECT ON public.match_participations TO anon, authenticated;

-- The participant must play for one of the two teams of the match, the match
-- must be finished, and he cannot have official events for the other team.
CREATE OR REPLACE FUNCTION public.validate_match_participation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.matches%ROWTYPE;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = NEW.match_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partida não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NEW.season_team_id IS DISTINCT FROM v_match.home_team_id AND NEW.season_team_id IS DISTINCT FROM v_match.away_team_id THEN
    RAISE EXCEPTION 'O jogador precisa ter atuado por uma das equipes da partida' USING ERRCODE = '23514';
  END IF;
  IF v_match.status <> 'FINISHED' THEN
    RAISE EXCEPTION 'A escalação só é registrada em partidas finalizadas' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.match_events e
    WHERE e.match_id = NEW.match_id AND e.player_id = NEW.player_id AND e.team_id <> NEW.season_team_id
  ) OR EXISTS (
    SELECT 1 FROM public.goalkeeper_participations gp
    WHERE gp.match_id = NEW.match_id AND gp.player_id = NEW.player_id AND gp.team_id <> NEW.season_team_id
  ) THEN
    RAISE EXCEPTION 'O jogador tem gols, assistências ou registro de goleiro pela outra equipe nesta partida' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_participations_validate ON public.match_participations;
CREATE TRIGGER match_participations_validate
BEFORE INSERT OR UPDATE ON public.match_participations
FOR EACH ROW EXECUTE FUNCTION public.validate_match_participation();

-- Lineup of a match as stored (sorted), used for history and concurrency.
CREATE OR REPLACE FUNCTION public._match_lineup_snapshot(p_match_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('player_id', mp.player_id, 'season_team_id', mp.season_team_id,
      'seconds_played', mp.seconds_played, 'source', mp.source) ORDER BY mp.season_team_id, mp.player_id), '[]'::jsonb)
  FROM public.match_participations mp WHERE mp.match_id = p_match_id;
$$;
REVOKE EXECUTE ON FUNCTION public._match_lineup_snapshot(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.match_lineup_fingerprint(p_match_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.can_manage_match(p_match_id) THEN
    RAISE EXCEPTION 'Sem permissão para gerenciar esta partida' USING ERRCODE = '42501';
  END IF;
  RETURN md5(public._match_lineup_snapshot(p_match_id)::text);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.match_lineup_fingerprint(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_lineup_fingerprint(uuid) TO authenticated;

/*
  save_match_lineup(match, fingerprint, lineup, reason)
  lineup = [{ "player_id": uuid, "side": "home"|"away", "seconds_played": int|null }, ...]
  Replaces the whole lineup of a finished match. Score and events are never
  touched. Accepted players: in the roster of that team, or already recorded
  for that team in this match (events, goalkeeper or a previous lineup), so a
  player who left the roster later can still be kept in an old lineup.
*/
CREATE OR REPLACE FUNCTION public.save_match_lineup(p_match_id uuid, p_fingerprint text, p_lineup jsonb, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.matches%ROWTYPE;
  v_competition_status text;
  v_before jsonb;
  v_after jsonb;
  v_item jsonb;
  v_player uuid;
  v_team uuid;
  v_seconds integer;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_history_id bigint;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partida não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_manage_match(p_match_id) THEN
    RAISE EXCEPTION 'Sem permissão para editar esta partida' USING ERRCODE = '42501';
  END IF;
  IF v_match.status <> 'FINISHED' THEN
    RAISE EXCEPTION 'A escalação só é registrada em partidas finalizadas' USING ERRCODE = '23514';
  END IF;
  SELECT c.status INTO v_competition_status
  FROM public.rounds r JOIN public.stages stg ON stg.id = r.stage_id
  JOIN public.seasons s ON s.id = stg.season_id JOIN public.competitions c ON c.id = s.competition_id
  WHERE r.id = v_match.round_id;
  IF v_competition_status NOT IN ('UPCOMING', 'REGISTRATION', 'ACTIVE') AND NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Partidas de competições encerradas só podem ser editadas por administradores' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da alteração' USING ERRCODE = '22023';
  END IF;
  IF p_lineup IS NULL OR jsonb_typeof(p_lineup) <> 'array' THEN
    RAISE EXCEPTION 'Escalação inválida' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lineup) > 60 THEN
    RAISE EXCEPTION 'Escalação grande demais' USING ERRCODE = '22023';
  END IF;

  v_before := public._match_lineup_snapshot(p_match_id);
  IF p_fingerprint IS DISTINCT FROM md5(v_before::text) THEN
    RAISE EXCEPTION 'A escalação mudou desde que foi aberta; confira a versão atual antes de salvar' USING ERRCODE = '55000';
  END IF;

  -- validate everything before changing anything
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lineup)
  LOOP
    BEGIN
      v_player := (v_item->>'player_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Jogador inválido na escalação' USING ERRCODE = '22023';
    END;
    v_team := CASE v_item->>'side' WHEN 'home' THEN v_match.home_team_id WHEN 'away' THEN v_match.away_team_id END;
    IF v_player IS NULL OR v_team IS NULL THEN
      RAISE EXCEPTION 'Cada jogador da escalação precisa de uma equipe (mandante ou visitante)' USING ERRCODE = '22023';
    END IF;
    IF v_player = ANY (v_seen) THEN
      RAISE EXCEPTION 'Um jogador aparece mais de uma vez na escalação' USING ERRCODE = '23505';
    END IF;
    v_seen := v_seen || v_player;
    v_seconds := NULLIF(v_item->>'seconds_played', '')::integer;
    IF v_seconds IS NOT NULL AND (v_seconds < 0 OR v_seconds > 86400) THEN
      RAISE EXCEPTION 'Tempo jogado inválido' USING ERRCODE = '22023';
    END IF;
    IF NOT (
      EXISTS (SELECT 1 FROM public.rosters WHERE season_team_id = v_team AND player_id = v_player)
      OR EXISTS (SELECT 1 FROM public.match_events WHERE match_id = p_match_id AND player_id = v_player AND team_id = v_team)
      OR EXISTS (SELECT 1 FROM public.goalkeeper_participations WHERE match_id = p_match_id AND player_id = v_player AND team_id = v_team)
      OR EXISTS (SELECT 1 FROM public.match_participations WHERE match_id = p_match_id AND player_id = v_player AND season_team_id = v_team)
    ) THEN
      RAISE EXCEPTION 'Um jogador da escalação não pertence ao elenco da equipe' USING ERRCODE = '23514';
    END IF;
  END LOOP;

  DELETE FROM public.match_participations WHERE match_id = p_match_id;
  INSERT INTO public.match_participations (match_id, player_id, season_team_id, seconds_played, source, recorded_by)
  SELECT p_match_id, (value->>'player_id')::uuid,
         CASE value->>'side' WHEN 'home' THEN v_match.home_team_id ELSE v_match.away_team_id END,
         NULLIF(value->>'seconds_played', '')::integer, 'SHEET', auth.uid()
  FROM jsonb_array_elements(p_lineup);

  v_after := public._match_lineup_snapshot(p_match_id);
  IF v_after IS DISTINCT FROM v_before THEN
    INSERT INTO public.match_edit_history (match_id, actor, source, reason, before, after, changes)
    VALUES (p_match_id, auth.uid(), 'MANUAL', btrim(p_reason),
      jsonb_build_object('lineup', v_before), jsonb_build_object('lineup', v_after),
      jsonb_build_object('kind', 'lineup', 'players_before', jsonb_array_length(v_before), 'players_after', jsonb_array_length(v_after)))
    RETURNING id INTO v_history_id;
  END IF;

  RETURN jsonb_build_object('players', jsonb_array_length(v_after), 'history_id', v_history_id, 'fingerprint', md5(v_after::text));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.save_match_lineup(uuid, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_match_lineup(uuid, text, jsonb, text) TO authenticated;

-- Confirming a sheet from recordings writes its identified players (the
-- official payload built by the server lists them in "participants"). Runs in
-- the confirmation transaction: any inconsistency cancels the confirmation.
CREATE OR REPLACE FUNCTION public.record_replay_participations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_match public.matches%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF NEW.status <> 'CONFIRMED' OR OLD.status = 'CONFIRMED' THEN RETURN NEW; END IF;
  IF NEW.official IS NULL OR jsonb_typeof(NEW.official->'participants') <> 'array' THEN
    RETURN NEW; -- sheet built before participants existed: nothing to record
  END IF;
  SELECT * INTO v_match FROM public.matches WHERE id = NEW.match_id;
  v_before := public._match_lineup_snapshot(NEW.match_id);
  DELETE FROM public.match_participations WHERE match_id = NEW.match_id;
  INSERT INTO public.match_participations (match_id, player_id, season_team_id, seconds_played, source, review_id, recorded_by)
  SELECT NEW.match_id, (p->>'player_id')::uuid,
         CASE p->>'side' WHEN 'home' THEN v_match.home_team_id WHEN 'away' THEN v_match.away_team_id END,
         NULLIF(p->>'seconds_played', '')::integer, 'REPLAY', NEW.id, auth.uid()
  FROM jsonb_array_elements(NEW.official->'participants') p
  WHERE NULLIF(p->>'player_id', '') IS NOT NULL;
  v_after := public._match_lineup_snapshot(NEW.match_id);
  -- a previous lineup replaced by the recordings stays in the history
  IF jsonb_array_length(v_before) > 0 AND v_after IS DISTINCT FROM v_before THEN
    INSERT INTO public.match_edit_history (match_id, actor, source, reason, before, after, changes)
    VALUES (NEW.match_id, auth.uid(), 'REPLAY', 'Escalação refeita a partir das gravações da partida',
      jsonb_build_object('lineup', v_before), jsonb_build_object('lineup', v_after),
      jsonb_build_object('kind', 'lineup', 'review_id', NEW.id, 'players_before', jsonb_array_length(v_before), 'players_after', jsonb_array_length(v_after)));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_replay_reviews_record_participations ON public.match_replay_reviews;
CREATE TRIGGER match_replay_reviews_record_participations
AFTER UPDATE OF status ON public.match_replay_reviews
FOR EACH ROW EXECUTE FUNCTION public.record_replay_participations();

-- A player with a registered participation keeps his history: he cannot be
-- deleted (same rule as rosters, events and goalkeeper records).
CREATE OR REPLACE FUNCTION public.prevent_deleting_referenced_shared_data()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'teams' AND EXISTS (
    SELECT 1 FROM public.season_teams WHERE team_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Não é possível excluir um time com histórico de temporadas'
      USING ERRCODE = '23503';
  ELSIF TG_TABLE_NAME = 'players' AND (
    EXISTS (SELECT 1 FROM public.rosters WHERE player_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.match_events WHERE player_id = OLD.id OR related_player_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.goalkeeper_participations WHERE player_id = OLD.id)
    OR EXISTS (SELECT 1 FROM public.match_participations WHERE player_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'Não é possível excluir um jogador com histórico de elenco ou partidas'
      USING ERRCODE = '23503';
  ELSIF TG_TABLE_NAME = 'streamers' AND EXISTS (
    SELECT 1 FROM public.match_streamers WHERE streamer_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Não é possível excluir um streamer vinculado ao histórico de partidas'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END;
$$;
