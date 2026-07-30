const DEFAULT_RELEASE_TEAM_SLUG = "truelycollectables-projects";

type VercelTeam = {
  slug?: unknown;
  membership?: {
    confirmed?: unknown;
  } | null;
};

export function releaseRuntimeTeamIsAllowed(
  teams: unknown,
  expectedTeamSlug = DEFAULT_RELEASE_TEAM_SLUG,
) {
  if (!Array.isArray(teams)) return false;

  return teams.some((teamValue) => {
    const team = teamValue as VercelTeam;
    return (
      String(team?.slug || "") === expectedTeamSlug &&
      team?.membership?.confirmed !== false
    );
  });
}
