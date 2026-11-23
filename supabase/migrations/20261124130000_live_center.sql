/*
# Central ao Vivo: when each live match was started in the system

The live center shows only what the organization records: the official score
of the match, the events in the order they were registered, the goalkeepers
and the transmissions linked to the match. It never simulates a clock or a
match situation (the HaxBall game time is not sent to the site).

The one fact it needs that visitors cannot read today is WHEN a match was put
LIVE in the system: match_status_history is private (it also says who changed
the status). live_match_status() returns only that timestamp, and only for
matches LIVE right now in a competition visible to the public. Nothing is
stored and nothing else is exposed (no user id, no other transitions).
*/

CREATE OR REPLACE FUNCTION public.live_match_status()
RETURNS TABLE (match_id uuid, live_since timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id,
    (SELECT max(h.changed_at) FROM public.match_status_history h WHERE h.match_id = m.id AND h.new_status = 'LIVE')
  FROM public.matches m
  JOIN public.rounds r ON r.id = m.round_id
  JOIN public.stages stg ON stg.id = r.stage_id
  JOIN public.seasons s ON s.id = stg.season_id
  JOIN public.competitions c ON c.id = s.competition_id
  WHERE m.status = 'LIVE' AND c.status NOT IN ('DRAFT', 'CANCELLED');
$$;
REVOKE ALL ON FUNCTION public.live_match_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.live_match_status() TO anon, authenticated;
