"""Column validation — stop on missing/renamed columns; never invent targets."""

from __future__ import annotations

from typing import Iterable, List, Sequence

# Real exports sometimes tweak casing/punctuation — map to canonical names only.
HEADER_ALIASES = {
    "report date": "Report Date",
    "shift": "Shift",
    "pnp worker name": "Pnp Worker Name",
    "pnp worker": "Pnp Worker Name",
    "worker name": "Pnp Worker Name",
    "station name": "Station Name",
    "station": "Station Name",
    "primary sku": "Primary Sku",
    "primary skus": "Primary Sku",
    "sku": "Primary Sku",
    "boxes packed": "Boxes Packed",
    "items packed": "Items Packed",
    "pouches packed": "Pouches Packed",
    "packing time seconds": "Packing Time Seconds",
    "packing time (seconds)": "Packing Time Seconds",
    "seconds per item": "Seconds per Item",
    "pouches per hour": "Pouches per Hour",
    "report date hour": "Report Date Hour",
    "facility name": "Facility Name",
    "facility": "Facility Name",
    "idle time %": "Idle Time %",
    "idle time%": "Idle Time %",
    "idle time": "Idle Time %",
    "total boxes packed": "Total Boxes Packed",
    "packing time (hours)": "Packing Time (Hours)",
    "packing time hours": "Packing Time (Hours)",
    "boxes per hour": "Boxes per Hour",
}


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


def canonicalize_header(value) -> str:
    n = normalize_header(value)
    if not n:
        return ""
    return HEADER_ALIASES.get(n.lower(), n)


def validate_headers(
    file_label: str,
    headers: Iterable,
    required: Sequence[str],
) -> List[str]:
    """Return canonical header list; raise ColumnValidationError if any required missing."""
    found = [canonicalize_header(h) for h in headers]
    while found and found[-1] == "":
        found.pop()
    found_set = {h for h in found if h}
    missing = [c for c in required if c not in found_set]
    if missing:
        raise ColumnValidationError(file_label, missing, [h for h in found if h])
    return found


def find_header_row_index(rows: List[List], required: Sequence[str]) -> int:
    """Scan early rows for the header (exports sometimes have a title row first)."""
    need = [c.lower() for c in required]
    for i, row in enumerate(rows[:20]):
        keys = set()
        for cell in row:
            c = canonicalize_header(cell)
            if c:
                keys.add(c.lower())
        hits = sum(1 for n in need if n in keys)
        if hits >= min(4, len(need)) or hits == len(need):
            return i
    return 0
