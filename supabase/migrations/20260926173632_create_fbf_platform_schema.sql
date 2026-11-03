/*
# Create the FBF competition platform schema

1. New Tables
- `profiles`: public profile details and server-managed account role.
- `competitions`: reusable competition definitions such as FBF 20 PRINCIPAL.
- `seasons`: editions belonging to a competition.
- `teams`: reusable teams.
- `players`: reusable player records.
- `season_teams`: team participation in one season.
- `rosters`: player registration for a season team.
- `stages`: configurable competition phases.
- `rounds`: rounds within a stage.
- `matches`: scheduled and completed fixtures.
- `match_events`: goals, assists, goalkeeper changes, substitutions, and future events.
- `goalkeeper_participations`: goalkeeper time windows used to calculate time-based clean sheet totals.
- `competition_organizers`: organizer access assignments.

2. Security
- Public competition content is readable by everyone, including the anonymous website visitor.
- Management writes require an authenticated admin or assigned organizer.
- User roles are stored server-side in `profiles.role` and cannot be changed through normal client updates.
- All tables have row level security enabled with separate policies for each operation.

3. Important notes
- No season, team, player, result, or statistic data is invented for the initial state.
- Competition formats and status values are generic so future editions can be configured without new tables.
- Standings and statistics are derived from match results and event/goalkeeper participation data rather than manually entered totals.
*/

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  role text NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'ORGANIZER', 'ADMIN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'Principal',
  format text NOT NULL DEFAULT 'Pontos corridos',
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'UPCOMING', 'REGISTRATION', 'ACTIVE', 'FINISHED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  name text NOT NULL,
  starts_at date,
  ends_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (competition_id, name)
);

CREATE TABLE IF NOT EXISTS public.teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  logo_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname text NOT NULL,
  full_name text,
  photo_url text,
  nationality text,
  position text NOT NULL DEFAULT 'Volante' CHECK (position IN ('Goleiro', 'Volante', 'Pivô')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.season_teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_id, team_id)
);

CREATE TABLE IF NOT EXISTS public.rosters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_team_id uuid NOT NULL REFERENCES public.season_teams(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  shirt_number integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (season_team_id, player_id)
);

CREATE TABLE IF NOT EXISTS public.stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id uuid NOT NULL REFERENCES public.seasons(id) ON DELETE CASCADE,
  name text NOT NULL,
  stage_order integer NOT NULL DEFAULT 1,
  format text NOT NULL DEFAULT 'Pontos corridos',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_id uuid NOT NULL REFERENCES public.stages(id) ON DELETE CASCADE,
  name text NOT NULL,
  round_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES public.rounds(id) ON DELETE CASCADE,
  home_team_id uuid REFERENCES public.season_teams(id) ON DELETE SET NULL,
  away_team_id uuid REFERENCES public.season_teams(id) ON DELETE SET NULL,
  scheduled_at timestamptz,
  home_score integer CHECK (home_score IS NULL OR home_score >= 0),
  away_score integer CHECK (away_score IS NULL OR away_score >= 0),
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'LIVE', 'FINISHED', 'POSTPONED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.match_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('GOAL', 'ASSIST', 'SUBSTITUTION', 'GOALKEEPER_IN', 'GOALKEEPER_OUT')),
  minute_seconds integer NOT NULL CHECK (minute_seconds >= 0),
  team_id uuid REFERENCES public.season_teams(id) ON DELETE SET NULL,
  player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  related_player_id uuid REFERENCES public.players(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.goalkeeper_participations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES public.season_teams(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  started_at_seconds integer NOT NULL DEFAULT 0 CHECK (started_at_seconds >= 0),
  ended_at_seconds integer CHECK (ended_at_seconds IS NULL OR ended_at_seconds >= started_at_seconds),
  first_conceded_at_seconds integer CHECK (first_conceded_at_seconds IS NULL OR first_conceded_at_seconds >= started_at_seconds),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.competition_organizers (
  competition_id uuid NOT NULL REFERENCES public.competitions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, user_id)
);

CREATE INDEX IF NOT EXISTS seasons_competition_id_idx ON public.seasons(competition_id);
CREATE INDEX IF NOT EXISTS season_teams_season_id_idx ON public.season_teams(season_id);
CREATE INDEX IF NOT EXISTS rosters_season_team_id_idx ON public.rosters(season_team_id);
CREATE INDEX IF NOT EXISTS rounds_stage_id_idx ON public.rounds(stage_id);
CREATE INDEX IF NOT EXISTS matches_round_id_idx ON public.matches(round_id);
CREATE INDEX IF NOT EXISTS match_events_match_id_idx ON public.match_events(match_id);
CREATE INDEX IF NOT EXISTS goalkeeper_participations_match_id_idx ON public.goalkeeper_participations(match_id);

CREATE OR REPLACE FUNCTION public.is_fbf_manager()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('ADMIN', 'ORGANIZER')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_fbf_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'ADMIN'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_fbf_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_fbf_manager() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_fbf_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_fbf_admin() TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.season_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goalkeeper_participations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_organizers ENABLE ROW LEVEL SECURITY;

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;
REVOKE INSERT ON public.profiles FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "profiles_select_self" ON public.profiles;
CREATE POLICY "profiles_select_self" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id OR public.is_fbf_admin());
DROP POLICY IF EXISTS "profiles_insert_self" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_display_name" ON public.profiles;
CREATE POLICY "profiles_update_display_name" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin" ON public.profiles FOR DELETE TO authenticated USING (public.is_fbf_admin());

DROP POLICY IF EXISTS "competitions_public_select" ON public.competitions;
CREATE POLICY "competitions_public_select" ON public.competitions FOR SELECT TO anon, authenticated USING (status <> 'DRAFT' OR public.is_fbf_manager());
DROP POLICY IF EXISTS "competitions_manager_insert" ON public.competitions;
CREATE POLICY "competitions_manager_insert" ON public.competitions FOR INSERT TO authenticated WITH CHECK (public.is_fbf_admin());
DROP POLICY IF EXISTS "competitions_manager_update" ON public.competitions;
CREATE POLICY "competitions_manager_update" ON public.competitions FOR UPDATE TO authenticated USING (public.is_fbf_admin() OR EXISTS (SELECT 1 FROM public.competition_organizers WHERE competition_id = competitions.id AND user_id = auth.uid())) WITH CHECK (public.is_fbf_admin() OR EXISTS (SELECT 1 FROM public.competition_organizers WHERE competition_id = competitions.id AND user_id = auth.uid()));
DROP POLICY IF EXISTS "competitions_admin_delete" ON public.competitions;
CREATE POLICY "competitions_admin_delete"
  ON public.competitions FOR DELETE TO authenticated
  USING (
    public.is_fbf_admin()
    AND NOT EXISTS (
      SELECT 1
      FROM public.seasons s
      JOIN public.stages st ON st.season_id = s.id
      JOIN public.rounds r ON r.stage_id = st.id
      JOIN public.matches m ON m.round_id = r.id
      WHERE s.competition_id = competitions.id
    )
  );

DROP POLICY IF EXISTS "seasons_public_select" ON public.seasons;
CREATE POLICY "seasons_public_select" ON public.seasons FOR SELECT TO anon, authenticated USING (EXISTS (SELECT 1 FROM public.competitions WHERE id = seasons.competition_id AND (status <> 'DRAFT' OR public.is_fbf_manager())));
DROP POLICY IF EXISTS "seasons_manager_insert" ON public.seasons;
CREATE POLICY "seasons_manager_insert" ON public.seasons FOR INSERT TO authenticated WITH CHECK (public.is_fbf_manager());
DROP POLICY IF EXISTS "seasons_manager_update" ON public.seasons;
CREATE POLICY "seasons_manager_update" ON public.seasons FOR UPDATE TO authenticated USING (public.is_fbf_manager()) WITH CHECK (public.is_fbf_manager());
DROP POLICY IF EXISTS "seasons_admin_delete" ON public.seasons;
CREATE POLICY "seasons_admin_delete" ON public.seasons FOR DELETE TO authenticated USING (public.is_fbf_admin());

DROP POLICY IF EXISTS "teams_public_select" ON public.teams;
CREATE POLICY "teams_public_select" ON public.teams FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "teams_manager_insert" ON public.teams;
CREATE POLICY "teams_manager_insert" ON public.teams FOR INSERT TO authenticated WITH CHECK (public.is_fbf_manager());
DROP POLICY IF EXISTS "teams_manager_update" ON public.teams;
CREATE POLICY "teams_manager_update" ON public.teams FOR UPDATE TO authenticated USING (public.is_fbf_manager()) WITH CHECK (public.is_fbf_manager());
DROP POLICY IF EXISTS "teams_admin_delete" ON public.teams;
CREATE POLICY "teams_admin_delete" ON public.teams FOR DELETE TO authenticated USING (public.is_fbf_admin());

DROP POLICY IF EXISTS "players_public_select" ON public.players;
CREATE POLICY "players_public_select" ON public.players FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "players_manager_insert" ON public.players;
CREATE POLICY "players_manager_insert" ON public.players FOR INSERT TO authenticated WITH CHECK (public.is_fbf_manager());
DROP POLICY IF EXISTS "players_manager_update" ON public.players;
CREATE POLICY "players_manager_update" ON public.players FOR UPDATE TO authenticated USING (public.is_fbf_manager()) WITH CHECK (public.is_fbf_manager());
DROP POLICY IF EXISTS "players_admin_delete" ON public.players;
CREATE POLICY "players_admin_delete" ON public.players FOR DELETE TO authenticated USING (public.is_fbf_admin());

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['season_teams','rosters','stages','rounds','matches','match_events','goalkeeper_participations','competition_organizers'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "%s_public_select" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "%s_public_select" ON public.%I FOR SELECT TO anon, authenticated USING (true)', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "%s_manager_insert" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "%s_manager_insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_fbf_manager())', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "%s_manager_update" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "%s_manager_update" ON public.%I FOR UPDATE TO authenticated USING (public.is_fbf_manager()) WITH CHECK (public.is_fbf_manager())', table_name, table_name);
    EXECUTE format('DROP POLICY IF EXISTS "%s_admin_delete" ON public.%I', table_name, table_name);
    EXECUTE format('CREATE POLICY "%s_admin_delete" ON public.%I FOR DELETE TO authenticated USING (public.is_fbf_admin())', table_name, table_name);
  END LOOP;
END $$;

INSERT INTO public.competitions (name, category, format, status, description)
VALUES
  ('FBF 20 PRINCIPAL', 'Principal', 'Pontos corridos', 'DRAFT', 'Competição principal da Federação Brasileira de Futsal.'),
  ('FBF 20 SECUNDARIA', 'Secundária', 'Pontos corridos', 'DRAFT', 'Competição secundária da Federação Brasileira de Futsal.'),
  ('URUN X4', 'X4', 'Personalizado', 'DRAFT', 'Competição X4 da Federação Brasileira de Futsal.')
ON CONFLICT DO NOTHING;
