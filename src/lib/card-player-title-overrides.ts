const KNOWN_PLAYER_TITLE_OVERRIDES: Array<{
  pattern: RegExp;
  player: string;
}> = [
  {
    pattern:
      /\bBowman Sterling Mike Stanton Hanley Ramirez Dual Relics\b/i,
    player: "Mike Stanton / Hanley Ramirez",
  },
  {
    pattern:
      /\bBlack Diamond Tkachuk Stutzle MEM Diamond Mine Dual Relics\b/i,
    player: "Brady Tkachuk / Tim Stutzle",
  },
  {
    pattern: /\bOPC Platinum Liquid Metal Leo Carlsson\b/i,
    player: "Leo Carlsson",
  },
  {
    pattern:
      /\bO-PEE-CHEE PLATINUM RED PRISM AUTO LEO CARLSSON\b/i,
    player: "Leo Carlsson",
  },
];

export function resolveKnownPlayerTitleOverride(title: string) {
  const normalized = String(title || "").trim().replace(/\s+/g, " ");
  if (!normalized) return null;

  return (
    KNOWN_PLAYER_TITLE_OVERRIDES.find(({ pattern }) => pattern.test(normalized))
      ?.player || null
  );
}
