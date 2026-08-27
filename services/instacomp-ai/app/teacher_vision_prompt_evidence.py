from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from .models import TrainingExample
from .ollama import local_vision_prompt_payload


@dataclass(frozen=True)
class CompactVisionPromptView:
    """Prompt-only view of local vision evidence.

    The canonical TrainingExample and its SQLite evidence remain untouched. This
    adapter exists only so the teacher/student prompts do not repeatedly serialize
    thousands of OCR coordinates and raw CV measurements into an 8K context.
    """

    payload: dict[str, Any]

    def model_dump(self, *args: object, **kwargs: object) -> dict[str, Any]:
        del args, kwargs
        return self.payload


def compact_training_example_for_prompt(example: TrainingExample) -> TrainingExample:
    if example.local_vision is None:
        return example
    digest = local_vision_prompt_payload(example.local_vision)
    if digest is None:
        return example
    # Pydantic model_copy(update=...) intentionally does not revalidate the update.
    # The adapter is consumed only by teacher_vision_training.py, where local_vision
    # is serialized with model_dump(). The original example/raw database row is not
    # mutated and still contains every OCR observation and deterministic measurement.
    return example.model_copy(
        update={"local_vision": CompactVisionPromptView(digest)}
    )


def compact_training_examples_for_prompt(
    examples: Iterable[TrainingExample],
) -> list[TrainingExample]:
    return [compact_training_example_for_prompt(example) for example in examples]
