from __future__ import annotations

import hashlib
import json
from pydantic import BaseModel, Field, field_validator, model_validator


class ChecklistRow(BaseModel):
    source_name: str = Field(min_length=2, max_length=200)
    source_release_id: str = Field(min_length=1, max_length=200)
    source_version: str = Field(min_length=1, max_length=100)
    source_receipt: str = Field(min_length=1, max_length=1000)
    sport: str = Field(min_length=1, max_length=100)
    league: str | None = Field(default=None, max_length=100)
    year: str = Field(min_length=2, max_length=20)
    manufacturer: str | None = Field(default=None, max_length=150)
    brand: str = Field(min_length=1, max_length=150)
    set_name: str = Field(min_length=1, max_length=250)
    subset: str | None = Field(default=None, max_length=250)
    player: str = Field(min_length=1, max_length=300)
    team: str | None = Field(default=None, max_length=200)
    card_number: str = Field(min_length=1, max_length=100)
    parallel: str = Field(default="Base", max_length=250)
    variation: str | None = Field(default=None, max_length=250)
    serial_run: int | None = Field(default=None, ge=1)
    rookie: bool = False
    autograph: bool = False
    memorabilia: bool = False
    language_code: str = Field(default="en", min_length=2, max_length=12)
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator(
        "source_name",
        "source_release_id",
        "source_version",
        "source_receipt",
        "sport",
        "league",
        "year",
        "manufacturer",
        "brand",
        "set_name",
        "subset",
        "player",
        "team",
        "card_number",
        "parallel",
        "variation",
        "language_code",
        "notes",
        mode="before",
    )
    @classmethod
    def trim_strings(cls, value):
        if value is None:
            return None
        if isinstance(value, str):
            value = " ".join(value.strip().split())
            return value or None
        return value

    @model_validator(mode="after")
    def validate_identity(self):
        if self.autograph and "auto" not in self.parallel.lower() and not self.notes:
            raise ValueError("Autograph rows need an autograph parallel label or explanatory notes")
        return self

    def normalized_identity(self) -> dict[str, object]:
        def norm(value: str | None) -> str:
            return " ".join((value or "").lower().split())

        return {
            "sport": norm(self.sport),
            "year": norm(self.year),
            "brand": norm(self.brand),
            "set_name": norm(self.set_name),
            "subset": norm(self.subset),
            "player": norm(self.player),
            "card_number": norm(self.card_number).replace(" ", ""),
            "parallel": norm(self.parallel or "Base"),
            "variation": norm(self.variation),
            "serial_run": self.serial_run,
            "autograph": self.autograph,
            "memorabilia": self.memorabilia,
        }

    def identity_fingerprint(self) -> str:
        payload = json.dumps(self.normalized_identity(), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def row_receipt(self) -> str:
        payload = self.model_dump(mode="json")
        return hashlib.sha256(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()


CHECKLIST_COLUMNS = list(ChecklistRow.model_fields.keys())
