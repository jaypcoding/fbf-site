/*
# Streamers on Kick

Adds Kick as a streaming platform for match narrators, besides Twitch and
YouTube. Only the accepted values of streamers.platform are widened: no data
is changed, existing rows (TWITCH/YOUTUBE) keep satisfying the new rule and
the security policies are untouched. The constraint is replaced in a single
transaction; the table is tiny, so the validation is immediate.
*/

ALTER TABLE public.streamers DROP CONSTRAINT IF EXISTS streamers_platform_check;
ALTER TABLE public.streamers
  ADD CONSTRAINT streamers_platform_check CHECK (platform IN ('TWITCH', 'YOUTUBE', 'KICK'));

COMMENT ON COLUMN public.streamers.platform IS 'TWITCH, YOUTUBE or KICK';
COMMENT ON COLUMN public.streamers.channel IS 'Twitch login, YouTube channel ID (UC...) or Kick channel slug';
