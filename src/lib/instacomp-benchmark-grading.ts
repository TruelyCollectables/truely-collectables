export type InstaCompBenchmarkParallelExpectation = {
  setName: string;
  setAliases?: string[];
  parallel: string | null;
  parallelAliases?: string[];
};

export type InstaCompBenchmarkParallelGrade = {
  status: "pass" | "partial" | "fail";
  note: string | null;
};

function clean(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string | null | undefined) {
  return clean(value).split(/\s+/).filter(Boolean);
}

function isGenericBase(value: string | null | undefined) {
  return ["", "base", "base card", "standard", "standard card", "regular", "regular card"].includes(
    clean(value),
  );
}

const DISTINCTIVE_VARIATION_CUES = new Set([
  "acetate",
  "clear",
  "cut",
  "canvas",
  "outburst",
  "deluxe",
  "exclusives",
  "speckle",
  "sparkle",
  "shimmer",
  "wave",
  "mojo",
  "pulsar",
  "scope",
  "laser",
  "cracked",
  "ice",
  "disco",
  "reactive",
  "xfractor",
  "atomic",
  "sepia",
  "negative",
  "tie",
  "dye",
  "zebra",
  "camo",
  "genesis",
  "fluorescent",
  "refractor",
  "prizm",
  "prism",
  "holo",
  "foil",
  "limited",
  "superfractor",
  "sapphire",
  "diamond",
  "checkerboard",
  "velocity",
  "neon",
  "hyper",
  "flash",
  "fractal",
  "galactic",
  "cosmic",
  "rainbow",
  "red",
  "blue",
  "green",
  "gold",
  "silver",
  "purple",
  "orange",
  "pink",
  "black",
  "white",
  "yellow",
  "teal",
  "aqua",
  "bronze",
  "copper",
]);

function optionMatches(actual: string, option: string) {
  const optionTokens = tokens(option).filter(
    (token) => !["parallel", "variation", "card", "the"].includes(token),
  );
  return optionTokens.length > 0 && optionTokens.every((token) => tokens(actual).includes(token));
}

export function gradeInstaCompBenchmarkParallel(params: {
  expected: InstaCompBenchmarkParallelExpectation;
  actualParallel: string | null | undefined;
  actualSetName?: string | null;
}): InstaCompBenchmarkParallelGrade {
  const expected = params.expected;
  const actualParallel = clean(params.actualParallel);
  const actualIdentity = clean([params.actualSetName, params.actualParallel].filter(Boolean).join(" "));
  const expectedParallelOptions = [expected.parallel, ...(expected.parallelAliases || [])]
    .map(clean)
    .filter(Boolean);
  const expectedIdentity = clean(
    [expected.setName, ...(expected.setAliases || []), ...expectedParallelOptions].join(" "),
  );
  const expectedIsBase =
    !expectedParallelOptions.length || expectedParallelOptions.every((value) => isGenericBase(value));

  const unexpectedVariationTokens = tokens(actualParallel).filter(
    (token) => DISTINCTIVE_VARIATION_CUES.has(token) && !tokens(expectedIdentity).includes(token),
  );

  if (unexpectedVariationTokens.length) {
    return {
      status: "fail",
      note: `Unexpected variation cue(s): ${[...new Set(unexpectedVariationTokens)].join(", ")}.`,
    };
  }

  if (expectedIsBase) {
    if (isGenericBase(actualParallel)) return { status: "pass", note: null };

    const expectedYoungGuns = /\byoung guns\b/.test(expectedIdentity);
    if (expectedYoungGuns && ["young guns", "base young guns"].includes(actualParallel)) {
      return { status: "pass", note: null };
    }

    return {
      status: "fail",
      note: `Expected a base issue, but InstaComp returned ${params.actualParallel || "an unlabeled non-base value"}.`,
    };
  }

  if (expectedParallelOptions.some((option) => optionMatches(actualParallel, option))) {
    return { status: "pass", note: null };
  }

  // Some products print the variation as part of the set/subset name rather than
  // a separate parallel field. Accept that only when the full expected variation
  // is present and no contradictory cue was found above.
  if (expectedParallelOptions.some((option) => optionMatches(actualIdentity, option))) {
    return {
      status: actualParallel ? "pass" : "partial",
      note: actualParallel ? null : "Variation appeared in the set name but not the parallel field.",
    };
  }

  return {
    status: "fail",
    note: `Expected ${expected.parallel || "Base"}; got ${params.actualParallel || "no parallel"}.`,
  };
}
