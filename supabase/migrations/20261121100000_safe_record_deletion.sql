-- Safe deletion of competitions, seasons, stages and rounds.
--
-- Until now these records could be deleted straight from the tables (RLS
-- policies), and the foreign keys silently cascaded into registrations,
-- season teams and rosters, while anything with matches could not be deleted
-- at all (matches and their status history are protected by triggers).
--
-- This migration replaces direct deletes with two functions:
--   deletion_preview(kind, id)       what would be removed, or why it is blocked
--   delete_competition_record(...)   revalidates everything and deletes
-- and an audit table (deletion_log) that keeps a JSON copy of every deleted row,
-- so a deletion can be restored by the database owner with
-- restore_deleted_records(log_id).
--
-- Rules (approved by the owner):
--   * permission: ADMIN for competitions; ADMIN or the competition's ORGANIZER
--     for seasons, stages and rounds (always the real logged-in user);
--   * anything that shows a match was played blocks the deletion everywhere:
--     LIVE/FINISHED status or history, score, duration, retroactive record,
--     events, goalkeepers, streamers, or a match used as a source elsewhere;
--   * never-played matches can only be removed in archived (CANCELLED) or
--     DRAFT competitions;
--   * in published competitions, seasons with teams/registrations and stages
--     or seasons with groups or matches are blocked;
--   * a round is blocked whenever its stage has groups or matches;
--   * deletes are explicit, child to parent, each row count checked against the
--     preview; nothing relies on ON DELETE CASCADE;
--   * the caller must type the record name and send the preview fingerprint,
--     which is recomputed under lock (a stale preview is refused).
-- Teams, players, accounts and profiles are never deleted.

-- ---------------------------------------------------------------- audit log
CREATE TABLE public.deletion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_kind text NOT NULL CHECK (record_kind IN ('COMPETITION', 'SEASON', 'STAGE', 'ROUND')),
  record_id uuid NOT NULL,
  record_name text NOT NULL,
  record_path text NOT NULL,
  competition_id uuid NOT NULL,
  competition_name text NOT NULL,
  competition_status text NOT NULL,
  deleted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_by_role text,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  fingerprint text NOT NULL,
  counts jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  restored_at timestamptz,
  restored_by text
);
CREATE INDEX deletion_log_competition_idx ON public.deletion_log (competition_id, deleted_at DESC);

ALTER TABLE public.deletion_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY deletion_log_admin_select ON public.deletion_log
  FOR SELECT TO authenticated USING (public.is_fbf_admin());
REVOKE ALL ON public.deletion_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.deletion_log TO authenticated;

-- The log is append-only; only the restore markers can be filled in, once.
CREATE OR REPLACE FUNCTION public.guard_deletion_log()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'O registro de exclusões não pode ser apagado' USING ERRCODE = '55000';
  END IF;
  IF OLD.restored_at IS NOT NULL
     OR (to_jsonb(NEW) - 'restored_at' - 'restored_by') IS DISTINCT FROM (to_jsonb(OLD) - 'restored_at' - 'restored_by') THEN
    RAISE EXCEPTION 'O registro de exclusões só aceita a marcação de restauração, uma única vez'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER deletion_log_guard
  BEFORE UPDATE OR DELETE ON public.deletion_log
  FOR EACH ROW EXECUTE FUNCTION public.guard_deletion_log();

-- ------------------------------------------- narrow exception for matches
-- Matches and their status history stay undeletable, except the exact
-- never-played matches that delete_competition_record listed in this
-- transaction. Even then every condition is checked again here. There is no
-- DELETE grant or policy on these tables, so API users cannot reach this path.
CREATE OR REPLACE FUNCTION public.match_is_listed_for_purge(p_match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p_match_id::text = ANY (string_to_array(COALESCE(current_setting('fbf.purge_match_ids', true), ''), ','));
$$;
REVOKE ALL ON FUNCTION public.match_is_listed_for_purge(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_match_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.match_is_listed_for_purge(OLD.id)
     AND OLD.status IN ('SCHEDULED', 'POSTPONED', 'CANCELLED')
     AND OLD.home_score IS NULL AND OLD.away_score IS NULL
     AND OLD.home_penalty_score IS NULL AND OLD.away_penalty_score IS NULL
     AND OLD.duration_seconds IS NULL
     AND NOT OLD.recorded_retroactively
     AND NOT EXISTS (SELECT 1 FROM public.match_events WHERE match_id = OLD.id)
     AND NOT EXISTS (SELECT 1 FROM public.goalkeeper_participations WHERE match_id = OLD.id)
     AND NOT EXISTS (SELECT 1 FROM public.match_streamers WHERE match_id = OLD.id)
     AND NOT EXISTS (SELECT 1 FROM public.match_status_history WHERE match_id = OLD.id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Partidas não podem ser excluídas; use o status CANCELLED para preservar o histórico'
    USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_match_status_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Each history row checks itself: a single LIVE/FINISHED entry makes the
  -- whole statement fail, whatever order the rows are deleted in.
  IF TG_OP = 'DELETE'
     AND public.match_is_listed_for_purge(OLD.match_id)
     AND OLD.new_status NOT IN ('LIVE', 'FINISHED')
     AND COALESCE(OLD.previous_status, 'SCHEDULED') NOT IN ('LIVE', 'FINISHED') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'O histórico de status das partidas é somente de acréscimo'
    USING ERRCODE = '55000';
END;
$$;

-- ------------------------------------------------------------- the plan
-- Internal: resolves the record, checks permission, collects every row that
-- would be removed, the blockers and a fingerprint. Never exposed to the API.
CREATE OR REPLACE FUNCTION public._deletion_plan(p_kind text, p_id uuid, p_lock boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind text := upper(COALESCE(p_kind, ''));
  v_comp public.competitions%ROWTYPE;
  v_comp_id uuid;
  v_name text;
  v_path text;
  v_stage_id uuid;
  v_published boolean;
  v_status_label text;
  v_seasons uuid[] := '{}';
  v_stages uuid[] := '{}';
  v_rounds uuid[] := '{}';
  v_matches uuid[] := '{}';
  v_season_teams uuid[] := '{}';
  v_counts jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_n bigint;
  v_fingerprint text;
BEGIN
  IF v_kind NOT IN ('COMPETITION', 'SEASON', 'STAGE', 'ROUND') THEN
    RAISE EXCEPTION 'Tipo de registro inválido: %', p_kind USING ERRCODE = '22023';
  END IF;

  -- Resolve the record and its competition.
  IF v_kind = 'COMPETITION' THEN
    SELECT c.id, c.name, c.name INTO v_comp_id, v_name, v_path FROM public.competitions c WHERE c.id = p_id;
  ELSIF v_kind = 'SEASON' THEN
    SELECT c.id, s.name, c.name || ' › ' || s.name INTO v_comp_id, v_name, v_path
    FROM public.seasons s JOIN public.competitions c ON c.id = s.competition_id WHERE s.id = p_id;
  ELSIF v_kind = 'STAGE' THEN
    SELECT c.id, st.name, c.name || ' › ' || s.name || ' › ' || st.name INTO v_comp_id, v_name, v_path
    FROM public.stages st JOIN public.seasons s ON s.id = st.season_id
    JOIN public.competitions c ON c.id = s.competition_id WHERE st.id = p_id;
  ELSE
    SELECT c.id, r.name, c.name || ' › ' || s.name || ' › ' || st.name || ' › ' || r.name, r.stage_id
      INTO v_comp_id, v_name, v_path, v_stage_id
    FROM public.rounds r JOIN public.stages st ON st.id = r.stage_id
    JOIN public.seasons s ON s.id = st.season_id
    JOIN public.competitions c ON c.id = s.competition_id WHERE r.id = p_id;
  END IF;
  SELECT * INTO v_comp FROM public.competitions WHERE id = v_comp_id;
  IF v_comp.id IS NULL THEN
    RAISE EXCEPTION 'Registro não encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Permission of the real logged-in user.
  IF v_kind = 'COMPETITION' AND NOT public.is_fbf_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem excluir competições' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_manage_competition(v_comp.id) THEN
    RAISE EXCEPTION 'Sem permissão para excluir registros desta competição' USING ERRCODE = '42501';
  END IF;

  -- Under lock (real deletion), serialize with anything else touching the
  -- competition and freeze the containers so no match can be added meanwhile.
  IF p_lock THEN
    PERFORM 1 FROM public.competitions WHERE id = v_comp.id FOR UPDATE;
    SELECT * INTO v_comp FROM public.competitions WHERE id = v_comp.id;
  END IF;

  IF v_kind = 'COMPETITION' THEN
    v_seasons := ARRAY(SELECT id FROM public.seasons WHERE competition_id = p_id ORDER BY id);
  ELSIF v_kind = 'SEASON' THEN
    v_seasons := ARRAY[p_id];
  END IF;
  IF v_kind IN ('COMPETITION', 'SEASON') THEN
    v_stages := ARRAY(SELECT id FROM public.stages WHERE season_id = ANY (v_seasons) ORDER BY id);
  ELSIF v_kind = 'STAGE' THEN
    v_stages := ARRAY[p_id];
  END IF;
  IF v_kind = 'ROUND' THEN
    v_rounds := ARRAY[p_id];
  ELSE
    v_rounds := ARRAY(SELECT id FROM public.rounds WHERE stage_id = ANY (v_stages) ORDER BY id);
  END IF;
  IF p_lock THEN
    PERFORM 1 FROM public.seasons WHERE id = ANY (v_seasons) FOR UPDATE;
    PERFORM 1 FROM public.stages WHERE id = ANY (v_stages) FOR UPDATE;
    PERFORM 1 FROM public.rounds WHERE id = ANY (v_rounds) FOR UPDATE;
  END IF;
  v_matches := ARRAY(SELECT id FROM public.matches WHERE round_id = ANY (v_rounds) ORDER BY id);
  v_season_teams := ARRAY(SELECT id FROM public.season_teams WHERE season_id = ANY (v_seasons) ORDER BY id);
  IF p_lock THEN
    PERFORM 1 FROM public.matches WHERE id = ANY (v_matches) FOR UPDATE;
  END IF;

  v_counts := jsonb_build_object(
    'competitions', CASE WHEN v_kind = 'COMPETITION' THEN 1 ELSE 0 END,
    'competition_organizers', CASE WHEN v_kind = 'COMPETITION'
      THEN (SELECT count(*) FROM public.competition_organizers WHERE competition_id = v_comp.id) ELSE 0 END,
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
    'round_robin_pair_claims', (SELECT count(*) FROM public.round_robin_pair_claims
      WHERE match_id = ANY (v_matches) OR stage_id = ANY (v_stages))
  );

  -- Anything that shows a match was played blocks, in every competition.
  SELECT count(*) INTO v_n FROM public.matches WHERE id = ANY (v_matches) AND status IN ('LIVE', 'FINISHED');
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'MATCH_PLAYED', 'count', v_n,
      'message', format('%s partida(s) ao vivo ou finalizada(s)', v_n));
  END IF;
  SELECT count(DISTINCT match_id) INTO v_n FROM public.match_status_history
  WHERE match_id = ANY (v_matches) AND (new_status IN ('LIVE', 'FINISHED') OR previous_status IN ('LIVE', 'FINISHED'));
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'MATCH_HISTORY', 'count', v_n,
      'message', format('%s partida(s) já estiveram ao vivo ou finalizadas (histórico de jogo)', v_n));
  END IF;
  SELECT count(*) INTO v_n FROM public.matches WHERE id = ANY (v_matches)
    AND (home_score IS NOT NULL OR away_score IS NOT NULL OR home_penalty_score IS NOT NULL
      OR away_penalty_score IS NOT NULL OR duration_seconds IS NOT NULL OR recorded_retroactively);
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'MATCH_RESULT', 'count', v_n,
      'message', format('%s partida(s) com placar, duração ou resultado registrado', v_n));
  END IF;
  SELECT count(*) INTO v_n FROM public.match_events WHERE match_id = ANY (v_matches);
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'MATCH_EVENTS', 'count', v_n,
      'message', format('%s evento(s) de partida (gols, cartões e outros)', v_n));
  END IF;
  SELECT count(*) INTO v_n FROM public.goalkeeper_participations WHERE match_id = ANY (v_matches);
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'GOALKEEPERS', 'count', v_n,
      'message', format('%s participação(ões) de goleiro registrada(s)', v_n));
  END IF;
  SELECT count(*) INTO v_n FROM public.match_streamers WHERE match_id = ANY (v_matches);
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'STREAMERS', 'count', v_n,
      'message', format('%s transmissão(ões) vinculada(s) a partidas', v_n));
  END IF;
  SELECT count(*) INTO v_n FROM public.matches
  WHERE NOT (id = ANY (v_matches))
    AND (home_source_match_id = ANY (v_matches) OR away_source_match_id = ANY (v_matches)
      OR home_team_id = ANY (v_season_teams) OR away_team_id = ANY (v_season_teams));
  IF v_n > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'REFERENCED_ELSEWHERE', 'count', v_n,
      'message', format('%s partida(s) fora deste registro dependem dele', v_n));
  END IF;

  -- Published competitions keep their official structure.
  v_published := v_comp.status NOT IN ('CANCELLED', 'DRAFT');
  -- Same labels the site shows (src/lib/labels.ts).
  v_status_label := CASE v_comp.status WHEN 'UPCOMING' THEN 'Próxima' WHEN 'REGISTRATION' THEN 'Inscrições abertas'
    WHEN 'ACTIVE' THEN 'Em andamento' WHEN 'FINISHED' THEN 'Finalizada' WHEN 'DRAFT' THEN 'Em preparação'
    WHEN 'CANCELLED' THEN 'Arquivada' ELSE v_comp.status END;
  IF v_published AND v_kind = 'COMPETITION' AND cardinality(v_seasons) > 0 THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'PUBLISHED_COMPETITION', 'count', cardinality(v_seasons),
      'message', format('A competição está publicada (%s) e possui %s temporada(s); arquive-a antes de excluir', v_status_label, cardinality(v_seasons)));
  END IF;
  IF v_published AND v_kind IN ('SEASON', 'STAGE') THEN
    IF cardinality(v_matches) > 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code', 'PUBLISHED_MATCHES', 'count', cardinality(v_matches),
        'message', format('A competição está publicada (%s) e este registro possui %s partida(s)', v_status_label, cardinality(v_matches)));
    END IF;
    IF (v_counts->>'stage_groups')::int > 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code', 'PUBLISHED_GROUPS', 'count', (v_counts->>'stage_groups')::int,
        'message', format('A competição está publicada (%s) e este registro possui %s grupo(s) cadastrados', v_status_label, v_counts->>'stage_groups'));
    END IF;
    IF v_kind = 'SEASON' AND ((v_counts->>'season_teams')::int > 0 OR (v_counts->>'team_registrations')::int > 0) THEN
      v_blockers := v_blockers || jsonb_build_object('code', 'PUBLISHED_TEAMS',
        'count', (v_counts->>'season_teams')::int + (v_counts->>'team_registrations')::int,
        'message', format('A competição está publicada (%s) e a temporada possui %s equipe(s) e %s inscrição(ões)',
          v_status_label, v_counts->>'season_teams', v_counts->>'team_registrations'));
    END IF;
  END IF;

  -- A round is only deleted from a stage without groups or matches.
  IF v_kind = 'ROUND' THEN
    SELECT count(*) INTO v_n FROM public.stage_groups WHERE stage_id = v_stage_id;
    IF v_n > 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code', 'STAGE_HAS_GROUPS', 'count', v_n,
        'message', format('A fase desta rodada possui %s grupo(s) cadastrados', v_n));
    END IF;
    SELECT count(*) INTO v_n FROM public.matches m JOIN public.rounds r ON r.id = m.round_id WHERE r.stage_id = v_stage_id;
    IF v_n > 0 THEN
      v_blockers := v_blockers || jsonb_build_object('code', 'STAGE_HAS_MATCHES', 'count', v_n,
        'message', format('A fase desta rodada possui %s partida(s)', v_n));
    END IF;
  END IF;

  IF cardinality(v_matches) > 0 THEN
    v_warnings := v_warnings || to_jsonb(format(
      '%s partida(s) nunca disputada(s) serão removidas definitivamente, com seu histórico de status e reservas de confronto', cardinality(v_matches)));
  END IF;
  IF cardinality(v_season_teams) > 0 OR (v_counts->>'rosters')::int > 0 THEN
    v_warnings := v_warnings || to_jsonb('Times e jogadores não são apagados: apenas os vínculos com esta temporada'::text);
  END IF;
  IF v_published THEN
    v_warnings := v_warnings || to_jsonb(format('A competição está publicada (%s)', v_status_label));
  END IF;

  -- Fingerprint of exactly what would be removed (ids of every row).
  v_fingerprint := md5(concat_ws('|',
    v_kind, p_id, v_name, v_comp.status,
    array_to_string(v_seasons, ','), array_to_string(v_stages, ','), array_to_string(v_rounds, ','),
    array_to_string(v_matches, ','), array_to_string(v_season_teams, ','),
    (SELECT string_agg(user_id::text, ',' ORDER BY user_id) FROM public.competition_organizers
      WHERE v_kind = 'COMPETITION' AND competition_id = v_comp.id),
    (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.team_registrations WHERE season_id = ANY (v_seasons)),
    (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.rosters WHERE season_team_id = ANY (v_season_teams)),
    (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.stage_groups WHERE stage_id = ANY (v_stages)),
    (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.stage_group_teams WHERE stage_id = ANY (v_stages)),
    (SELECT string_agg(id::text, ',' ORDER BY id) FROM public.match_status_history WHERE match_id = ANY (v_matches)),
    (SELECT string_agg(concat_ws(':', stage_id, leg_number, team_low_id, team_high_id, match_id), ','
        ORDER BY stage_id, leg_number, team_low_id, team_high_id)
      FROM public.round_robin_pair_claims WHERE match_id = ANY (v_matches) OR stage_id = ANY (v_stages))
  ));

  RETURN jsonb_build_object(
    'kind', v_kind,
    'id', p_id,
    'name', v_name,
    'path', v_path,
    'competition', jsonb_build_object('id', v_comp.id, 'name', v_comp.name, 'status', v_comp.status),
    'can_delete', jsonb_array_length(v_blockers) = 0,
    'blockers', v_blockers,
    'warnings', v_warnings,
    'counts', v_counts,
    'fingerprint', v_fingerprint,
    'ids', jsonb_build_object('seasons', to_jsonb(v_seasons), 'stages', to_jsonb(v_stages), 'rounds', to_jsonb(v_rounds),
      'matches', to_jsonb(v_matches), 'season_teams', to_jsonb(v_season_teams))
  );
END;
$$;
REVOKE ALL ON FUNCTION public._deletion_plan(text, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------- preview
CREATE OR REPLACE FUNCTION public.deletion_preview(p_kind text, p_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public._deletion_plan(p_kind, p_id, false) - 'ids';
$$;
REVOKE ALL ON FUNCTION public.deletion_preview(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deletion_preview(text, uuid) TO authenticated;

-- ------------------------------------------------------------- deletion
CREATE OR REPLACE FUNCTION public.delete_competition_record(
  p_kind text, p_id uuid, p_confirmation text, p_expected_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan jsonb;
  v_kind text;
  v_counts jsonb;
  v_seasons uuid[];
  v_stages uuid[];
  v_rounds uuid[];
  v_matches uuid[];
  v_season_teams uuid[];
  v_comp_id uuid;
  v_snapshot jsonb;
  v_log_id uuid;
  v_n bigint;
  v_messages text;
BEGIN
  v_plan := public._deletion_plan(p_kind, p_id, true);
  v_kind := v_plan->>'kind';
  v_counts := v_plan->'counts';
  v_comp_id := (v_plan->'competition'->>'id')::uuid;

  IF NOT (v_plan->>'can_delete')::boolean THEN
    SELECT string_agg(b->>'message', '; ') INTO v_messages FROM jsonb_array_elements(v_plan->'blockers') AS b;
    RAISE EXCEPTION 'Exclusão bloqueada: %', v_messages USING ERRCODE = '55000';
  END IF;
  IF p_confirmation IS DISTINCT FROM (v_plan->>'name') THEN
    RAISE EXCEPTION 'A confirmação não corresponde ao nome do registro' USING ERRCODE = '22023';
  END IF;
  IF p_expected_fingerprint IS DISTINCT FROM (v_plan->>'fingerprint') THEN
    RAISE EXCEPTION 'Os dados mudaram desde a prévia. Abra a prévia novamente antes de excluir.'
      USING ERRCODE = '22023';
  END IF;

  v_seasons := ARRAY(SELECT jsonb_array_elements_text(v_plan->'ids'->'seasons')::uuid);
  v_stages := ARRAY(SELECT jsonb_array_elements_text(v_plan->'ids'->'stages')::uuid);
  v_rounds := ARRAY(SELECT jsonb_array_elements_text(v_plan->'ids'->'rounds')::uuid);
  v_matches := ARRAY(SELECT jsonb_array_elements_text(v_plan->'ids'->'matches')::uuid);
  v_season_teams := ARRAY(SELECT jsonb_array_elements_text(v_plan->'ids'->'season_teams')::uuid);

  -- Copy of every row, in the order a restore inserts them.
  v_snapshot := jsonb_build_object(
    'competitions', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.competitions x WHERE v_kind = 'COMPETITION' AND x.id = v_comp_id), '[]'),
    'competition_organizers', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM public.competition_organizers x WHERE v_kind = 'COMPETITION' AND x.competition_id = v_comp_id), '[]'),
    'seasons', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.seasons x WHERE x.id = ANY (v_seasons)), '[]'),
    'season_teams', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.season_teams x WHERE x.id = ANY (v_season_teams)), '[]'),
    'team_registrations', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.team_registrations x WHERE x.season_id = ANY (v_seasons)), '[]'),
    'rosters', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.rosters x WHERE x.season_team_id = ANY (v_season_teams)), '[]'),
    'stages', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.stages x WHERE x.id = ANY (v_stages)), '[]'),
    'stage_groups', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.stage_groups x WHERE x.stage_id = ANY (v_stages)), '[]'),
    'stage_group_teams', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.stage_group_teams x WHERE x.stage_id = ANY (v_stages)), '[]'),
    'rounds', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.rounds x WHERE x.id = ANY (v_rounds)), '[]'),
    'matches', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.matches x WHERE x.id = ANY (v_matches)), '[]'),
    'match_status_history', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM public.match_status_history x WHERE x.match_id = ANY (v_matches)), '[]'),
    'round_robin_pair_claims', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.stage_id, x.leg_number, x.team_low_id, x.team_high_id) FROM public.round_robin_pair_claims x
      WHERE x.match_id = ANY (v_matches) OR x.stage_id = ANY (v_stages)), '[]')
  );

  INSERT INTO public.deletion_log (record_kind, record_id, record_name, record_path, competition_id, competition_name,
    competition_status, deleted_by, deleted_by_role, fingerprint, counts, snapshot)
  VALUES (v_kind, p_id, v_plan->>'name', v_plan->>'path', v_comp_id, v_plan->'competition'->>'name',
    v_plan->'competition'->>'status', auth.uid(), (SELECT role FROM public.profiles WHERE id = auth.uid()),
    v_plan->>'fingerprint', v_counts, v_snapshot)
  RETURNING id INTO v_log_id;

  PERFORM set_config('fbf.purge_match_ids', array_to_string(v_matches, ','), true);

  -- Child to parent; each count must match the preview exactly.
  DELETE FROM public.round_robin_pair_claims WHERE match_id = ANY (v_matches) OR stage_id = ANY (v_stages);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> (v_counts->>'round_robin_pair_claims')::bigint THEN RAISE EXCEPTION 'Contagem divergente em reservas de confronto'; END IF;
  DELETE FROM public.match_status_history WHERE match_id = ANY (v_matches);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> (v_counts->>'match_status_history')::bigint THEN RAISE EXCEPTION 'Contagem divergente no histórico de status'; END IF;
  DELETE FROM public.matches WHERE id = ANY (v_matches);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> (v_counts->>'matches')::bigint THEN RAISE EXCEPTION 'Contagem divergente em partidas'; END IF;
  DELETE FROM public.rounds WHERE id = ANY (v_rounds);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> (v_counts->>'rounds')::bigint THEN RAISE EXCEPTION 'Contagem divergente em rodadas'; END IF;
  DELETE FROM public.stage_group_teams WHERE stage_id = ANY (v_stages);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> (v_counts->>'stage_group_teams')::bigint THEN RAISE EXCEPTION 'Contagem divergente em equipes dos grupos'; END IF;
  DELETE FROM public.stage_groups WHERE stage_id = ANY (v_stages);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> (v_counts->>'stage_groups')::bigint THEN RAISE EXCEPTION 'Contagem divergente em grupos'; END IF;
  DELETE FROM public.stages WHERE id = ANY (v_stages);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> (v_counts->>'stages')::bigint THEN RAISE EXCEPTION 'Contagem divergente em fases'; END IF;
  DELETE FROM public.rosters WHERE season_team_id = ANY (v_season_teams);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> (v_counts->>'rosters')::bigint THEN RAISE EXCEPTION 'Contagem divergente em elencos'; END IF;
  DELETE FROM public.team_registrations WHERE season_id = ANY (v_seasons);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> (v_counts->>'team_registrations')::bigint THEN RAISE EXCEPTION 'Contagem divergente em inscrições'; END IF;
  DELETE FROM public.season_teams WHERE id = ANY (v_season_teams);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> (v_counts->>'season_teams')::bigint THEN RAISE EXCEPTION 'Contagem divergente em equipes da temporada'; END IF;
  DELETE FROM public.seasons WHERE id = ANY (v_seasons);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> (v_counts->>'seasons')::bigint THEN RAISE EXCEPTION 'Contagem divergente em temporadas'; END IF;
  IF v_kind = 'COMPETITION' THEN
    DELETE FROM public.competition_organizers WHERE competition_id = v_comp_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> (v_counts->>'competition_organizers')::bigint THEN RAISE EXCEPTION 'Contagem divergente em organizadores'; END IF;
    DELETE FROM public.competitions WHERE id = v_comp_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN RAISE EXCEPTION 'Contagem divergente em competições'; END IF;
  END IF;

  PERFORM set_config('fbf.purge_match_ids', '', true);
  RETURN jsonb_build_object('log_id', v_log_id, 'kind', v_kind, 'name', v_plan->>'name', 'counts', v_counts);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_competition_record(text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_competition_record(text, uuid, text, text) TO authenticated;

-- ------------------------------------------------------------- restore
-- Database-owner procedure (never exposed to the API): reinserts the exact
-- rows of one deletion, parent to child, keeping their ids and timestamps.
-- User triggers of the affected tables are disabled inside this transaction
-- only (ALTER TABLE holds an exclusive lock until commit, so no other session
-- ever sees them disabled); foreign keys stay enforced.
CREATE OR REPLACE FUNCTION public.restore_deleted_records(p_log_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_log public.deletion_log%ROWTYPE;
  v_tables text[] := ARRAY['competitions', 'competition_organizers', 'seasons', 'season_teams', 'team_registrations',
    'rosters', 'stages', 'stage_groups', 'stage_group_teams', 'rounds', 'matches', 'match_status_history',
    'round_robin_pair_claims'];
  v_table text;
  v_rows jsonb;
  v_n bigint;
  v_result jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_log FROM public.deletion_log WHERE id = p_log_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registro de exclusão não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_log.restored_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta exclusão já foi restaurada em %', v_log.restored_at USING ERRCODE = '55000';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', v_table);
  END LOOP;
  FOREACH v_table IN ARRAY v_tables LOOP
    v_rows := COALESCE(v_log.snapshot->v_table, '[]'::jsonb);
    IF jsonb_array_length(v_rows) > 0 THEN
      EXECUTE format('INSERT INTO public.%1$I OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::public.%1$I, $1)', v_table)
        USING v_rows;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n <> jsonb_array_length(v_rows) THEN
        RAISE EXCEPTION 'Restauração divergente em %', v_table;
      END IF;
    ELSE
      v_n := 0;
    END IF;
    v_result := v_result || jsonb_build_object(v_table, v_n);
  END LOOP;
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', v_table);
  END LOOP;

  IF v_result <> v_log.counts THEN
    RAISE EXCEPTION 'Quantidades restauradas (%) diferentes das excluídas (%)', v_result, v_log.counts;
  END IF;
  UPDATE public.deletion_log SET restored_at = now(), restored_by = current_user WHERE id = p_log_id;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.restore_deleted_records(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ------------------------------------------ no more direct deletes (C)
DROP POLICY IF EXISTS competitions_admin_delete ON public.competitions;
DROP POLICY IF EXISTS seasons_scoped_delete ON public.seasons;
DROP POLICY IF EXISTS stages_scoped_delete ON public.stages;
DROP POLICY IF EXISTS rounds_scoped_delete ON public.rounds;
REVOKE DELETE ON public.competitions, public.seasons, public.stages, public.rounds FROM anon, authenticated;
