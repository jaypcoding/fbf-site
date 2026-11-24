/*
# Status "Ao vivo" of a streamer (global mini player)

Until now a transmission only appeared in the site's mini player when the
streamer was linked to a match whose status was LIVE. There was no way to
say "this streamer is on the air now" by itself.

This adds that status to the existing streamers registration (no second
system, no duplicated records):
  - streamers.is_live: set by an admin in the panel (same RLS as today:
    everyone reads, only admins write);
  - streamers.live_since: filled by the database when is_live becomes true,
    cleared when it becomes false (the order of the mini player list).
A streamer linked to a LIVE match keeps appearing as before.
*/

ALTER TABLE public.streamers ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT false;
ALTER TABLE public.streamers ADD COLUMN IF NOT EXISTS live_since timestamptz;

CREATE OR REPLACE FUNCTION public.set_streamer_live_since()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_live THEN
    IF TG_OP = 'INSERT' OR NOT COALESCE(OLD.is_live, false) THEN
      NEW.live_since := now();
    ELSE
      NEW.live_since := OLD.live_since; -- staying live keeps the original start
    END IF;
  ELSE
    NEW.live_since := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS streamers_live_since ON public.streamers;
CREATE TRIGGER streamers_live_since BEFORE INSERT OR UPDATE ON public.streamers
FOR EACH ROW EXECUTE FUNCTION public.set_streamer_live_since();

CREATE INDEX IF NOT EXISTS streamers_live_idx ON public.streamers(live_since) WHERE is_live;
