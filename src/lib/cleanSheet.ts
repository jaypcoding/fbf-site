export type GoalkeeperSpell = {
  started_at_seconds: number;
  ended_at_seconds: number | null;
  first_conceded_at_seconds: number | null;
};

export function cleanSheetSeconds(spell: GoalkeeperSpell, finalMatchDurationSeconds?: number | null): number {
  if (
    finalMatchDurationSeconds === null
    || finalMatchDurationSeconds === undefined
    || spell.ended_at_seconds === null
    || spell.started_at_seconds < 0
    || spell.ended_at_seconds < spell.started_at_seconds
    || spell.ended_at_seconds > finalMatchDurationSeconds
    || (spell.first_conceded_at_seconds !== null
      && (spell.first_conceded_at_seconds < spell.started_at_seconds
        || spell.first_conceded_at_seconds > spell.ended_at_seconds))
  ) return 0;
  const end = spell.first_conceded_at_seconds ?? spell.ended_at_seconds;
  return Math.max(0, end - spell.started_at_seconds);
}

export function isCleanSheet(spell: GoalkeeperSpell, finalMatchDurationSeconds?: number | null): boolean {
  return spell.first_conceded_at_seconds === null
    && finalMatchDurationSeconds !== null
    && finalMatchDurationSeconds !== undefined
    && spell.ended_at_seconds !== null
    && spell.started_at_seconds >= 0
    && spell.started_at_seconds <= spell.ended_at_seconds
    && spell.ended_at_seconds <= finalMatchDurationSeconds;
}
