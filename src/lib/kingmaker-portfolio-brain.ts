import { createHash } from "node:crypto";

export type KingmakerPortfolioPosition = {
  positionKey: string;
  category: string;
  subject: string;
  quantity: number;
  landedCost: number;
  marketValue: number | null;
  confidence: number;
  liquidity: number;
  volatility: number;
  acquiredAt: string;
};

export function analyzeKingmakerPortfolio(positions: KingmakerPortfolioPosition[], now = new Date()) {
  const valid = positions.filter((position) => position.quantity > 0 && position.landedCost >= 0);
  const rows = valid.map((position) => {
    const totalCost = position.landedCost * position.quantity;
    const totalMarket = position.marketValue === null ? null : position.marketValue * position.quantity;
    const unrealizedProfit = totalMarket === null ? null : Number((totalMarket - totalCost).toFixed(2));
    const unrealizedRoiPercent = unrealizedProfit === null || totalCost <= 0 ? null : Number(((unrealizedProfit / totalCost) * 100).toFixed(2));
    const holdingDays = Math.max(0, (now.getTime() - Date.parse(position.acquiredAt)) / 86_400_000);
    const risk = Math.max(0, Math.min(1, position.volatility * 0.5 + (1 - position.liquidity) * 0.3 + (1 - position.confidence) * 0.2));
    const exitRecommendation = risk >= 0.7 || holdingDays > 180 ? "reduce" : unrealizedRoiPercent !== null && unrealizedRoiPercent >= 35 && position.liquidity >= 0.6 ? "list" : "hold";
    return { ...position, totalCost, totalMarket, unrealizedProfit, unrealizedRoiPercent, holdingDays: Number(holdingDays.toFixed(2)), risk: Number(risk.toFixed(4)), exitRecommendation };
  });
  const deployedCapital = rows.reduce((sum, row) => sum + row.totalCost, 0);
  const estimatedMarketValue = rows.reduce((sum, row) => sum + (row.totalMarket ?? 0), 0);
  const byCategory = new Map<string, number>();
  for (const row of rows) byCategory.set(row.category, (byCategory.get(row.category) ?? 0) + row.totalCost);
  const concentration = [...byCategory.entries()].map(([category, capital]) => ({ category, capital: Number(capital.toFixed(2)), share: deployedCapital ? Number((capital / deployedCapital).toFixed(4)) : 0 })).sort((a, b) => b.capital - a.capital);
  const warnings: string[] = [];
  if (concentration[0]?.share > 0.5) warnings.push(`category_concentration:${concentration[0].category}`);
  if (rows.some((row) => row.risk >= 0.75)) warnings.push("high_risk_position");
  if (rows.some((row) => row.holdingDays > 180 && row.exitRecommendation === "reduce")) warnings.push("stale_capital");
  const canonical = { rows, concentration, warnings };
  return {
    deployedCapital: Number(deployedCapital.toFixed(2)),
    estimatedMarketValue: Number(estimatedMarketValue.toFixed(2)),
    unrealizedProfit: Number((estimatedMarketValue - deployedCapital).toFixed(2)),
    positions: rows,
    concentration,
    warnings,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
}
