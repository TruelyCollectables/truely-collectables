from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    file_path = ROOT / path
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one anchor, found {count}: {old[:120]!r}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


# ---- Website teacher council -------------------------------------------------
replace_once(
    "src/lib/instacomp-teacher-market-provider.ts",
    'import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";\n',
    'import { sanitizeInstaCompProviderError } from "./instacomp-provider-safety";\n'
    'import {\n'
    '  buildFreeCriticPrompt,\n'
    '  runCloudflareCritic,\n'
    '  runGroqBrowserTeacher,\n'
    '  runOpenRouterCritic,\n'
    '} from "./instacomp-free-comp-teachers";\n'
    'import {\n'
    '  requestInstaCompStudentCompHypothesis,\n'
    '  type InstaCompStudentCompHypothesis,\n'
    '} from "./instacomp-student-comp-bridge";\n',
)
replace_once(
    "src/lib/instacomp-teacher-market-provider.ts",
    '  process.env.INSTACOMP_TEACHER_GROQ_MODEL || "groq/compound",\n',
    '  process.env.INSTACOMP_TEACHER_GROQ_MODEL || "groq/compound-mini",\n',
)
replace_once(
    "src/lib/instacomp-teacher-market-provider.ts",
    'const MAX_ROWS_PER_TEACHER = 12;\n',
    'const MAX_ROWS_PER_TEACHER = 8;\n',
)
replace_once(
    "src/lib/instacomp-teacher-market-provider.ts",
    'export type TeacherName = "gemini" | "anthropic" | "xai" | "groq" | "perplexity";\n',
    'export type TeacherName =\n'
    '  | "gemini"\n'
    '  | "anthropic"\n'
    '  | "xai"\n'
    '  | "groq"\n'
    '  | "groq_browser"\n'
    '  | "perplexity"\n'
    '  | "openrouter"\n'
    '  | "cloudflare";\n',
)
replace_once(
    "src/lib/instacomp-teacher-market-provider.ts",
    'export type TeacherConsensusMarketResult = {\n  configuredTeachers: TeacherName[];\n',
    'export type TeacherConsensusMarketResult = {\n  studentHypothesis: InstaCompStudentCompHypothesis;\n  configuredTeachers: TeacherName[];\n',
)
replace_once(
    "src/lib/instacomp-teacher-market-provider.ts",
    '          generationConfig: {\n            responseMimeType: "application/json",\n            responseSchema: geminiSchema(),\n          },\n',
    '          generationConfig: {\n            responseMimeType: "application/json",\n          },\n',
)
replace_once(
    "src/lib/instacomp-teacher-market-provider.ts",
    '            enabled_tools: ["web_search", "visit_website"],\n',
    '            enabled_tools: ["web_search"],\n',
)
old_orchestration = '''  const prompt = teacherPrompt(params.exactTitle, params.ai);\n  const attempts = await Promise.all([\n    runGemini(prompt),\n    runAnthropic(prompt),\n    runXai(prompt),\n    runGroq(prompt),\n    runPerplexity(params.exactTitle),\n  ]);\n  const votingAttempts = attempts.filter((attempt) => attempt.teacher !== "perplexity");\n  const configuredTeachers = votingAttempts\n    .filter((attempt) => attempt.configured)\n    .map((attempt) => attempt.teacher);\n  const requiredVotes = requiredTeacherVotes(configuredTeachers.length);\n  const sold = consensusSold(votingAttempts, params.ai, requiredVotes);\n  const discoverySold = attempts.flatMap((attempt) =>\n    attempt.ok ? strictTeacherRows(attempt, "sold", params.ai) : [],\n  );\n  const discoveryActive = attempts.flatMap((attempt) =>\n    attempt.ok ? strictTeacherRows(attempt, "active", params.ai) : [],\n  );\n  const healthy = attempts.filter((attempt) => attempt.ok).length;\n\n  return {\n    configuredTeachers,\n'''
new_orchestration = '''  const prompt = teacherPrompt(params.exactTitle, params.ai);\n  const [studentHypothesis, searchAttempts] = await Promise.all([\n    requestInstaCompStudentCompHypothesis({ exactTitle: params.exactTitle, ai: params.ai }),\n    Promise.all([\n      runGemini(prompt),\n      runAnthropic(prompt),\n      runXai(prompt),\n      runGroq(prompt),\n      runGroqBrowserTeacher(prompt),\n      runPerplexity(params.exactTitle),\n    ]),\n  ]);\n\n  const criticPrompt = buildFreeCriticPrompt({\n    exactTitle: params.exactTitle,\n    ai: params.ai,\n    soldCandidates: searchAttempts.flatMap((attempt) => attempt.ok ? attempt.sold : []).slice(0, 20),\n    activeCandidates: searchAttempts.flatMap((attempt) => attempt.ok ? attempt.active : []).slice(0, 20),\n  });\n  const criticAttempts = await Promise.all([\n    runOpenRouterCritic(criticPrompt),\n    runCloudflareCritic(criticPrompt),\n  ]);\n  const attempts: TeacherAttempt[] = [...searchAttempts, ...criticAttempts];\n  const votingAttempts = searchAttempts.filter((attempt) => attempt.teacher !== "perplexity");\n  const configuredTeachers = votingAttempts\n    .filter((attempt) => attempt.configured)\n    .map((attempt) => attempt.teacher);\n  const requiredVotes = requiredTeacherVotes(configuredTeachers.length);\n  const sold = consensusSold(votingAttempts, params.ai, requiredVotes);\n  const discoverySold = searchAttempts.flatMap((attempt) =>\n    attempt.ok ? strictTeacherRows(attempt, "sold", params.ai) : [],\n  );\n  const discoveryActive = searchAttempts.flatMap((attempt) =>\n    attempt.ok ? strictTeacherRows(attempt, "active", params.ai) : [],\n  );\n  const healthy = attempts.filter((attempt) => attempt.ok).length;\n\n  return {\n    studentHypothesis,\n    configuredTeachers,\n'''
replace_once("src/lib/instacomp-teacher-market-provider.ts", old_orchestration, new_orchestration)

# ---- Website learning receipt / diagnostics ---------------------------------
replace_once(
    "src/lib/instacomp-teacher-learning-bridge.ts",
    '  canonicalIdentity: Record<string, unknown>;\n',
    '  canonicalIdentity: Record<string, unknown>;\n  studentHypothesis?: Record<string, unknown> | null;\n',
)
replace_once(
    "src/app/api/instacomp/live-scan/route.ts",
    '          attempts: teacher.attempts,\n        }\n      : null,\n',
    '          attempts: teacher.attempts,\n          studentHypothesis: teacher.studentHypothesis,\n        }\n      : null,\n',
)
replace_once(
    "src/app/api/instacomp/live-scan/route.ts",
    '        canonicalIdentity: ai as unknown as Record<string, unknown>,\n        teacherConsensus: {\n',
    '        canonicalIdentity: ai as unknown as Record<string, unknown>,\n        studentHypothesis: teacher.studentHypothesis as unknown as Record<string, unknown>,\n        teacherConsensus: {\n',
)

# ---- Mac receipt persistence / training dataset ------------------------------
replace_once(
    "services/instacomp-ai/app/teacher_comp_learning.py",
    '    canonical_identity_complete = all(\n        _text(canonical_identity.get(field), 300)\n        for field in ("player", "year", "brand", "setName", "cardNumber")\n    )\n\n    # Market truth can only become student training material when independent\n',
    '    canonical_identity_complete = all(\n        _text(canonical_identity.get(field), 300)\n        for field in ("player", "year", "brand", "setName", "cardNumber")\n    )\n\n    student_hypothesis = body.get("studentHypothesis") or body.get("student_hypothesis")\n    if not isinstance(student_hypothesis, dict):\n        student_hypothesis = None\n    elif student_hypothesis:\n        student_hypothesis = {\n            "status": _text(student_hypothesis.get("status"), 40),\n            "studentMode": True,\n            "learnMode": True,\n            "pricingAuthority": False,\n            "marketTruth": False,\n            "model": _text(student_hypothesis.get("model"), 160) or None,\n            "trainingMemoryExamples": max(0, int(_number(student_hypothesis.get("trainingMemoryExamples")) or 0)),\n            "predictedMedian": _number(student_hypothesis.get("predictedMedian")),\n            "predictedLow": _number(student_hypothesis.get("predictedLow")),\n            "predictedHigh": _number(student_hypothesis.get("predictedHigh")),\n            "confidence": max(0.0, min(1.0, _number(student_hypothesis.get("confidence")) or 0.0)),\n            "rationale": _text(student_hypothesis.get("rationale"), 1800),\n            "uncertainty": [\n                _text(value, 300)\n                for value in (student_hypothesis.get("uncertainty") if isinstance(student_hypothesis.get("uncertainty"), list) else [])\n                if _text(value, 300)\n            ][:12],\n        }\n\n    # Market truth can only become student training material when independent\n',
)
replace_once(
    "services/instacomp-ai/app/teacher_comp_learning.py",
    '        "canonicalIdentity": canonical_identity,\n        "teacherConsensus": {\n',
    '        "canonicalIdentity": canonical_identity,\n        "studentHypothesis": student_hypothesis,\n        "teacherConsensus": {\n',
)
replace_once(
    "services/instacomp-ai/app/teacher_comp_training.py",
    '    discovery_active = receipt.get("discoveryActiveComps") or []\n',
    '    discovery_active = receipt.get("discoveryActiveComps") or []\n    student_hypothesis = receipt.get("studentHypothesis")\n    if not isinstance(student_hypothesis, dict):\n        student_hypothesis = None\n',
)
replace_once(
    "services/instacomp-ai/app/teacher_comp_training.py",
    '            "active_candidates": discovery_active[:100],\n        },\n        "target": {\n',
    '            "active_candidates": discovery_active[:100],\n            "student_pre_teacher_hypothesis": student_hypothesis,\n        },\n        "target": {\n',
)
replace_once(
    "services/instacomp-ai/app/teacher_comp_training.py",
    '        "student_mode": True,\n        "pricing_authority": False,\n        "auto_promotion": False,\n        "identity_training_separated": True,\n',
    '        "student_mode": True,\n        "online_comp_learn_mode": True,\n        "pricing_authority": False,\n        "auto_promotion": False,\n        "identity_training_separated": True,\n',
)
# The manifest has the same boundary block a second time.
replace_once(
    "services/instacomp-ai/app/teacher_comp_training.py",
    '        "student_mode": True,\n        "pricing_authority": False,\n        "auto_promotion": False,\n        "identity_training_separated": True,\n    }\n    manifest_path.write_text',
    '        "student_mode": True,\n        "online_comp_learn_mode": True,\n        "pricing_authority": False,\n        "auto_promotion": False,\n        "identity_training_separated": True,\n    }\n    manifest_path.write_text',
)

# ---- Safe runtime configuration ----------------------------------------------
replace_once(
    "src/lib/instacomp-teacher-runtime-status.ts",
    '  groqConfigured: boolean;\n  perplexityConfigured: boolean;\n',
    '  groqConfigured: boolean;\n  groqBrowserConfigured: boolean;\n  openRouterConfigured: boolean;\n  cloudflareConfigured: boolean;\n  perplexityConfigured: boolean;\n',
)
replace_once(
    "src/lib/instacomp-teacher-runtime-status.ts",
    '  macLearningBridgeConfigured: boolean;\n};\n',
    '  macLearningBridgeConfigured: boolean;\n  onlineCompLearnMode: true;\n};\n',
)
replace_once(
    "src/lib/instacomp-teacher-runtime-status.ts",
    '  const groqConfigured = configured(env.GROQ_API_KEY);\n  const perplexityConfigured = configured(env.PERPLEXITY_API_KEY);\n',
    '  const groqConfigured = configured(env.GROQ_API_KEY);\n  const groqBrowserConfigured = groqConfigured;\n  const openRouterConfigured = configured(env.OPENROUTER_API_KEY);\n  const cloudflareConfigured = Boolean(\n    configured(env.CLOUDFLARE_ACCOUNT_ID) && configured(env.CLOUDFLARE_AUTH_TOKEN || env.CLOUDFLARE_API_TOKEN),\n  );\n  const perplexityConfigured = configured(env.PERPLEXITY_API_KEY);\n',
)
replace_once(
    "src/lib/instacomp-teacher-runtime-status.ts",
    '    groqConfigured,\n  ].filter(Boolean).length;\n',
    '    groqConfigured,\n    groqBrowserConfigured,\n  ].filter(Boolean).length;\n',
)
replace_once(
    "src/lib/instacomp-teacher-runtime-status.ts",
    '    groqConfigured,\n    perplexityConfigured,\n',
    '    groqConfigured,\n    groqBrowserConfigured,\n    openRouterConfigured,\n    cloudflareConfigured,\n    perplexityConfigured,\n',
)
replace_once(
    "src/lib/instacomp-teacher-runtime-status.ts",
    '    macLearningBridgeConfigured,\n  };\n',
    '    macLearningBridgeConfigured,\n    onlineCompLearnMode: true,\n  };\n',
)

# ---- Existing teacher simulation: include browser lane, critics, Gemini fix --
replace_once(
    "scripts/run-instacomp-teacher-market-provider-simulations.ts",
    '  process.env.GROQ_API_KEY = "test-groq";\n  delete process.env.PERPLEXITY_API_KEY;\n',
    '  process.env.GROQ_API_KEY = "test-groq";\n  process.env.OPENROUTER_API_KEY = "test-openrouter";\n  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";\n  process.env.CLOUDFLARE_AUTH_TOKEN = "test-cloudflare";\n  delete process.env.PERPLEXITY_API_KEY;\n  delete process.env.INSTACOMP_AI_LOCAL_URL;\n  delete process.env.INSTACOMP_AI_LOCAL_KEY;\n',
)
replace_once(
    "scripts/run-instacomp-teacher-market-provider-simulations.ts",
    '      assert.match(prompt, /NEVER sold comps/i);\n      psaGuardrailChecked = true;\n',
    '      assert.match(prompt, /NEVER sold comps/i);\n      assert.equal(requestBody?.generationConfig?.responseMimeType, "application/json");\n      assert.equal(requestBody?.generationConfig?.responseSchema, undefined);\n      psaGuardrailChecked = true;\n',
)
old_groq_mock = '''    if (url.includes("api.groq.com")) {\n      const requestBody = JSON.parse(String(init?.body || "{}"));\n      assert.equal(requestBody.model, "groq/compound");\n      assert.deepEqual(requestBody.response_format, { type: "json_object" });\n      assert.deepEqual(requestBody.compound_custom?.tools?.enabled_tools, [\n        "web_search",\n        "visit_website",\n      ]);\n      assert.deepEqual(requestBody.search_settings?.include_domains, expectedDomains);\n      assert.equal(requestBody.search_settings?.country, "united states");\n      const headers = new Headers(init?.headers);\n      assert.equal(headers.get("Groq-Model-Version"), "latest");\n      groqContractChecked = true;\n\n      const groqSold = disagreement\n        ? { ...sharedSold, url: "https://www.ebay.com/itm/777777777777" }\n        : sharedSold;\n      return new Response(\n        JSON.stringify({\n          choices: [\n            {\n              message: {\n                content: JSON.stringify({\n                  sold: [groqSold],\n                  active: [],\n                  notes: "Groq Compound independently checked the sale.",\n                }),\n              },\n            },\n          ],\n        }),\n        { status: 200, headers: { "content-type": "application/json" } },\n      );\n    }\n'''
new_groq_mock = '''    if (url.includes("api.groq.com")) {\n      const requestBody = JSON.parse(String(init?.body || "{}"));\n      const groqSold = disagreement\n        ? { ...sharedSold, url: requestBody.model === "openai/gpt-oss-20b"\n            ? "https://www.ebay.com/itm/666666666666"\n            : "https://www.ebay.com/itm/777777777777" }\n        : sharedSold;\n      if (requestBody.model === "openai/gpt-oss-20b") {\n        assert.deepEqual(requestBody.tools, [{ type: "browser_search" }]);\n        assert.equal(requestBody.tool_choice, "required");\n        assert.equal(requestBody.reasoning_effort, "low");\n      } else {\n        assert.equal(requestBody.model, "groq/compound-mini");\n        assert.deepEqual(requestBody.response_format, { type: "json_object" });\n        assert.deepEqual(requestBody.compound_custom?.tools?.enabled_tools, ["web_search"]);\n        assert.deepEqual(requestBody.search_settings?.include_domains, expectedDomains);\n        assert.equal(requestBody.search_settings?.country, "united states");\n        const headers = new Headers(init?.headers);\n        assert.equal(headers.get("Groq-Model-Version"), "latest");\n        groqContractChecked = true;\n      }\n      return new Response(\n        JSON.stringify({\n          choices: [\n            {\n              message: {\n                content: JSON.stringify({\n                  sold: [groqSold],\n                  active: [],\n                  notes: "Groq search independently checked the sale.",\n                }),\n              },\n            },\n          ],\n        }),\n        { status: 200, headers: { "content-type": "application/json" } },\n      );\n    }\n    if (url.includes("openrouter.ai")) {\n      const requestBody = JSON.parse(String(init?.body || "{}"));\n      assert.equal(requestBody.model, "openrouter/free");\n      assert.equal(requestBody.provider?.require_parameters, true);\n      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sold: [sharedSold], active: [], notes: "OpenRouter critic retained supplied exact row." }) } }] }), { status: 200, headers: { "content-type": "application/json" } });\n    }\n    if (url.includes("api.cloudflare.com")) {\n      return new Response(JSON.stringify({ success: true, result: { response: JSON.stringify({ sold: [sharedSold], active: [], notes: "Cloudflare critic retained supplied exact row." }) } }), { status: 200, headers: { "content-type": "application/json" } });\n    }\n'''
replace_once("scripts/run-instacomp-teacher-market-provider-simulations.ts", old_groq_mock, new_groq_mock)
replace_once(
    "scripts/run-instacomp-teacher-market-provider-simulations.ts",
    '      "groq",\n      "xai",\n    ]);\n    assert.equal(agreed.requiredVotes, 3);\n',
    '      "groq",\n      "groq_browser",\n      "xai",\n    ]);\n    assert.equal(agreed.requiredVotes, 3);\n    assert.equal(agreed.studentHypothesis.status, "skipped");\n    assert.ok(agreed.attempts.some((attempt) => attempt.teacher === "openrouter" && attempt.ok));\n    assert.ok(agreed.attempts.some((attempt) => attempt.teacher === "cloudflare" && attempt.ok));\n',
)
replace_once(
    "scripts/run-instacomp-teacher-market-provider-simulations.ts",
    '    assert.ok(disagreed.discovery.sold.length >= 4);\n',
    '    assert.ok(disagreed.discovery.sold.length >= 5);\n',
)

print("patched free comp learning council")
