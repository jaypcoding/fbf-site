/*
# MVP of the match (formula approved by the FBF on 2026-11-23)

Nothing is stored about the result: views over the official data, so a
corrected sheet, a reprocessed recording or a new lineup changes the MVP
immediately and there is never an outdated MVP.

Formula (per player per match):
  goal +3 (own goals never count as goals) · valid assist +2 ·
  +1 per complete 2-minute block in goal without conceding (each goal conceded
  interrupts the period) · win +2 · own goal −3.
Rules:
  - candidates are the proven participants (lineup, official goals/assists or
    goalkeeper records: player_match_participation); the win bonus goes to the
    proven participants of the winning side;
  - the result is the regulation score: a decision on penalties is a draw;
  - shared MVP when several players have the highest positive total; no MVP
    when nobody has a positive total;
  - only matches whose result comes from the events (as in the official
    player statistics);
  - status of each match (decided by the FBF on 2026-11-23):
      WALKOVER        W.O. officially identified by an organizer: no MVP,
                      even with a lineup;
      PENDING_REVIEW  a goal without author and no review yet: the MVP waits
                      until an organizer reviews the match;
      NORMAL          complete events, or a goal without author reviewed as
                      a legitimate match (that goal gives nobody points);
  - a goal conceded with unknown minute makes it impossible to split the
    goalkeeper's period: no goalkeeper points for that team in that match
    (shown as keeper_time_unknown).

Access (decided by the FBF on 2026-11-23): the MVP result is NOT public while
the feature is off. The MVP views are closed to visitors; the only doors are
the functions match_mvp and mvp_results, which answer visitors only when the
switch feature_flags.mvp_public is on (admins turn it on with
set_feature_flag, with history). While it is off, admins can preview any match
and organizers only the matches of the competitions they organize
(can_manage_match), to review them; other organizers see nothing. General goalkeeper statistics
(match_keeper_spells, player_match_keeping) stay public and do not depend on
the switch.

Objects:
  - match_keeper_spells (public): every goalkeeper spell with its time, goals
    conceded and complete clean blocks;
  - player_match_keeping (public): goalkeeper time and goals conceded per
    player per official match (goalkeeper rankings);
  - feature_flags + feature_flag_changes, set_feature_flag, mvp_enabled;
  - match_mvp_reviews + review_match_mvp: W.O. or reviewed goal without author;
  - match_mvp_state (closed): MVP status of every official match;
  - match_mvp_scores (closed): breakdown of every candidate and the MVP flag;
  - match_mvp(match) and mvp_results(player): the doors described above.
*/

CREATE OR REPLACE VIEW public.match_keeper_spells
WITH (security_invoker = true) AS
WITH spells AS (
  SELECT gp.id AS spell_id, gp.match_id, gp.player_id, gp.team_id AS season_team_id,
    GREATEST(gp.started_at_seconds, 0) AS start_seconds,
    GREATEST(GREATEST(gp.started_at_seconds, 0), COALESCE(gp.ended_at_seconds, m.duration_seconds, gp.started_at_seconds)) AS end_seconds
  FROM public.goalkeeper_participations gp
  JOIN public.matches m ON m.id = gp.match_id
  WHERE m.status = 'FINISHED'
), conceded AS (
  -- goals that count against the keeper's team: a goal of the opponent or an
  -- own goal of his own team (penalty shootouts excluded)
  SELECT sp.spell_id, g.minute_seconds AS t,
    (COALESCE((g.metadata->>'minute_unknown')::boolean, false) OR g.minute_seconds = 0) AS unknown_time
  FROM spells sp
  JOIN public.match_events g ON g.match_id = sp.match_id AND g.event_type = 'GOAL' AND g.period <> 'PENALTY_SHOOTOUT'
    AND ((g.team_id <> sp.season_team_id AND NOT g.is_own_goal) OR (g.team_id = sp.season_team_id AND g.is_own_goal))
), in_spell AS (
  SELECT c.spell_id, c.t
  FROM conceded c JOIN spells sp ON sp.spell_id = c.spell_id
  WHERE NOT c.unknown_time AND c.t > sp.start_seconds AND c.t <= sp.end_seconds
), cuts AS (
  SELECT spell_id, t FROM in_spell
  UNION ALL
  SELECT spell_id, end_seconds FROM spells
), intervals AS (
  SELECT c.spell_id, c.t - lag(c.t, 1, sp.start_seconds) OVER (PARTITION BY c.spell_id ORDER BY c.t) AS len
  FROM cuts c JOIN spells sp ON sp.spell_id = c.spell_id
)
SELECT sp.spell_id, sp.match_id, sp.player_id, sp.season_team_id, sp.start_seconds, sp.end_seconds,
  (sp.end_seconds - sp.start_seconds) AS keeper_seconds,
  (SELECT count(*) FROM in_spell i WHERE i.spell_id = sp.spell_id)::integer AS goals_conceded,
  EXISTS (SELECT 1 FROM conceded c WHERE c.spell_id = sp.spell_id AND c.unknown_time) AS time_unknown,
  CASE WHEN EXISTS (SELECT 1 FROM conceded c WHERE c.spell_id = sp.spell_id AND c.unknown_time) THEN 0
    ELSE COALESCE((SELECT sum(floor(GREATEST(iv.len, 0) / 120.0)) FROM intervals iv WHERE iv.spell_id = sp.spell_id), 0)
  END::integer AS clean_blocks
FROM spells sp;

COMMENT ON VIEW public.match_keeper_spells IS 'Goalkeeper spells of finished matches: time in goal, goals conceded and complete 2-minute clean blocks (MVP formula).';


-- General goalkeeper statistics per official match (public, independent of the MVP).
CREATE OR REPLACE VIEW public.player_match_keeping
WITH (security_invoker = true) AS
SELECT s.match_id, s.player_id, s.season_team_id, s.team_id, s.competition_id, s.season_id,
  sum(k.keeper_seconds)::integer AS keeper_seconds,
  sum(k.goals_conceded)::integer AS goals_conceded,
  bool_or(k.time_unknown) AS time_unknown
FROM public.player_match_stats s
JOIN public.match_keeper_spells k ON k.match_id = s.match_id AND k.player_id = s.player_id
GROUP BY s.match_id, s.player_id, s.season_team_id, s.team_id, s.competition_id, s.season_id;

GRANT SELECT ON public.match_keeper_spells, public.player_match_keeping TO anon, authenticated;

-- Activation switches. Readable by everyone (whether a feature is on is not a
-- secret); changed only by admins through set_feature_flag, with history.
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feature_flags_public_select ON public.feature_flags;
CREATE POLICY feature_flags_public_select ON public.feature_flags FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.feature_flags FROM anon, authenticated;
GRANT SELECT ON public.feature_flags TO anon, authenticated;

CREATE TABLE IF NOT EXISTS public.feature_flag_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key text NOT NULL REFERENCES public.feature_flags(key) ON DELETE RESTRICT,
  enabled boolean NOT NULL,
  reason text NOT NULL,
  actor uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.feature_flag_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feature_flag_changes_admin_select ON public.feature_flag_changes;
CREATE POLICY feature_flag_changes_admin_select ON public.feature_flag_changes FOR SELECT TO authenticated USING (public.is_fbf_admin());
REVOKE ALL ON public.feature_flag_changes FROM anon, authenticated;
GRANT SELECT ON public.feature_flag_changes TO authenticated;

-- the MVP starts OFF; turning it on is a decision of the FBF
INSERT INTO public.feature_flags (key, enabled) VALUES ('mvp_public', false) ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_feature_flag(p_key text, p_enabled boolean, p_reason text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem ativar ou desativar recursos' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da alteração' USING ERRCODE = '22023';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'Informe se o recurso fica ativo ou não' USING ERRCODE = '22023';
  END IF;
  UPDATE public.feature_flags SET enabled = p_enabled, updated_by = auth.uid(), updated_at = now() WHERE key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recurso desconhecido' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.feature_flag_changes (key, enabled, reason, actor) VALUES (p_key, p_enabled, btrim(p_reason), auth.uid());
  RETURN p_enabled;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_feature_flag(text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_feature_flag(text, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.mvp_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT enabled FROM public.feature_flags WHERE key = 'mvp_public'), false);
$$;
REVOKE EXECUTE ON FUNCTION public.mvp_enabled() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mvp_enabled() TO anon, authenticated;

-- Review of a match for the MVP: W.O. officially identified, or a goal
-- without author reviewed as a legitimate match. One decision per match;
-- every change goes to match_edit_history (kind mvp_review).
CREATE TABLE IF NOT EXISTS public.match_mvp_reviews (
  match_id uuid PRIMARY KEY REFERENCES public.matches(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('WALKOVER', 'VALID')),
  reason text NOT NULL,
  decided_by uuid,
  decided_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.match_mvp_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS match_mvp_reviews_manager_select ON public.match_mvp_reviews;
CREATE POLICY match_mvp_reviews_manager_select ON public.match_mvp_reviews FOR SELECT TO authenticated USING (public.can_manage_match(match_id));
REVOKE ALL ON public.match_mvp_reviews FROM anon, authenticated;
GRANT SELECT ON public.match_mvp_reviews TO authenticated;

CREATE OR REPLACE FUNCTION public.review_match_mvp(p_match_id uuid, p_decision text, p_reason text)
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
  v_history_id bigint;
BEGIN
  -- permission first: without it, nobody learns whether the match exists nor locks it
  IF NOT COALESCE(public.can_manage_match(p_match_id), false) THEN
    RAISE EXCEPTION 'Sem permissão para editar esta partida' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Partida não encontrada' USING ERRCODE = 'P0002'; END IF;
  IF v_match.status <> 'FINISHED' THEN
    RAISE EXCEPTION 'A revisão do MVP só é feita em partidas finalizadas' USING ERRCODE = '23514';
  END IF;
  SELECT c.status INTO v_competition_status
  FROM public.rounds r JOIN public.stages stg ON stg.id = r.stage_id
  JOIN public.seasons s ON s.id = stg.season_id JOIN public.competitions c ON c.id = s.competition_id
  WHERE r.id = v_match.round_id;
  IF v_competition_status NOT IN ('UPCOMING', 'REGISTRATION', 'ACTIVE') AND NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Partidas de competições encerradas só podem ser editadas por administradores' USING ERRCODE = '42501';
  END IF;
  IF p_decision IS NOT NULL AND p_decision NOT IN ('WALKOVER', 'VALID') THEN
    RAISE EXCEPTION 'Decisão inválida' USING ERRCODE = '22023';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo da alteração' USING ERRCODE = '22023';
  END IF;
  -- "legitimate match" only makes sense where a goal has no author
  IF p_decision = 'VALID' AND NOT EXISTS (
    SELECT 1 FROM public.match_events WHERE match_id = p_match_id AND event_type = 'GOAL' AND player_id IS NULL AND period <> 'PENALTY_SHOOTOUT'
  ) THEN
    RAISE EXCEPTION 'Esta partida não tem gol sem autor para revisar' USING ERRCODE = '23514';
  END IF;

  SELECT jsonb_build_object('decision', decision, 'reason', reason) INTO v_before FROM public.match_mvp_reviews WHERE match_id = p_match_id;
  IF p_decision IS NULL THEN
    DELETE FROM public.match_mvp_reviews WHERE match_id = p_match_id;
  ELSE
    INSERT INTO public.match_mvp_reviews (match_id, decision, reason, decided_by, decided_at)
    VALUES (p_match_id, p_decision, btrim(p_reason), auth.uid(), now())
    ON CONFLICT (match_id) DO UPDATE SET decision = EXCLUDED.decision, reason = EXCLUDED.reason, decided_by = EXCLUDED.decided_by, decided_at = EXCLUDED.decided_at;
  END IF;
  SELECT jsonb_build_object('decision', decision, 'reason', reason) INTO v_after FROM public.match_mvp_reviews WHERE match_id = p_match_id;

  IF (v_before->>'decision') IS DISTINCT FROM (v_after->>'decision') THEN
    INSERT INTO public.match_edit_history (match_id, actor, source, reason, before, after, changes)
    VALUES (p_match_id, auth.uid(), 'MANUAL', btrim(p_reason),
      jsonb_build_object('mvp_review', v_before), jsonb_build_object('mvp_review', v_after),
      jsonb_build_object('kind', 'mvp_review', 'decision_before', v_before->>'decision', 'decision_after', v_after->>'decision'))
    RETURNING id INTO v_history_id;
  END IF;
  RETURN jsonb_build_object('decision', v_after->>'decision', 'history_id', v_history_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.review_match_mvp(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_match_mvp(uuid, text, text) TO authenticated;

-- MVP status of every official match (closed: read through match_mvp).
CREATE OR REPLACE VIEW public.match_mvp_state
WITH (security_invoker = true) AS
WITH authorless AS (
  SELECT e.match_id, count(*)::integer AS n
  FROM public.match_events e
  WHERE e.event_type = 'GOAL' AND e.player_id IS NULL AND e.period <> 'PENALTY_SHOOTOUT'
  GROUP BY e.match_id
)
SELECT m.id AS match_id,
  COALESCE(a.n, 0) AS goals_without_author,
  rv.decision AS review_decision,
  CASE
    WHEN rv.decision = 'WALKOVER' THEN 'WALKOVER'
    WHEN COALESCE(a.n, 0) > 0 AND rv.decision IS DISTINCT FROM 'VALID' THEN 'PENDING_REVIEW'
    ELSE 'NORMAL'
  END AS mvp_status
FROM public.matches m
LEFT JOIN authorless a ON a.match_id = m.id
LEFT JOIN public.match_mvp_reviews rv ON rv.match_id = m.id
WHERE m.status = 'FINISHED' AND m.score_source = 'EVENTS' AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL;

CREATE OR REPLACE VIEW public.match_mvp_scores
WITH (security_invoker = true) AS
WITH keeper AS (
  SELECT match_id, player_id, sum(keeper_seconds)::integer AS keeper_seconds, sum(clean_blocks)::integer AS keeper_blocks,
    sum(goals_conceded)::integer AS keeper_goals_conceded, bool_or(time_unknown) AS keeper_time_unknown
  FROM public.match_keeper_spells
  GROUP BY match_id, player_id
), base AS (
  SELECT s.match_id, s.player_id, s.season_team_id, s.team_id, s.competition_id, s.season_id, s.side, s.result,
    s.in_lineup, s.has_events, s.was_goalkeeper, s.goals, s.assists, s.own_goals,
    COALESCE(k.keeper_seconds, 0) AS keeper_seconds, COALESCE(k.keeper_blocks, 0) AS keeper_blocks,
    COALESCE(k.keeper_goals_conceded, 0) AS keeper_goals_conceded, COALESCE(k.keeper_time_unknown, false) AS keeper_time_unknown,
    (s.result = 'W') AS won,
    st.mvp_status
  FROM public.player_match_stats s
  JOIN public.match_mvp_state st ON st.match_id = s.match_id
  LEFT JOIN keeper k ON k.match_id = s.match_id AND k.player_id = s.player_id
), scored AS (
  SELECT b.*,
    b.goals * 3 AS points_goals,
    b.assists * 2 AS points_assists,
    b.keeper_blocks AS points_keeper,
    CASE WHEN b.won THEN 2 ELSE 0 END AS points_win,
    b.own_goals * -3 AS points_own_goals,
    b.goals * 3 + b.assists * 2 + b.keeper_blocks + CASE WHEN b.won THEN 2 ELSE 0 END - b.own_goals * 3 AS total
  FROM base b
), ranked AS (
  SELECT sc.*, max(sc.total) OVER (PARTITION BY sc.match_id) AS top_total FROM scored sc
)
SELECT r.*,
  (r.mvp_status = 'NORMAL' AND r.top_total > 0 AND r.total = r.top_total) AS is_mvp,
  count(*) FILTER (WHERE r.mvp_status = 'NORMAL' AND r.top_total > 0 AND r.total = r.top_total) OVER (PARTITION BY r.match_id)::integer AS mvp_count
FROM ranked r;

COMMENT ON VIEW public.match_mvp_scores IS 'MVP formula approved on 2026-11-23: breakdown per candidate (proven participant), total and MVP flag (shared on ties; none when the best total is not positive, the match is a W.O. or a goal without author awaits review). Closed to visitors: read through match_mvp / mvp_results.';

-- the MVP result is closed: only the functions below read it
REVOKE ALL ON public.match_mvp_state, public.match_mvp_scores FROM PUBLIC, anon, authenticated;

-- same visibility rule as the public policies: not a draft, or a manager
CREATE OR REPLACE FUNCTION public._mvp_match_visible(p_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matches m
    JOIN public.rounds r ON r.id = m.round_id JOIN public.stages stg ON stg.id = r.stage_id
    JOIN public.seasons s ON s.id = stg.season_id JOIN public.competitions c ON c.id = s.competition_id
    WHERE m.id = p_match_id AND (c.status <> 'DRAFT' OR COALESCE(public.can_manage_match(p_match_id), false))
  );
$$;
REVOKE EXECUTE ON FUNCTION public._mvp_match_visible(uuid) FROM PUBLIC, anon, authenticated;

/* MVP of one match, as jsonb {enabled, preview, status, goals_without_author, review, rows}.
   - visitors: only {"enabled": false} while the switch is off; with it on,
     the breakdown only when the status is NORMAL;
   - admins, and organizers of THIS match's competition: always the full
     breakdown (a preview while it is off); any other organizer is a visitor here. */
CREATE OR REPLACE FUNCTION public.match_mvp(p_match_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enabled boolean := public.mvp_enabled();
  v_manager boolean := COALESCE(public.can_manage_match(p_match_id), false);
  v_state record;
  v_rows jsonb;
BEGIN
  IF NOT public._mvp_match_visible(p_match_id) THEN RETURN NULL; END IF;
  IF NOT v_enabled AND NOT v_manager THEN RETURN jsonb_build_object('enabled', false); END IF;
  SELECT * INTO v_state FROM public.match_mvp_state WHERE match_id = p_match_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', v_enabled, 'preview', NOT v_enabled, 'status', 'UNAVAILABLE', 'rows', '[]'::jsonb);
  END IF;
  IF v_state.mvp_status = 'NORMAL' OR v_manager THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(s) - 'competition_id' - 'season_id' ORDER BY s.total DESC, s.player_id), '[]'::jsonb) INTO v_rows
    FROM public.match_mvp_scores s WHERE s.match_id = p_match_id;
  ELSE
    v_rows := '[]'::jsonb;
  END IF;
  RETURN jsonb_build_object('enabled', v_enabled, 'preview', NOT v_enabled, 'status', v_state.mvp_status,
    'goals_without_author', v_state.goals_without_author, 'review', v_state.review_decision, 'rows', v_rows);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.match_mvp(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_mvp(uuid) TO anon, authenticated;

-- MVP awards (winners only) for profiles and rankings. Empty for everyone
-- while the switch is off: those pages never preview.
CREATE OR REPLACE FUNCTION public.mvp_results(p_player_id uuid DEFAULT NULL)
RETURNS TABLE (match_id uuid, player_id uuid, competition_id uuid, season_id uuid, team_id uuid, total integer, mvp_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.match_id, s.player_id, s.competition_id, s.season_id, s.team_id, s.total, s.mvp_count
  FROM public.match_mvp_scores s
  JOIN public.competitions c ON c.id = s.competition_id
  WHERE public.mvp_enabled() AND s.is_mvp
    AND (p_player_id IS NULL OR s.player_id = p_player_id)
    AND c.status <> 'DRAFT';
$$;
REVOKE EXECUTE ON FUNCTION public.mvp_results(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mvp_results(uuid) TO anon, authenticated;
