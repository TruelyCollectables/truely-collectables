#!/usr/bin/env python3
from pathlib import Path

path = Path("services/instacomp-ai/app/ollama.py")
source = path.read_text(encoding="utf-8")

required = [
    "OLLAMA_OUTPUT_SCHEMA = OllamaStructuredSuggestion.model_json_schema()",
    "def prepare_ollama_image",
    '"format": OLLAMA_OUTPUT_SCHEMA',
    'f"{self.settings.ollama_base_url.rstrip(\'/\')}/api/chat"',
    '"num_predict": 2048',
    '"num_ctx": 8192',
]
if all(marker in source for marker in required):
    print(f"already patched {path}")
    raise SystemExit(0)

source = source.replace(
    "import base64\nimport json\nimport re\n\nimport httpx\n\nfrom .config import Settings\nfrom .models import CardIdentity, ModelSuggestion, VisualEvidence\n",
    "import ast\nimport base64\nimport io\nimport json\nimport re\n\nimport httpx\nfrom PIL import Image, ImageOps\nfrom pydantic import BaseModel, Field\n\nfrom .config import Settings\nfrom .models import CardIdentity, ModelSuggestion, VisualEvidence\n",
    1,
)

shape_end = '''JSON_SHAPE = {
    "identity": {
        "sport": None,
        "league": None,
        "year": None,
        "manufacturer": None,
        "brand": None,
        "set_name": None,
        "subset": None,
        "player": None,
        "team": None,
        "card_number": None,
        "parallel": None,
        "variation": None,
        "serial_number": None,
        "serial_run": None,
        "rookie": None,
        "autograph": None,
        "inscription": None,
        "inscription_text": None,
        "memorabilia": None,
        "memorabilia_type": None,
    },
    "evidence": {
        "visible_text": [],
        "front_visible_text": [],
        "back_visible_text": [],
        "logos": [],
        "colors": [],
        "foil_or_pattern": [],
        "front_notes": [],
        "back_notes": [],
        "uncertainty": [],
    },
    "confidence": 0.0,
    "explanation": "",
}
'''
replacement_shape = shape_end + '''

class OllamaStructuredSuggestion(BaseModel):
    identity: CardIdentity = Field(default_factory=CardIdentity)
    evidence: VisualEvidence = Field(default_factory=VisualEvidence)
    confidence: float = Field(default=0.0, ge=0, le=1)
    explanation: str = ""


OLLAMA_OUTPUT_SCHEMA = OllamaStructuredSuggestion.model_json_schema()
OLLAMA_MAX_EDGE = 1280


def prepare_ollama_image(content: bytes) -> bytes:
    """Create a compact baseline JPEG that Ollama vision can decode reliably."""
    if not content:
        raise ValueError("Ollama image is empty")
    try:
        with Image.open(io.BytesIO(content)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
            image.thumbnail((OLLAMA_MAX_EDGE, OLLAMA_MAX_EDGE), Image.Resampling.LANCZOS)
            output = io.BytesIO()
            image.save(
                output,
                format="JPEG",
                quality=84,
                optimize=True,
                progressive=False,
                subsampling=0,
            )
            prepared = output.getvalue()
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Ollama image could not be decoded") from exc
    if not prepared:
        raise ValueError("Ollama image preparation produced no bytes")
    return prepared
'''
if shape_end not in source:
    raise SystemExit("JSON_SHAPE block was not found")
source = source.replace(shape_end, replacement_shape, 1)

old_extract = '''def extract_json(text: str) -> dict:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\\s*", "", cleaned, flags=re.I)
        cleaned = re.sub(r"\\s*```$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Local backup model did not return JSON")
        return json.loads(cleaned[start : end + 1])
'''
new_extract = '''def _balanced_json_object(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def extract_json(text: str) -> dict:
    cleaned = str(text or "").strip().lstrip("\\ufeff")
    cleaned = re.sub(r"^```(?:json)?\\s*", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\\s*```$", "", cleaned)
    candidates = [cleaned]
    balanced = _balanced_json_object(cleaned)
    if balanced and balanced not in candidates:
        candidates.append(balanced)

    for candidate in candidates:
        try:
            value = json.loads(candidate)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            pass

        repaired = re.sub(r",\\s*([}\\]])", r"\\1", candidate)
        repaired = repaired.replace("“", '"').replace("”", '"').replace("’", "'")
        try:
            value = json.loads(repaired)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            pass

        try:
            value = ast.literal_eval(repaired)
            if isinstance(value, dict):
                return value
        except (SyntaxError, ValueError):
            pass

    raise ValueError("Local backup model did not return valid JSON")
'''
if old_extract not in source:
    raise SystemExit("extract_json block was not found")
source = source.replace(old_extract, new_extract, 1)

old_analyze = '''    async def analyze(self, front: bytes, back: bytes | None) -> ModelSuggestion:
        images = [base64.b64encode(front).decode("ascii")]
        if back:
            images.append(base64.b64encode(back).decode("ascii"))
        prompt = (
            SYSTEM_PROMPT
            + "\\nReturn this exact structural shape, populated with observed evidence:\\n"
            + json.dumps(JSON_SHAPE)
        )
        payload = {
            "model": self.settings.ollama_model,
            "prompt": prompt,
            "images": images,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.0},
        }
        async with httpx.AsyncClient(
            timeout=self.settings.ollama_timeout_seconds
        ) as client:
            response = await client.post(
                f"{self.settings.ollama_base_url.rstrip('/')}/api/generate",
                json=payload,
            )
            response.raise_for_status()
            envelope = response.json()
        parsed = normalize_identity_payload(
            extract_json(str(envelope.get("response") or ""))
        )
        confidence = normalize_confidence(parsed.get("confidence"))
        return ModelSuggestion(
            provider="instacomp_ollama_backup",
            model=self.settings.ollama_model,
            identity=CardIdentity.model_validate(parsed.get("identity") or {}),
            evidence=VisualEvidence.model_validate(parsed.get("evidence") or {}),
            confidence=confidence,
            explanation=str(
                parsed.get("explanation") or "Local backup visual evidence only."
            ),
            raw={
                "role": "backup_reader",
                "done_reason": envelope.get("done_reason"),
                "total_duration": envelope.get("total_duration"),
                "eval_count": envelope.get("eval_count"),
            },
        )
'''
new_analyze = '''    async def analyze(self, front: bytes, back: bytes | None) -> ModelSuggestion:
        prepared_images = [prepare_ollama_image(front)]
        if back:
            prepared_images.append(prepare_ollama_image(back))
        images = [base64.b64encode(image).decode("ascii") for image in prepared_images]
        prompt = (
            SYSTEM_PROMPT
            + "\\nReturn only a JSON object matching this JSON schema exactly. "
            + "Use null or empty arrays for unknown values.\\n"
            + json.dumps(OLLAMA_OUTPUT_SCHEMA, separators=(",", ":"))
        )
        payload = {
            "model": self.settings.ollama_model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                    "images": images,
                }
            ],
            "stream": False,
            "format": OLLAMA_OUTPUT_SCHEMA,
            "keep_alive": "15m",
            "options": {
                "temperature": 0.0,
                "num_ctx": 8192,
                "num_predict": 2048,
                "seed": 0,
            },
        }
        async with httpx.AsyncClient(
            timeout=self.settings.ollama_timeout_seconds
        ) as client:
            response = await client.post(
                f"{self.settings.ollama_base_url.rstrip('/')}/api/chat",
                json=payload,
            )
            response.raise_for_status()
            envelope = response.json()
        message = envelope.get("message") or {}
        parsed = normalize_identity_payload(
            extract_json(str(message.get("content") or ""))
        )
        structured = OllamaStructuredSuggestion.model_validate(parsed)
        return ModelSuggestion(
            provider="instacomp_ollama_backup",
            model=self.settings.ollama_model,
            identity=structured.identity,
            evidence=structured.evidence,
            confidence=structured.confidence,
            explanation=(
                structured.explanation or "Local backup visual evidence only."
            ),
            raw={
                "role": "backup_reader",
                "transport": "ollama_chat_structured_output",
                "done_reason": envelope.get("done_reason"),
                "total_duration": envelope.get("total_duration"),
                "eval_count": envelope.get("eval_count"),
                "prepared_image_count": len(prepared_images),
                "prepared_image_bytes": [len(image) for image in prepared_images],
            },
        )
'''
if old_analyze not in source:
    raise SystemExit("OllamaReader.analyze block was not found")
source = source.replace(old_analyze, new_analyze, 1)

missing = [marker for marker in required if marker not in source]
if missing:
    raise SystemExit(f"Patch completed but markers are missing: {missing}")

path.write_text(source, encoding="utf-8")
print(f"patched {path}")
