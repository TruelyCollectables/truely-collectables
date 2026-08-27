export type NormalizedInscriptionSubjects = {
  subjects: string[];
  variation: string | null;
  inscriptions: string[];
  changed: boolean;
};

function clean(value: string | null | undefined) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function inscriptionContext(values: Array<string | null | undefined>) {
  return values.some((value) =>
    /\b(inscription|inscriptions|inscribed|nickname|nicknames|message|messages)\b/i.test(
      clean(value),
    ),
  );
}

function splitInscription(value: string, allowMalformed: boolean) {
  const normalized = clean(value);
  if (!normalized) return null;

  const balanced = normalized.match(
    /^(.*?)\s*(?:-|:)\s*"([^"\r\n]+)"\s*$/,
  );
  if (balanced) {
    const subject = clean(balanced[1]);
    const inscription = clean(balanced[2]);
    return subject && inscription ? { subject, inscription } : null;
  }

  const attachedBalanced = normalized.match(/^(.*?)\s+"([^"\r\n]+)"\s*$/);
  if (attachedBalanced) {
    const subject = clean(attachedBalanced[1]);
    const inscription = clean(attachedBalanced[2]);
    return subject && inscription ? { subject, inscription } : null;
  }

  if (!allowMalformed) return null;

  const trailingQuote = normalized.match(
    /^(.*?)\s*(?:-|:)\s*"?([^"\r\n]+)"\s*$/,
  );
  if (!trailingQuote) return null;
  const subject = clean(trailingQuote[1]);
  const inscription = clean(trailingQuote[2]);
  return subject && inscription ? { subject, inscription } : null;
}

function appendVariation(
  current: string | null | undefined,
  inscriptions: string[],
) {
  const values = clean(current)
    ? clean(current)
        .split(/\s*;\s*/)
        .map(clean)
        .filter(Boolean)
    : [];
  const comparable = new Set(values.map((value) => value.toLowerCase()));
  for (const inscription of inscriptions) {
    const entry = `Inscription: ${inscription}`;
    if (!comparable.has(entry.toLowerCase())) {
      values.push(entry);
      comparable.add(entry.toLowerCase());
    }
  }
  return values.length ? values.join("; ") : null;
}

export function normalizeInscribedSubjects(params: {
  subjects: string[];
  variation?: string | null;
  context?: Array<string | null | undefined>;
}): NormalizedInscriptionSubjects {
  const context = params.context || [];
  const explicitContext = inscriptionContext(context);
  const subjects: string[] = [];
  const inscriptions: string[] = [];
  let changed = false;

  for (const rawSubject of params.subjects) {
    const normalized = clean(rawSubject);
    if (!normalized) continue;
    const parsed = splitInscription(normalized, explicitContext);
    if (!parsed) {
      subjects.push(normalized);
      continue;
    }
    subjects.push(parsed.subject);
    inscriptions.push(parsed.inscription);
    changed = true;
  }

  return {
    subjects: [...new Set(subjects)],
    variation: appendVariation(params.variation, inscriptions),
    inscriptions: [...new Set(inscriptions)],
    changed,
  };
}
