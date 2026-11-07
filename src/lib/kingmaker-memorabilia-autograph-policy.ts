import { classifyCollectibleCategory } from './collectible-category-policy';

/** Gate for the optional memorabilia autograph workflow. Never send cards here. */
export function shouldRunMemorabiliaAutograph(input: {
  title?: string | null;
  category?: string | null;
  sport?: string | null;
  autographSuspected?: boolean;
}) {
  const decision = classifyCollectibleCategory(input);
  if (decision.isTradingCard) return { run: false, reason: 'card_excluded' as const };
  if (!decision.isPhysicalMemorabilia) return { run: false, reason: 'not_confirmed_memorabilia' as const };
  if (!input.autographSuspected) return { run: false, reason: 'no_autograph_signal' as const };
  return { run: true, reason: 'memorabilia_autograph_candidate' as const };
}
