export type ManualPurchasePhotoPair = {
  front: File;
  back: File | null;
  files: File[];
  pairing: "named" | "ordered";
};

function stem(name: string) {
  return String(name || "").replace(/\.[^.]+$/, "");
}

function explicitSide(name: string): "front" | "back" | null {
  const value = stem(name).toLowerCase();
  if (/(^|[\s._-])(front|obverse)(?=$|[\s._-]|\d)/i.test(value) || /[\s._-]f$/i.test(value)) {
    return "front";
  }
  if (/(^|[\s._-])(back|reverse)(?=$|[\s._-]|\d)/i.test(value) || /[\s._-]b$/i.test(value)) {
    return "back";
  }
  return null;
}

function pairKey(name: string) {
  return stem(name)
    .toLowerCase()
    .replace(/(^|[\s._-])(front|back|obverse|reverse)(?=$|[\s._-]|\d)/gi, "$1")
    .replace(/[\s._-][fb]$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function pairManualPurchaseCardPhotos(files: File[]): ManualPurchasePhotoPair[] {
  const input = files.filter((file) => file instanceof File);
  const used = new Set<number>();
  const pairs: Array<ManualPurchasePhotoPair & { firstIndex: number }> = [];
  const named = new Map<string, { fronts: number[]; backs: number[] }>();

  input.forEach((file, index) => {
    const side = explicitSide(file.name);
    if (!side) return;
    const key = pairKey(file.name) || `named-${index}`;
    const bucket = named.get(key) || { fronts: [], backs: [] };
    bucket[side === "front" ? "fronts" : "backs"].push(index);
    named.set(key, bucket);
  });

  for (const bucket of named.values()) {
    const count = Math.min(bucket.fronts.length, bucket.backs.length);
    for (let i = 0; i < count; i += 1) {
      const frontIndex = bucket.fronts[i];
      const backIndex = bucket.backs[i];
      used.add(frontIndex);
      used.add(backIndex);
      pairs.push({
        front: input[frontIndex],
        back: input[backIndex],
        files: [input[frontIndex], input[backIndex]],
        pairing: "named",
        firstIndex: Math.min(frontIndex, backIndex),
      });
    }
  }

  const remaining = input.map((file, index) => ({ file, index })).filter(({ index }) => !used.has(index));
  for (let i = 0; i < remaining.length; i += 2) {
    const front = remaining[i];
    const back = remaining[i + 1] || null;
    pairs.push({
      front: front.file,
      back: back?.file || null,
      files: back ? [front.file, back.file] : [front.file],
      pairing: "ordered",
      firstIndex: front.index,
    });
  }

  return pairs.sort((a, b) => a.firstIndex - b.firstIndex).map((pair) => ({
    front: pair.front,
    back: pair.back,
    files: pair.files,
    pairing: pair.pairing,
  }));
}
