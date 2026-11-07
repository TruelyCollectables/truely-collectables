export type InstaCompDropFile = {
  name: string;
  size: number;
  type: string;
  lastModified?: number;
};

export type InstaCompDropPair<T extends InstaCompDropFile = InstaCompDropFile> = {
  front: T | null;
  back: T | null;
  pairKey: string;
  pairing: "filename" | "drop_order";
  sortIndex: number;
};

export type InstaCompDropPairingResult<T extends InstaCompDropFile = InstaCompDropFile> = {
  pairs: InstaCompDropPair<T>[];
  duplicateCount: number;
};

export type InstaCompQueueOutcome<T, R> =
  | { item: T; status: "fulfilled"; value: R }
  | { item: T; status: "rejected"; reason: unknown };

const FRONT_TOKENS = new Set(["front", "fr", "f", "obverse"]);
const BACK_TOKENS = new Set(["back", "bk", "b", "reverse", "rear"]);

function fileBaseName(name: string) {
  return String(name || "").replace(/\.[^.]+$/, "");
}

function normalizedFileName(name: string) {
  return String(name || "").trim().toLowerCase();
}

export function instaCompDropFileSignature(file: InstaCompDropFile) {
  return [
    normalizedFileName(file.name),
    Number(file.size) || 0,
    Number(file.lastModified) || 0,
    String(file.type || "").toLowerCase(),
  ].join("|");
}

export function classifyInstaCompDropFile(file: InstaCompDropFile) {
  const baseName = fileBaseName(file.name);
  const tokens = baseName
    .toLowerCase()
    .split(/[\s._-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const lastToken = tokens[tokens.length - 1] || "";
  const compactSuffix = lastToken.match(/^(front|back|obverse|reverse|rear|fr|bk)(\d+)?$/)?.[1] || "";
  const sideToken = compactSuffix || lastToken;
  const side = FRONT_TOKENS.has(sideToken)
    ? "front"
    : BACK_TOKENS.has(sideToken)
      ? "back"
      : "unknown";
  const keyTokens = side === "unknown" ? tokens : tokens.slice(0, -1);

  return {
    side,
    pairKey: keyTokens.join("-") || baseName.toLowerCase() || "card",
  } as const;
}

export function pairInstaCompDropFiles<T extends InstaCompDropFile>(
  files: T[],
  existingSignatures: Iterable<string> = [],
): InstaCompDropPairingResult<T> {
  const seen = new Set(existingSignatures);
  const accepted: Array<{ file: T; index: number }> = [];
  let duplicateCount = 0;

  files.forEach((file, index) => {
    const signature = instaCompDropFileSignature(file);
    if (seen.has(signature)) {
      duplicateCount += 1;
      return;
    }
    seen.add(signature);
    accepted.push({ file, index });
  });

  const namedGroups = new Map<
    string,
    {
      fronts: Array<{ file: T; index: number }>;
      backs: Array<{ file: T; index: number }>;
    }
  >();
  const unknown: Array<{ file: T; index: number }> = [];

  accepted.forEach((entry) => {
    const classified = classifyInstaCompDropFile(entry.file);
    if (classified.side === "unknown") {
      unknown.push(entry);
      return;
    }

    const group = namedGroups.get(classified.pairKey) || { fronts: [], backs: [] };
    if (classified.side === "front") group.fronts.push(entry);
    else group.backs.push(entry);
    namedGroups.set(classified.pairKey, group);
  });

  const pairs: InstaCompDropPair<T>[] = [];

  namedGroups.forEach((group, pairKey) => {
    const fronts = group.fronts.sort((left, right) => left.index - right.index);
    const backs = group.backs.sort((left, right) => left.index - right.index);
    const rows = Math.max(fronts.length, backs.length);

    for (let index = 0; index < rows; index += 1) {
      const front = fronts[index] || null;
      const back = backs[index] || null;
      pairs.push({
        front: front?.file || null,
        back: back?.file || null,
        pairKey,
        pairing: "filename",
        sortIndex: Math.min(front?.index ?? Number.MAX_SAFE_INTEGER, back?.index ?? Number.MAX_SAFE_INTEGER),
      });
    }
  });

  const orderedUnknown = unknown.sort((left, right) => left.index - right.index);
  for (let index = 0; index < orderedUnknown.length; index += 2) {
    const front = orderedUnknown[index];
    const back = orderedUnknown[index + 1] || null;
    pairs.push({
      front: front.file,
      back: back?.file || null,
      pairKey: `drop-order-${front.index + 1}`,
      pairing: "drop_order",
      sortIndex: front.index,
    });
  }

  return {
    pairs: pairs.sort((left, right) => left.sortIndex - right.sortIndex),
    duplicateCount,
  };
}

export async function runInstaCompBatchQueue<T, R>(params: {
  items: T[];
  concurrency?: number;
  worker: (item: T, index: number) => Promise<R>;
  onOutcome?: (outcome: InstaCompQueueOutcome<T, R>, index: number) => void;
}) {
  const concurrency = Math.max(1, Math.min(4, Math.floor(params.concurrency || 1)));
  const outcomes: Array<InstaCompQueueOutcome<T, R> | undefined> = new Array(params.items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= params.items.length) return;

      const item = params.items[index];
      let outcome: InstaCompQueueOutcome<T, R>;
      try {
        outcome = {
          item,
          status: "fulfilled",
          value: await params.worker(item, index),
        };
      } catch (reason) {
        outcome = { item, status: "rejected", reason };
      }

      outcomes[index] = outcome;
      params.onOutcome?.(outcome, index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, params.items.length) }, () => runWorker()),
  );

  return outcomes.filter(
    (outcome): outcome is InstaCompQueueOutcome<T, R> => Boolean(outcome),
  );
}
