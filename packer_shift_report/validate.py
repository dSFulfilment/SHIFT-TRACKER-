"""Column validation — stop on missing/renamed columns; never guess."""

from __future__ import annotations

from typing import Iterable, List, Sequence


class ColumnValidationError(Exception):
    """Raised when an input workbook is missing required columns."""

    def __init__(self, file_label: str, missing: Sequence[str], found: Sequence[str]):
        self.file_label = file_label
        self.missing = list(missing)
        self.found = list(found)
        miss = ", ".join(self.missing)
        found_s = ", ".join(self.found) if self.found else "(none)"
        super().__init__(
            f"{file_label}: missing required column(s): {miss}. "
            f"Found headers: {found_s}. "
            f"Fix the export or rename columns back — do not guess."
        )


def normalize_header(value) -> str:
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def validate_headers(
    file_label: str,
    headers: Iterable,
    required: Sequence[str],
) -> List[str]:
    """Return normalized header list; raise ColumnValidationError if any required missing."""
    found = [normalize_header(h) for h in headers]
    # Drop trailing empty headers from sparse Excel rows
    while found and found[-1] == "":
        found.pop()
    found_set = set(found)
    missing = [c for c in required if c not in found_set]
    if missing:
        raise ColumnValidationError(file_label, missing, found)
    return found
