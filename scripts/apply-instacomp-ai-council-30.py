from __future__ import annotations

from pathlib import Path
import re
import textwrap

ROUTE = Path("src/app/api/instacomp/scan/route.ts")
source = ROUTE.read_text(encoding="utf-8")


def replace_once(pattern: str, replacement: str, label: str, flags: int = re.S) -> None:
    global source
    updated, count = re.subn(pattern, lambda _match: replacement, source, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"Expected exactly one {label} replacement, found {count}.")
    source = updated


types_and_config = textwrap.dedent(
    r'''
    type InstaCompAiCouncilProvider = string;
    type InstaCompAiCouncilDetailMode = "full" | "ocr" | "parallel" | "context";
    type InstaCompAiCouncilProviderKind =
      | "openai"
      | "gemini"
      | "groq"
      | "ollama"
      | "openai_compatible";

    type InstaCompAiCouncilProviderConfig = {
      provider: InstaCompAiCouncilProvider;
      readerId: string;
      family: string;
      label: string;
      model: string;
      configured: boolean;
      kind: InstaCompAiCouncilProviderKind;
      detailMode: InstaCompAiCouncilDetailMode;
      baseUrl?: string;
      apiKey?: string;
    };

    type InstaCompAiCouncilReader = {
      provider: InstaCompAiCouncilProvider;
      readerId: string;
      family: string;
      label: string;
      model: string;
      detailMode: InstaCompAiCouncilDetailMode;
      voteEligible: boolean;
      ai: InstaCompAiResult;
      durationMs: number;
    };

    type InstaCompAiCouncilAttempt = {
      provider: InstaCompAiCouncilProvider;
      family: string;
      label: string;
      model: string;
      detailMode: InstaCompAiCouncilDetailMode;
      status: "completed" | "not_configured" | "error" | "skipped";
      durationMs: number | null;
      message: string | null;
    };

    type InstaCompAiCouncilRun = {
      tier: string;
      desiredReaders: number;
      availableReaders: number;
      completedReaders: number;
      votingReaders: number;
      configuredFamilies: string[];
      readers: InstaCompAiCouncilReader[];
      attempts: InstaCompAiCouncilAttempt[];
    };

    const INSTACOMP_AI_COUNCIL_MAX_READERS = 30;
    const requestedMinimumAiCouncilReaders = Number(
      process.env.INSTACOMP_AI_COUNCIL_MIN_READERS || 8,
    );
    const INSTACOMP_AI_COUNCIL_MIN_READERS = Number.isFinite(
      requestedMinimumAiCouncilReaders,
    )
      ? Math.max(
          1,
          Math.min(
            Math.floor(requestedMinimumAiCouncilReaders),
            INSTACOMP_AI_COUNCIL_MAX_READERS,
          ),
        )
      : 8;
    const INSTACOMP_AI_COUNCIL_ALWAYS_ON =
      process.env.INSTACOMP_AI_COUNCIL_ALWAYS_ON !== "false";

    function customAiCouncilProviderSlots(): InstaCompAiCouncilProviderConfig[] {
      return Array.from({ length: 14 }, (_, zeroBasedIndex) => {
        const slot = String(zeroBasedIndex + 1).padStart(2, "0");
        const prefix = `INSTACOMP_AI_COUNCIL_${slot}`;
        const baseUrl = process.env[`${prefix}_BASE_URL`]?.trim() || "";
        const apiKey = process.env[`${prefix}_API_KEY`]?.trim() || "";
        const model = process.env[`${prefix}_MODEL`]?.trim() || "";
        const family =
          process.env[`${prefix}_FAMILY`]?.trim().toLowerCase() ||
          `custom_${slot}`;
        const label =
          process.env[`${prefix}_LABEL`]?.trim() ||
          `Custom council reader ${slot}`;
        const requestedMode =
          process.env[`${prefix}_DETAIL_MODE`]?.trim().toLowerCase() || "full";
        const detailMode: InstaCompAiCouncilDetailMode =
          requestedMode === "ocr" ||
          requestedMode === "parallel" ||
          requestedMode === "context"
            ? requestedMode
            : "full";

        return {
          provider: `openai_compatible_${slot}`,
          readerId: `openai_compatible_${slot}`,
          family,
          label,
          model: model || "not-configured",
          configured: Boolean(baseUrl && apiKey && model),
          kind: "openai_compatible" as const,
          detailMode,
          baseUrl,
          apiKey,
        };
      });
    }
    '''
).strip()

replace_once(
    r'type InstaCompAiCouncilProvider =.*?type InstaCompAiCouncilRun = \{.*?\n\};',
    types_and_config,
    "AI council type/config block",
)

desired_readers = textwrap.dedent(
    r'''
    function desiredAiCouncilReaders(
      runSecondaryVision: boolean,
      requestedTier?: string | null,
    ) {
      const tier = aiCouncilTier(requestedTier);

      if (tier === "basic") return 0;
      if (tier === "mid") return Math.max(8, INSTACOMP_AI_COUNCIL_MIN_READERS);
      if (tier === "pro") return 12;
      if (tier === "dealer") return 16;
      if (tier === "high_end" || tier === "high-end") return 24;
      if (tier === "courtroom") return INSTACOMP_AI_COUNCIL_MAX_READERS;

      if (INSTACOMP_AI_COUNCIL_ALWAYS_ON) {
        return INSTACOMP_AI_COUNCIL_MIN_READERS;
      }

      return runSecondaryVision ? INSTACOMP_AI_COUNCIL_MIN_READERS : 0;
    }

    function dataUrlMimeType(dataUrl: string) {
    '''
).strip()

replace_once(
    r'function desiredAiCouncilReaders\(.*?\n\}\n\nfunction dataUrlMimeType\(dataUrl: string\) \{',
    desired_readers,
    "desired reader policy",
)

council_implementation = textwrap.dedent(
    r'''
    function aiCouncilDetailImages(
      mode: InstaCompAiCouncilDetailMode,
      detailImages: InstaCompDetailImage[],
    ) {
      if (mode === "context") return [];
      if (mode === "full") return detailImages.slice(0, 8);

      const pattern =
        mode === "ocr"
          ? /serial|number|text|back|label|stamp|top-right|bottom|card-no/i
          : /parallel|foil|surface|front|edge|border|color|pattern|refractor/i;
      const focused = detailImages.filter((image) => pattern.test(image.name));
      return (focused.length ? focused : detailImages).slice(0, 8);
    }

    function builtInAiCouncilProviderPlan(): InstaCompAiCouncilProviderConfig[] {
      const openAiConfigured = Boolean(OPENAI_API_KEY);
      const geminiConfigured = Boolean(GEMINI_API_KEY);
      const groqConfigured = Boolean(GROQ_API_KEY);
      const ollamaConfigured = Boolean(OLLAMA_BASE_URL);

      return [
        {
          provider: "openai_primary_full",
          readerId: "openai_primary_full",
          family: "openai",
          label: "OpenAI primary full-card reader",
          model: INSTACOMP_OPENAI_MODEL,
          configured: openAiConfigured,
          kind: "openai",
          detailMode: "full",
        },
        {
          provider: "gemini_full",
          readerId: "gemini_full",
          family: "gemini",
          label: "Gemini full-card reader",
          model: INSTACOMP_GEMINI_MODEL,
          configured: geminiConfigured,
          kind: "gemini",
          detailMode: "full",
        },
        {
          provider: "groq_full",
          readerId: "groq_full",
          family: "groq",
          label: "Groq full-card reader",
          model: INSTACOMP_GROQ_MODEL,
          configured: groqConfigured,
          kind: "groq",
          detailMode: "full",
        },
        {
          provider: "openai_fallback_ocr",
          readerId: "openai_fallback_ocr",
          family: "openai",
          label: "OpenAI back and OCR reader",
          model: INSTACOMP_OPENAI_FALLBACK_MODEL,
          configured: openAiConfigured,
          kind: "openai",
          detailMode: "ocr",
        },
        {
          provider: "gemini_ocr",
          readerId: "gemini_ocr",
          family: "gemini",
          label: "Gemini back and OCR reader",
          model: INSTACOMP_GEMINI_MODEL,
          configured: geminiConfigured,
          kind: "gemini",
          detailMode: "ocr",
        },
        {
          provider: "groq_ocr",
          readerId: "groq_ocr",
          family: "groq",
          label: "Groq back and OCR reader",
          model: INSTACOMP_GROQ_MODEL,
          configured: groqConfigured,
          kind: "groq",
          detailMode: "ocr",
        },
        {
          provider: "openai_primary_parallel",
          readerId: "openai_primary_parallel",
          family: "openai",
          label: "OpenAI parallel and surface reader",
          model: INSTACOMP_OPENAI_MODEL,
          configured: openAiConfigured,
          kind: "openai",
          detailMode: "parallel",
        },
        {
          provider: "ollama_full",
          readerId: "ollama_full",
          family: "ollama",
          label: "Local Ollama full-card reader",
          model: INSTACOMP_OLLAMA_MODEL,
          configured: ollamaConfigured,
          kind: "ollama",
          detailMode: "full",
        },
        {
          provider: "openai_fallback_context",
          readerId: "openai_fallback_context",
          family: "openai",
          label: "OpenAI clean-context reader",
          model: INSTACOMP_OPENAI_FALLBACK_MODEL,
          configured: openAiConfigured,
          kind: "openai",
          detailMode: "context",
        },
        {
          provider: "gemini_parallel",
          readerId: "gemini_parallel",
          family: "gemini",
          label: "Gemini parallel and surface reader",
          model: INSTACOMP_GEMINI_MODEL,
          configured: geminiConfigured,
          kind: "gemini",
          detailMode: "parallel",
        },
        {
          provider: "groq_parallel",
          readerId: "groq_parallel",
          family: "groq",
          label: "Groq parallel and surface reader",
          model: INSTACOMP_GROQ_MODEL,
          configured: groqConfigured,
          kind: "groq",
          detailMode: "parallel",
        },
        {
          provider: "openai_primary_ocr",
          readerId: "openai_primary_ocr",
          family: "openai",
          label: "OpenAI primary OCR reader",
          model: INSTACOMP_OPENAI_MODEL,
          configured: openAiConfigured,
          kind: "openai",
          detailMode: "ocr",
        },
        {
          provider: "openai_fallback_full",
          readerId: "openai_fallback_full",
          family: "openai",
          label: "OpenAI fallback full-card reader",
          model: INSTACOMP_OPENAI_FALLBACK_MODEL,
          configured: openAiConfigured,
          kind: "openai",
          detailMode: "full",
        },
        {
          provider: "ollama_ocr",
          readerId: "ollama_ocr",
          family: "ollama",
          label: "Local Ollama OCR reader",
          model: INSTACOMP_OLLAMA_MODEL,
          configured: ollamaConfigured,
          kind: "ollama",
          detailMode: "ocr",
        },
        {
          provider: "openai_primary_context",
          readerId: "openai_primary_context",
          family: "openai",
          label: "OpenAI primary clean-context reader",
          model: INSTACOMP_OPENAI_MODEL,
          configured: openAiConfigured,
          kind: "openai",
          detailMode: "context",
        },
        {
          provider: "openai_fallback_parallel",
          readerId: "openai_fallback_parallel",
          family: "openai",
          label: "OpenAI fallback parallel reader",
          model: INSTACOMP_OPENAI_FALLBACK_MODEL,
          configured: openAiConfigured,
          kind: "openai",
          detailMode: "parallel",
        },
      ];
    }

    function buildAiCouncilProviderPlan() {
      return [
        ...builtInAiCouncilProviderPlan(),
        ...customAiCouncilProviderSlots(),
      ].slice(0, INSTACOMP_AI_COUNCIL_MAX_READERS);
    }

    async function identifyCardWithOpenAiCompatibleCouncilProvider(
      config: InstaCompAiCouncilProviderConfig,
      frontDataUrl: string,
      backDataUrl: string | undefined,
      detailImages: InstaCompDetailImage[],
      externalOcr: ExternalOcrResult | null,
    ) {
      if (!config.baseUrl || !config.apiKey) {
        throw new Error(`${config.label} is missing its base URL or API key.`);
      }

      const content: any[] = [
        {
          type: "text",
          text: buildAiCouncilPrompt({
            externalOcr,
            providerLabel: config.label,
          }),
        },
        { type: "text", text: "FRONT IMAGE" },
        { type: "image_url", image_url: { url: frontDataUrl } },
      ];

      if (backDataUrl) {
        content.push(
          { type: "text", text: "BACK IMAGE" },
          { type: "image_url", image_url: { url: backDataUrl } },
        );
      }

      for (const image of detailImages) {
        content.push(
          { type: "text", text: `DETAIL IMAGE: ${image.name}` },
          { type: "image_url", image_url: { url: image.dataUrl } },
        );
      }

      const response = await providerFetch(
        `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.model,
            temperature: 0,
            messages: [{ role: "user", content }],
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `${config.label} scan failed: ${(await response.text()).slice(0, 1000)}`,
        );
      }

      const data = await response.json();
      const rawContent = data?.choices?.[0]?.message?.content;
      const text = Array.isArray(rawContent)
        ? rawContent
            .map((part: any) =>
              typeof part === "string" ? part : String(part?.text || ""),
            )
            .join("\n")
        : rawContent;

      if (!text) throw new Error(`${config.label} returned no scan content.`);
      return normalizeInstaCompAiResult(parseAiJsonText(text));
    }

    async function runAiCouncilReader(params: {
      config: InstaCompAiCouncilProviderConfig;
      frontDataUrl: string;
      backDataUrl?: string;
      detailImages: InstaCompDetailImage[];
      externalOcr: ExternalOcrResult | null;
    }): Promise<{
      reader: InstaCompAiCouncilReader | null;
      attempt: InstaCompAiCouncilAttempt;
    }> {
      const startedAt = Date.now();
      const providerMeta = params.config;

      if (!providerMeta.configured) {
        return {
          reader: null,
          attempt: {
            provider: providerMeta.provider,
            family: providerMeta.family,
            label: providerMeta.label,
            model: providerMeta.model,
            detailMode: providerMeta.detailMode,
            status: "not_configured",
            durationMs: null,
            message: "Provider key, model, or base URL is not configured.",
          },
        };
      }

      const focusedDetails = aiCouncilDetailImages(
        providerMeta.detailMode,
        params.detailImages,
      );

      try {
        const timeoutMs =
          providerMeta.kind === "ollama"
            ? INSTACOMP_OLLAMA_COUNCIL_TIMEOUT_MS
            : INSTACOMP_AI_COUNCIL_TIMEOUT_MS;
        const ai = await withAiCouncilTimeout(
          providerMeta.kind === "openai"
            ? identifyCardWithOpenAI(
                params.frontDataUrl,
                params.backDataUrl,
                focusedDetails,
                params.externalOcr,
                {
                  readerFocus: "secondary_consensus",
                  models: [providerMeta.model],
                },
              )
            : providerMeta.kind === "gemini"
              ? identifyCardWithGemini(
                  params.frontDataUrl,
                  params.backDataUrl,
                  focusedDetails,
                  params.externalOcr,
                )
              : providerMeta.kind === "groq"
                ? identifyCardWithGroq(
                    params.frontDataUrl,
                    params.backDataUrl,
                    focusedDetails,
                    params.externalOcr,
                  )
                : providerMeta.kind === "ollama"
                  ? identifyCardWithOllama(
                      params.frontDataUrl,
                      params.backDataUrl,
                      focusedDetails,
                      params.externalOcr,
                    )
                  : identifyCardWithOpenAiCompatibleCouncilProvider(
                      providerMeta,
                      params.frontDataUrl,
                      params.backDataUrl,
                      focusedDetails,
                      params.externalOcr,
                    ),
          providerMeta.label,
          timeoutMs,
        );
        const durationMs = Date.now() - startedAt;

        return {
          reader: {
            provider: providerMeta.provider,
            readerId: providerMeta.readerId,
            family: providerMeta.family,
            label: providerMeta.label,
            model: providerMeta.model,
            detailMode: providerMeta.detailMode,
            voteEligible: false,
            ai,
            durationMs,
          },
          attempt: {
            provider: providerMeta.provider,
            family: providerMeta.family,
            label: providerMeta.label,
            model: providerMeta.model,
            detailMode: providerMeta.detailMode,
            status: "completed",
            durationMs,
            message: null,
          },
        };
      } catch (error: any) {
        return {
          reader: null,
          attempt: {
            provider: providerMeta.provider,
            family: providerMeta.family,
            label: providerMeta.label,
            model: providerMeta.model,
            detailMode: providerMeta.detailMode,
            status: "error",
            durationMs: Date.now() - startedAt,
            message: String(error?.message || error).slice(0, 500),
          },
        };
      }
    }

    function aiCouncilEvidenceScore(ai: InstaCompAiResult) {
      const record = ai as unknown as Record<string, unknown>;
      const keys = [
        "player",
        "year",
        "manufacturer",
        "brand",
        "set",
        "setName",
        "product",
        "cardNumber",
        "parallel",
        "serialNumber",
        "team",
        "sport",
      ];
      const populated = keys.reduce((score, key) => {
        const value = record[key];
        return value !== null && value !== undefined && String(value).trim()
          ? score + 1
          : score;
      }, 0);
      const confidence = Number(record.confidence || 0);
      return populated * 100 + (Number.isFinite(confidence) ? confidence : 0);
    }

    function markAiCouncilFamilyWinners(readers: InstaCompAiCouncilReader[]) {
      const winners = new Map<string, InstaCompAiCouncilReader>();

      readers.forEach((reader) => {
        const current = winners.get(reader.family);
        if (
          !current ||
          aiCouncilEvidenceScore(reader.ai) > aiCouncilEvidenceScore(current.ai) ||
          (aiCouncilEvidenceScore(reader.ai) === aiCouncilEvidenceScore(current.ai) &&
            reader.durationMs < current.durationMs)
        ) {
          winners.set(reader.family, reader);
        }
      });

      return readers.map((reader) => ({
        ...reader,
        voteEligible: winners.get(reader.family)?.readerId === reader.readerId,
      }));
    }

    async function runInstaCompAiCouncil(params: {
      runSecondaryVision: boolean;
      requestedTier?: string | null;
      frontDataUrl: string;
      backDataUrl?: string;
      detailImages: InstaCompDetailImage[];
      externalOcr: ExternalOcrResult | null;
    }): Promise<InstaCompAiCouncilRun> {
      const desiredReaders = desiredAiCouncilReaders(
        params.runSecondaryVision,
        params.requestedTier,
      );
      const tier = aiCouncilTier(params.requestedTier);
      const providerPlan = buildAiCouncilProviderPlan();
      const configuredPlan = providerPlan.filter((provider) => provider.configured);
      const configuredFamilies = Array.from(
        new Set(configuredPlan.map((provider) => provider.family)),
      );

      if (desiredReaders <= 0) {
        return {
          tier,
          desiredReaders,
          availableReaders: configuredPlan.length,
          completedReaders: 0,
          votingReaders: 0,
          configuredFamilies,
          readers: [],
          attempts: providerPlan.slice(0, 8).map((provider) => ({
            provider: provider.provider,
            family: provider.family,
            label: provider.label,
            model: provider.model,
            detailMode: provider.detailMode,
            status: "skipped",
            durationMs: null,
            message: "This tier explicitly disabled the AI backup council.",
          })),
        };
      }

      const allAttempts: Array<{
        reader: InstaCompAiCouncilReader | null;
        attempt: InstaCompAiCouncilAttempt;
      }> = [];
      let cursor = 0;
      let completedReaders = 0;

      while (
        completedReaders < desiredReaders &&
        cursor < configuredPlan.length
      ) {
        const needed = desiredReaders - completedReaders;
        const batch = configuredPlan.slice(cursor, cursor + needed);
        cursor += batch.length;
        if (!batch.length) break;

        const batchAttempts = await Promise.all(
          batch.map((config) =>
            runAiCouncilReader({
              config,
              frontDataUrl: params.frontDataUrl,
              backDataUrl: params.backDataUrl,
              detailImages: params.detailImages,
              externalOcr: params.externalOcr,
            }),
          ),
        );
        allAttempts.push(...batchAttempts);
        completedReaders = allAttempts.filter((attempt) => attempt.reader).length;
      }

      const rawReaders = allAttempts.flatMap((attempt) =>
        attempt.reader ? [attempt.reader] : [],
      );
      const readers = markAiCouncilFamilyWinners(rawReaders);
      const missingCapacity = Math.max(0, desiredReaders - configuredPlan.length);
      const unconfiguredAttempts = providerPlan
        .filter((provider) => !provider.configured)
        .slice(0, missingCapacity)
        .map((provider): InstaCompAiCouncilAttempt => ({
          provider: provider.provider,
          family: provider.family,
          label: provider.label,
          model: provider.model,
          detailMode: provider.detailMode,
          status: "not_configured",
          durationMs: null,
          message: "Additional backup reader capacity is not configured.",
        }));

      return {
        tier,
        desiredReaders,
        availableReaders: configuredPlan.length,
        completedReaders: readers.length,
        votingReaders: readers.filter((reader) => reader.voteEligible).length,
        configuredFamilies,
        readers,
        attempts: [
          ...allAttempts.map((attempt) => attempt.attempt),
          ...unconfiguredAttempts,
        ],
      };
    }

    async function detectSerialNumberWithOpenAI(
    '''
).strip()

replace_once(
    r'async function runAiCouncilReader\(params: \{.*?\n\}\n\nasync function detectSerialNumberWithOpenAI\(',
    council_implementation,
    "AI council implementation",
)

source, vote_filter_count = re.subn(
    r'params\.aiCouncil\.readers\.forEach\(\(councilReader, index\) => \{',
    'params.aiCouncil.readers\n    .filter((councilReader) => councilReader.voteEligible)\n    .forEach((councilReader, index) => {',
    source,
    count=1,
)
if vote_filter_count != 1:
    raise SystemExit(
        f"Expected exactly one council vote-filter replacement, found {vote_filter_count}."
    )

ROUTE.write_text(source, encoding="utf-8")
print("Expanded InstaComp AI council to 8-30 readers with family-capped voting.")
