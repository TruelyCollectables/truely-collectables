import cards001025 from "../../scripts/fixtures/instacomp-supervised-203/cards-001-025.json";
import cards026050 from "../../scripts/fixtures/instacomp-supervised-203/cards-026-050.json";
import cards051075 from "../../scripts/fixtures/instacomp-supervised-203/cards-051-075.json";
import cards076100 from "../../scripts/fixtures/instacomp-supervised-203/cards-076-100.json";
import cards101125 from "../../scripts/fixtures/instacomp-supervised-203/cards-101-125.json";
import cards126150 from "../../scripts/fixtures/instacomp-supervised-203/cards-126-150.json";
import cards151175 from "../../scripts/fixtures/instacomp-supervised-203/cards-151-175.json";
import cards176200 from "../../scripts/fixtures/instacomp-supervised-203/cards-176-200.json";
import cards201203 from "../../scripts/fixtures/instacomp-supervised-203/cards-201-203.json";

export type InstaCompSupervised203Card = {
  ordinal: number;
  scanId: string;
  year: string;
  manufacturer: string;
  brand: string;
  setName: string;
  player: string;
  cardNumber: string;
  parallel: string | null;
  serialNumber: string | null;
  serialRun: number | null;
  sport: string | null;
  league: string | null;
  autograph: boolean | null;
  operatorNote: string | null;
};

type CompactCard = {
  o: number;
  s: string;
  y: string;
  m: string;
  b: string;
  n: string;
  p: string;
  c: string;
  q: string | null;
  sn: string | null;
  sr: number | null;
  sp: string | null;
  lg: string | null;
  a: boolean | null;
  note: string | null;
};

type Fixture = { cards: CompactCard[] };

const fixtures = [
  cards001025,
  cards026050,
  cards051075,
  cards076100,
  cards101125,
  cards126150,
  cards151175,
  cards176200,
  cards201203,
] as Fixture[];

function expand(card: CompactCard): InstaCompSupervised203Card {
  return {
    ordinal: card.o,
    scanId: card.s,
    year: card.y,
    manufacturer: card.m,
    brand: card.b,
    setName: card.n,
    player: card.p,
    cardNumber: card.c,
    parallel: card.q,
    serialNumber: card.sn,
    serialRun: card.sr,
    sport: card.sp,
    league: card.lg,
    autograph: card.a,
    operatorNote: card.note,
  };
}

export const INSTACOMP_SUPERVISED_203: InstaCompSupervised203Card[] = fixtures
  .flatMap((fixture) => fixture.cards)
  .map(expand)
  .sort((left, right) => left.ordinal - right.ordinal);

if (INSTACOMP_SUPERVISED_203.length !== 203) {
  throw new Error(`InstaComp supervised truth must contain 203 cards; found ${INSTACOMP_SUPERVISED_203.length}.`);
}

for (let index = 0; index < INSTACOMP_SUPERVISED_203.length; index += 1) {
  const ordinal = index + 1;
  const expectedScanId = `SCAN-${String(ordinal).padStart(4, "0")}`;
  const card = INSTACOMP_SUPERVISED_203[index];
  if (card.ordinal !== ordinal || card.scanId !== expectedScanId) {
    throw new Error(`InstaComp supervised truth sequence mismatch at ${ordinal}.`);
  }
}
