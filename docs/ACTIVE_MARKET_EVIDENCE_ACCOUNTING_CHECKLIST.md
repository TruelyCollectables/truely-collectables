# Evidence accounting release checklist

1. Regression simulations pass.
2. Full Next.js build passes.
3. Every external candidate has exactly one disposition.
4. External total equals the sum of verified, scouting, packaging-rejected, identity-rejected, auction-only, and unclassified counts.
5. Unclassified count is zero.
6. Seller listing is separated from external totals.
7. No pricing recommendation is trusted when accounting is blocked.
8. Production deployment is green before authenticated runtime verification.
