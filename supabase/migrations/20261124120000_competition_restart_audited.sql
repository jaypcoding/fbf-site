/*
# Audited restart of a competition with protected history

The safe competition reset (20261121130000) keeps working as it is for
competitions without history. A competition with protected history (lineups,
replay sheets, match edits, MVP reviews, Hall da Fama records) stays BLOCKED
for that reset: this migration only makes the block explicit in the preview
(code HAS_HISTORY), instead of a foreign key error at the end.

When the FBF really needs to correct or restart such a competition, there is
one specific administrative procedure:

  competition_restart_preview(id)
      what would be archived and removed, the blockers, the confirmation text
      and a fingerprint;
  restart_competition_audited(id, confirmation, fingerprint, reason)
      only an ADMIN; the caller types "REINICIAR <competition name>", sends the
      preview fingerprint (recomputed under lock) and a reason of at least 20
      characters. In ONE transaction it:
        1. copies every history row of the competition to
           competition_restart_archive (append-only; never deleted);
        2. removes those history rows (their protection triggers are switched
           off only inside this transaction, only for these rows);
        3. runs the same safe reset as before (deletion_log with every row,
           teams/players/streamers/profiles verified unchanged).
      Anything unexpected aborts the whole transaction: nothing is removed.

Refused (blockers): a LIVE match, a match of another competition depending on
this one, and PUBLISHED Hall da Fama records (they must be unpublished first,
with their own reason, so a public title never disappears silently).

Nothing is lost: restore_competition_restart(archive_id) brings everything back
(owner only, never exposed to the API, same rule as restore_deleted_records).
Replay files in storage are never touched. The Hall da Fama history
(hall_of_fame_changes) is never removed.
*/

-- ------------------------------------------------------------- archive
CREATE TABLE IF NOT EXISTS public.competition_restart_archive (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL,
  competition_name text NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) >= 20),
  confirmation text NOT NULL,
  fingerprint text NOT NULL,
  history_counts jsonb NOT NULL,
  history jsonb NOT NULL,
  reset_result jsonb NOT NULL,
  created_by uuid,
  created_by_role text,
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  restored_by text
);
CREATE INDEX IF NOT EXISTS competition_restart_archive_competition_idx ON public.competition_restart_archive(competition_id, created_at);
ALTER TABLE public.competition_restart_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS competition_restart_archive_admin_select ON public.competition_restart_archive;
CREATE POLICY competition_restart_archive_admin_select ON public.competition_restart_archive FOR SELECT TO authenticated USING (public.is_fbf_admin());
REVOKE ALL ON public.competition_restart_archive FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.competition_restart_archive TO authenticated;

-- append-only: never deleted; the only change is marking it restored, once
CREATE OR REPLACE FUNCTION public.protect_competition_restart_archive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'O arquivo de reinícios não pode ser apagado' USING ERRCODE = '55000';
  END IF;
  IF OLD.restored_at IS NOT NULL OR NEW.restored_at IS NULL
     OR (to_jsonb(NEW) - 'restored_at' - 'restored_by') IS DISTINCT FROM (to_jsonb(OLD) - 'restored_at' - 'restored_by') THEN
    RAISE EXCEPTION 'O arquivo de reinícios não pode ser alterado' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS competition_restart_archive_protect ON public.competition_restart_archive;
CREATE TRIGGER competition_restart_archive_protect BEFORE UPDATE OR DELETE ON public.competition_restart_archive
FOR EACH ROW EXECUTE FUNCTION public.protect_competition_restart_archive();

-- ------------------------------------------------- history of a competition
-- Every protected history row of the selected competitions, by table (the
-- order is the one a restore inserts them). player_aliases is kept only to
-- restore its link to the match (it is not deleted: the link becomes NULL).
CREATE OR REPLACE FUNCTION public._competition_history(p_competition_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seasons uuid[];
  v_season_teams uuid[];
  v_matches uuid[];
  v_reviews uuid[];
  v_replays uuid[];
BEGIN
  v_seasons := ARRAY(SELECT id FROM public.seasons WHERE competition_id = ANY (p_competition_ids));
  v_season_teams := ARRAY(SELECT id FROM public.season_teams WHERE season_id = ANY (v_seasons));
  v_matches := ARRAY(SELECT m.id FROM public.matches m JOIN public.rounds r ON r.id = m.round_id JOIN public.stages s ON s.id = r.stage_id
                     WHERE s.season_id = ANY (v_seasons));
  v_reviews := ARRAY(SELECT id FROM public.match_replay_reviews WHERE match_id = ANY (v_matches));
  v_replays := ARRAY(SELECT id FROM public.match_replays WHERE match_id = ANY (v_matches));
  RETURN jsonb_build_object(
    'match_replays', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.match_replays x WHERE x.id = ANY (v_replays)), '[]'),
    'match_replay_reviews', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.match_replay_reviews x WHERE x.id = ANY (v_reviews)), '[]'),
    'match_replay_reports', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.match_id) FROM public.match_replay_reports x
      WHERE x.match_id = ANY (v_matches) OR x.review_id = ANY (v_reviews)), '[]'),
    'match_replay_audit', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.match_replay_audit x
      WHERE x.match_id = ANY (v_matches) OR x.review_id = ANY (v_reviews) OR x.replay_id = ANY (v_replays)), '[]'),
    'match_edit_history', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.match_edit_history x WHERE x.match_id = ANY (v_matches)), '[]'),
    'match_participations', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.match_id, x.player_id) FROM public.match_participations x
      WHERE x.match_id = ANY (v_matches) OR x.season_team_id = ANY (v_season_teams) OR x.review_id = ANY (v_reviews)), '[]'),
    'match_mvp_reviews', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.match_id) FROM public.match_mvp_reviews x WHERE x.match_id = ANY (v_matches)), '[]'),
    'season_honours', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.season_honours x
      WHERE x.season_id = ANY (v_seasons) OR x.season_team_id = ANY (v_season_teams)), '[]'),
    'player_aliases', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'source_match_id', x.source_match_id) ORDER BY x.id)
      FROM public.player_aliases x WHERE x.source_match_id = ANY (v_matches)), '[]')
  );
END;
$$;
REVOKE ALL ON FUNCTION public._competition_history(uuid[]) FROM PUBLIC, anon, authenticated;

-- counts of the protected history (player_aliases is not protected history)
CREATE OR REPLACE FUNCTION public._history_counts(p_history jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_object_agg(key, jsonb_array_length(value)), '{}'::jsonb)
  FROM jsonb_each(p_history) WHERE key <> 'player_aliases';
$$;
REVOKE ALL ON FUNCTION public._history_counts(jsonb) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------- the plan
-- Same plan as 20261121130000, plus the HAS_HISTORY blocker. The old
-- two-argument version is replaced (callers use the defaults).
DROP FUNCTION IF EXISTS public._reset_plan(uuid[], boolean);
CREATE OR REPLACE FUNCTION public._reset_plan(p_competition_ids uuid[], p_lock boolean DEFAULT false, p_ignore_history boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  v_id uuid;
  v_comp public.competitions%ROWTYPE;
  v_seasons uuid[];
  v_stages uuid[];
  v_rounds uuid[];
  v_matches uuid[];
  v_season_teams uuid[];
  v_all_matches uuid[] := '{}';
  v_all_season_teams uuid[] := '{}';
  v_counts jsonb;
  v_items jsonb := '[]'::jsonb;
  v_totals jsonb := '{}'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_key text;
  v_n bigint;
  v_fp text := '';
  v_history_counts jsonb;
BEGIN
  IF NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem executar o reset de competições' USING ERRCODE = '42501';
  END IF;
  IF p_competition_ids IS NULL OR cardinality(p_competition_ids) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos uma competição' USING ERRCODE = '22023';
  END IF;
  IF array_position(p_competition_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Seleção de competições inválida' USING ERRCODE = '22023';
  END IF;
  v_ids := ARRAY(SELECT DISTINCT x FROM unnest(p_competition_ids) AS x ORDER BY x);
  IF cardinality(v_ids) <> cardinality(p_competition_ids) THEN
    RAISE EXCEPTION 'A mesma competição foi selecionada mais de uma vez' USING ERRCODE = '22023';
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    IF p_lock THEN
      SELECT * INTO v_comp FROM public.competitions WHERE id = v_id FOR UPDATE;
    ELSE
      SELECT * INTO v_comp FROM public.competitions WHERE id = v_id;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Competição não encontrada: %', v_id USING ERRCODE = 'P0002';
    END IF;

    v_seasons := ARRAY(SELECT id FROM public.seasons WHERE competition_id = v_id ORDER BY id);
    v_stages := ARRAY(SELECT id FROM public.stages WHERE season_id = ANY (v_seasons) ORDER BY id);
    v_rounds := ARRAY(SELECT id FROM public.rounds WHERE stage_id = ANY (v_stages) ORDER BY id);
    IF p_lock THEN
      PERFORM 1 FROM public.seasons WHERE id = ANY (v_seasons) FOR UPDATE;
      PERFORM 1 FROM public.stages WHERE id = ANY (v_stages) FOR UPDATE;
      PERFORM 1 FROM public.rounds WHERE id = ANY (v_rounds) FOR UPDATE;
    END IF;
    v_matches := ARRAY(SELECT id FROM public.matches WHERE round_id = ANY (v_rounds) ORDER BY id);
    v_season_teams := ARRAY(SELECT id FROM public.season_teams WHERE season_id = ANY (v_seasons) ORDER BY id);
    IF p_lock THEN
      PERFORM 1 FROM public.matches WHERE id = ANY (v_matches) FOR UPDATE;
      PERFORM 1 FROM public.season_teams WHERE id = ANY (v_season_teams) FOR UPDATE;
    END IF;

    v_counts := jsonb_build_object(
      'competitions', 1,
      'competition_organizers', (SELECT count(*) FROM public.competition_organizers WHERE competition_id = v_id),
      'seasons', cardinality(v_seasons),
      'season_teams', cardinality(v_season_teams),
      'team_registrations', (SELECT count(*) FROM public.team_registrations WHERE season_id = ANY (v_seasons)),
      'rosters', (SELECT count(*) FROM public.rosters WHERE season_team_id = ANY (v_season_teams)),
      'stages', cardinality(v_stages),
      'stage_groups', (SELECT count(*) FROM public.stage_groups WHERE stage_id = ANY (v_stages)),
      'stage_group_teams', (SELECT count(*) FROM public.stage_group_teams WHERE stage_id = ANY (v_stages)),
      'rounds', cardinality(v_rounds),
      'matches', cardinality(v_matches),
      'match_status_history', (SELECT count(*) FROM public.match_status_history WHERE match_id = ANY (v_matches)),
      'match_events', (SELECT count(*) FROM public.match_events WHERE match_id = ANY (v_matches)),
      'goalkeeper_participations', (SELECT count(*) FROM public.goalkeeper_participations WHERE match_id = ANY (v_matches)),
      'match_streamers', (SELECT count(*) FROM public.match_streamers WHERE match_id = ANY (v_matches)),
      'round_robin_pair_claims', (SELECT count(*) FROM public.round_robin_pair_claims
        WHERE match_id = ANY (v_matches) OR stage_id = ANY (v_stages))
    );

    v_items := v_items || jsonb_build_object(
      'id', v_comp.id, 'name', v_comp.name, 'category', v_comp.category, 'status', v_comp.status,
      'finished_matches', (SELECT count(*) FROM public.matches WHERE id = ANY (v_matches) AND status = 'FINISHED'),
      'counts', v_counts,
      'ids', jsonb_build_object('seasons', to_jsonb(v_seasons), 'stages', to_jsonb(v_stages), 'rounds', to_jsonb(v_rounds),
        'matches', to_jsonb(v_matches), 'season_teams', to_jsonb(v_season_teams)));

    FOR v_key IN SELECT jsonb_object_keys(v_counts) LOOP
      v_totals := v_totals || jsonb_build_object(v_key, COALESCE((v_totals->>v_key)::bigint, 0) + (v_counts->>v_key)::bigint);
    END LOOP;
    v_all_matches := v_all_matches || v_matches;
    v_all_season_teams := v_all_season_teams || v_season_teams;

    -- Fingerprint: ids of every row and the state that matters.
    v_fp := v_fp || '#' || concat_ws('|',
      v_comp.id, v_comp.name, v_comp.status,
      array_to_string(v_seasons, ','), array_to_string(v_stages, ','), array_to_string(v_rounds, ','),
      array_to_string(v_season_teams, ','),
      (SELECT string_agg(concat_ws(':', id, status, home_score, away_score, duration_seconds), ',' ORDER BY id)
        FROM public.matches WHERE id = ANY (v_matches)),
      (SELECT string_agg(user_id::text, ',' ORDER BY user_id) FROM public.competition_organizers WHERE competition_id = v_id),
      (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.team_registrations WHERE season_id = ANY (v_seasons)),
      (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.rosters WHERE season_team_id = ANY (v_season_teams)),
      (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.stage_groups WHERE stage_id = ANY (v_stages)),
      (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.stage_group_teams WHERE stage_id = ANY (v_stages)),
      (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.match_status_history WHERE match_id = ANY (v_matches)),
      (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.match_events WHERE match_id = ANY (v_matches)),
      (SELECT string_agg(concat_ws(':', id, ended_at_seconds), ',' ORDER BY id) FROM public.goalkeeper_participations WHERE match_id = ANY (v_matches)),
      (SELECT string_agg(concat_ws(':', match_id, streamer_id), ',' ORDER BY match_id, streamer_id) FROM public.match_streamers WHERE match_id = ANY (v_matches)),
      (SELECT string_agg(concat_ws(':', stage_id, leg_number, team_low_id, team_high_id, match_id), ','
          ORDER BY stage_id, leg_number, team_low_id, team_high_id)
        FROM public.round_robin_pair_claims WHERE match_id = ANY (v_matches) OR stage_id = ANY (v_stages))
    );
  END LOOP;

  SELECT count(*) INTO v_n FROM public.matches WHERE id = ANY (v_all_matches) AND status = 'LIVE';
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'MATCH_LIVE', 'count', v_n,
      'message', format('%s partida(s) ao vivo; finalize ou cancele antes do reset', v_n));
  END IF;
  SELECT count(*) INTO v_n FROM public.matches
  WHERE NOT (id = ANY (v_all_matches))
    AND (home_source_match_id = ANY (v_all_matches) OR away_source_match_id = ANY (v_all_matches)
      OR home_team_id = ANY (v_all_season_teams) OR away_team_id = ANY (v_all_season_teams));
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'REFERENCED_ELSEWHERE', 'count', v_n,
      'message', format('%s partida(s) de competições não selecionadas dependem das selecionadas', v_n));
  END IF;

  -- Protected history (lineups, replay sheets, match edits, MVP reviews, Hall
  -- da Fama): this reset never removes it. Only the audited restart does,
  -- after archiving it (p_ignore_history is used only by that procedure).
  IF NOT p_ignore_history THEN
    v_history_counts := public._history_counts(public._competition_history(v_ids));
    SELECT COALESCE(sum(value::bigint), 0) INTO v_n FROM jsonb_each_text(v_history_counts);
    IF v_n > 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code', 'HAS_HISTORY', 'count', v_n, 'details', v_history_counts,
        'message', format('%s registro(s) de histórico protegido (escalações, súmulas por gravação, edições, revisões de MVP ou Hall da Fama); para corrigir ou reiniciar, use o reinício auditado', v_n));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'competitions', v_items,
    'totals', v_totals,
    'blockers', v_blockers,
    'can_reset', jsonb_array_length(v_blockers) = 0,
    'confirmation', format('RESETAR %s COMPETIÇÕES', cardinality(v_ids)),
    'preserved', public._reset_preserved_state(),
    'fingerprint', md5(v_fp)
  );
END;
$$;
REVOKE ALL ON FUNCTION public._reset_plan(uuid[], boolean, boolean) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------- preview
CREATE OR REPLACE FUNCTION public.competition_restart_preview(p_competition_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comp public.competitions%ROWTYPE;
  v_history jsonb;
  v_counts jsonb;
  v_plan jsonb;
  v_blockers jsonb;
  v_n bigint;
BEGIN
  IF NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem reiniciar competições com histórico' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_comp FROM public.competitions WHERE id = p_competition_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Competição não encontrada' USING ERRCODE = 'P0002'; END IF;
  v_history := public._competition_history(ARRAY[p_competition_id]);
  v_counts := public._history_counts(v_history);
  -- the reset plan without the history blocker (the history is archived first)
  v_plan := public._reset_plan(ARRAY[p_competition_id], false, true);
  v_blockers := v_plan->'blockers';
  SELECT count(*) INTO v_n FROM jsonb_array_elements(v_history->'season_honours') h WHERE h->>'status' = 'PUBLISHED';
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'PUBLISHED_HONOURS', 'count', v_n,
      'message', format('%s registro(s) publicado(s) no Hall da Fama; despublique-os antes, com o motivo', v_n));
  END IF;
  RETURN jsonb_build_object(
    'competition', jsonb_build_object('id', v_comp.id, 'name', v_comp.name, 'status', v_comp.status, 'category', v_comp.category),
    'history', v_counts,
    'history_total', (SELECT COALESCE(sum(value::bigint), 0) FROM jsonb_each_text(v_counts)),
    'aliases_relinked', jsonb_array_length(v_history->'player_aliases'),
    'reset', v_plan->'totals',
    'blockers', v_blockers,
    'can_restart', jsonb_array_length(v_blockers) = 0,
    'confirmation', format('REINICIAR %s', v_comp.name),
    'fingerprint', md5((v_plan->>'fingerprint') || '#' || md5(v_history::text))
  );
END;
$$;
REVOKE ALL ON FUNCTION public.competition_restart_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.competition_restart_preview(uuid) TO authenticated;

-- ------------------------------------------------------------- restart
CREATE OR REPLACE FUNCTION public.restart_competition_audited(
  p_competition_id uuid, p_confirmation text, p_expected_fingerprint text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_preview jsonb;
  v_history jsonb;
  v_counts jsonb;
  v_plan jsonb;
  v_result jsonb;
  v_archive uuid;
  v_n bigint;
  v_table text;
  v_tables text[] := ARRAY['match_participations', 'match_mvp_reviews', 'match_replay_audit', 'match_replay_reports',
    'match_replay_reviews', 'match_replays', 'match_edit_history', 'season_honours'];
  v_guarded text[] := ARRAY['match_participations', 'match_replay_audit', 'match_replay_reports', 'match_replay_reviews',
    'match_replays', 'match_edit_history'];
  v_messages text;
BEGIN
  IF NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem reiniciar competições com histórico' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(COALESCE(p_reason, ''))) < 20 THEN
    RAISE EXCEPTION 'Descreva o motivo do reinício (ao menos 20 caracteres)' USING ERRCODE = '22023';
  END IF;
  -- everything this competition is made of, frozen for the transaction
  PERFORM 1 FROM public.competitions WHERE id = p_competition_id FOR UPDATE;
  PERFORM public._reset_plan(ARRAY[p_competition_id], true, true);
  LOCK TABLE public.match_participations, public.match_mvp_reviews, public.match_replay_audit, public.match_replay_reports,
    public.match_replay_reviews, public.match_replays, public.match_edit_history, public.season_honours IN SHARE ROW EXCLUSIVE MODE;

  v_preview := public.competition_restart_preview(p_competition_id);
  IF NOT (v_preview->>'can_restart')::boolean THEN
    SELECT string_agg(b->>'message', '; ') INTO v_messages FROM jsonb_array_elements(v_preview->'blockers') AS b;
    RAISE EXCEPTION 'Reinício bloqueado: %', v_messages USING ERRCODE = '55000';
  END IF;
  IF p_confirmation IS DISTINCT FROM (v_preview->>'confirmation') THEN
    RAISE EXCEPTION 'Digite exatamente "%" para confirmar', v_preview->>'confirmation' USING ERRCODE = '22023';
  END IF;
  IF p_expected_fingerprint IS DISTINCT FROM (v_preview->>'fingerprint') THEN
    RAISE EXCEPTION 'Os dados mudaram desde a prévia. Abra a prévia novamente antes do reinício.' USING ERRCODE = '22023';
  END IF;

  -- 1. copy of the history (archived at the end, in the same transaction)
  v_history := public._competition_history(ARRAY[p_competition_id]);
  v_counts := public._history_counts(v_history);

  -- 2. remove the history rows, child to parent, each count checked
  FOREACH v_table IN ARRAY v_guarded LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_table);
  END LOOP;
  FOREACH v_table IN ARRAY v_tables LOOP
    CASE v_table
      WHEN 'match_participations' THEN
        DELETE FROM public.match_participations x USING jsonb_array_elements(v_history->'match_participations') r
        WHERE x.match_id = (r->>'match_id')::uuid AND x.player_id = (r->>'player_id')::uuid;
      WHEN 'match_mvp_reviews' THEN
        DELETE FROM public.match_mvp_reviews x USING jsonb_array_elements(v_history->'match_mvp_reviews') r WHERE x.match_id = (r->>'match_id')::uuid;
      WHEN 'match_replay_audit' THEN
        DELETE FROM public.match_replay_audit x USING jsonb_array_elements(v_history->'match_replay_audit') r WHERE x.id = (r->>'id')::bigint;
      WHEN 'match_replay_reports' THEN
        DELETE FROM public.match_replay_reports x USING jsonb_array_elements(v_history->'match_replay_reports') r WHERE x.match_id = (r->>'match_id')::uuid;
      WHEN 'match_replay_reviews' THEN
        DELETE FROM public.match_replay_reviews x USING jsonb_array_elements(v_history->'match_replay_reviews') r WHERE x.id = (r->>'id')::uuid;
      WHEN 'match_replays' THEN
        DELETE FROM public.match_replays x USING jsonb_array_elements(v_history->'match_replays') r WHERE x.id = (r->>'id')::uuid;
      WHEN 'match_edit_history' THEN
        DELETE FROM public.match_edit_history x USING jsonb_array_elements(v_history->'match_edit_history') r WHERE x.id = (r->>'id')::bigint;
      WHEN 'season_honours' THEN
        DELETE FROM public.season_honours x USING jsonb_array_elements(v_history->'season_honours') r WHERE x.id = (r->>'id')::uuid AND x.status = 'DRAFT';
    END CASE;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>v_table)::bigint THEN
      RAISE EXCEPTION 'Contagem divergente ao arquivar % (esperado %, removido %)', v_table, v_counts->>v_table, v_n;
    END IF;
  END LOOP;
  FOREACH v_table IN ARRAY v_guarded LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_table);
  END LOOP;

  -- 3. the same safe reset as for competitions without history
  v_plan := public.reset_competitions_preview(ARRAY[p_competition_id]);
  v_result := public.reset_competitions(ARRAY[p_competition_id], v_plan->>'confirmation', v_plan->>'fingerprint');

  INSERT INTO public.competition_restart_archive (competition_id, competition_name, reason, confirmation, fingerprint,
    history_counts, history, reset_result, created_by, created_by_role)
  VALUES (p_competition_id, v_preview->'competition'->>'name', btrim(p_reason), p_confirmation, p_expected_fingerprint,
    v_counts, v_history, v_result, auth.uid(), (SELECT role FROM public.profiles WHERE id = auth.uid()))
  RETURNING id INTO v_archive;

  RETURN jsonb_build_object('archive_id', v_archive, 'history', v_counts, 'reset', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.restart_competition_audited(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restart_competition_audited(uuid, text, text, text) TO authenticated;

-- ------------------------------------------------------------- restore
-- Owner only (never exposed to the API), like restore_deleted_records:
-- brings back the competition (every deletion_log entry of the reset) and
-- then every history row, and relinks the aliases to their matches.
CREATE OR REPLACE FUNCTION public.restore_competition_restart(p_archive_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_archive public.competition_restart_archive%ROWTYPE;
  v_log jsonb;
  v_table text;
  v_rows jsonb;
  v_n bigint;
  v_restored jsonb := '{}'::jsonb;
  v_order text[] := ARRAY['match_replays', 'match_replay_reviews', 'match_replay_reports', 'match_replay_audit',
    'match_edit_history', 'match_participations', 'match_mvp_reviews', 'season_honours'];
BEGIN
  SELECT * INTO v_archive FROM public.competition_restart_archive WHERE id = p_archive_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reinício não encontrado' USING ERRCODE = 'P0002'; END IF;
  IF v_archive.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este reinício já foi revertido em %', v_archive.restored_at USING ERRCODE = '55000';
  END IF;
  FOR v_log IN SELECT value FROM jsonb_array_elements(v_archive.reset_result->'logs') LOOP
    PERFORM public.restore_deleted_records((v_log->>'log_id')::uuid);
  END LOOP;
  FOREACH v_table IN ARRAY v_order LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_table);
  END LOOP;
  FOREACH v_table IN ARRAY v_order LOOP
    v_rows := COALESCE(v_archive.history->v_table, '[]'::jsonb);
    IF jsonb_array_length(v_rows) > 0 THEN
      EXECUTE format('INSERT INTO public.%1$I OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::public.%1$I, $1)', v_table)
        USING v_rows;
      GET DIAGNOSTICS v_n = ROW_COUNT;
    ELSE
      v_n := 0;
    END IF;
    v_restored := v_restored || jsonb_build_object(v_table, v_n);
  END LOOP;
  FOREACH v_table IN ARRAY v_order LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_table);
  END LOOP;
  IF v_restored IS DISTINCT FROM v_archive.history_counts THEN
    RAISE EXCEPTION 'Quantidades restauradas (%) diferentes das arquivadas (%)', v_restored, v_archive.history_counts;
  END IF;
  UPDATE public.player_aliases a SET source_match_id = (r->>'source_match_id')::uuid
  FROM jsonb_array_elements(v_archive.history->'player_aliases') r
  WHERE a.id = (r->>'id')::uuid AND a.source_match_id IS NULL;
  UPDATE public.competition_restart_archive SET restored_at = now(), restored_by = current_user WHERE id = p_archive_id;
  RETURN v_restored;
END;
$$;
REVOKE ALL ON FUNCTION public.restore_competition_restart(uuid) FROM PUBLIC, anon, authenticated, service_role;
