import { serialRunDisplayLabel } from "./instacomp-serial";

export type InstaCompDraftTitleAi = {
  player?: string | null;
  year?: string | null;
  brand?: string | null;
  setName?: string | null;
  cardNumber?: string | null;
  parallel?: string | null;
  serialNumber?: string | null;
  isRookie?: boolean | null;
};

function cleanDraftTitlePart(value: string | null | undefined, maxLength = 120) {
  if (!value) return "";

  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function buildInstaCompDraftTitle(
  ai: InstaCompDraftTitleAi | null | undefined,
  fallback: string,
) {
  const serialRun = serialRunDisplayLabel(ai?.serialNumber);
  const title = [
    cleanDraftTitlePart(ai?.year, 24),
    cleanDraftTitlePart(ai?.brand, 80),
    cleanDraftTitlePart(ai?.setName, 120),
    cleanDraftTitlePart(ai?.player, 120),
    ai?.isRookie ? "Rookie" : null,
    cleanDraftTitlePart(ai?.parallel, 120),
    ai?.cardNumber
      ? `#${cleanDraftTitlePart(ai.cardNumber, 40).replace(/^#/, "")}`
      : null,
    serialRun,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return title || fallback;
}
