"""Core performance-vs-target calculations."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .constants import FACILITY_NAME, MIN_HOURS_ON_SKU, SKU_TARGETS
from .load import normalize_worker_key, parse_sku


@dataclass
class ExclusionStats:
    blank_worker_or_sku: int = 0
    missing_boxes: int = 0
    missing_time: int = 0
    under_15_min: int = 0
    not_dandenong_south: int = 0
    unknown_sku_lines: int = 0  # included but flagged — not an exclusion

    def as_rows(self) -> List[Tuple[str, int]]:
        return [
            ("Blank worker name or Primary Sku (trailing totals / incomplete rows)", self.blank_worker_or_sku),
            ("Missing Boxes Packed", self.missing_boxes),
            ("Missing Packing Time Seconds", self.missing_time),
            ("Under 15-minute filter (Hours on SKU < 0.25 — changeover/setup noise)", self.under_15_min),
            ("Worker not in Dandenong South facility summary (excluded from report)", self.not_dandenong_south),
            ("Lines with Primary Sku not in target table (kept, flagged — not dropped)", self.unknown_sku_lines),
        ]


@dataclass
class RawLine:
    report_date: Any
    shift_key: str  # morning_shift | afternoon_shift
    shift_label: str  # Morning | Afternoon
    worker_display: str
    worker_key: str
    station: Any
    sku: Any
    boxes: float
    packing_seconds: float
    hours: float
    actual_bph: Optional[float]
    target_bph: Optional[float]
    strike_bph: Optional[float]
    target_boxes: Optional[float]
    included: bool
    exclude_reason: str
    unknown_sku: bool


@dataclass
class PackerShiftResult:
    shift_key: str
    shift_label: str
    worker_display: str
    worker_key: str
    hours: float
    boxes: float
    target_boxes: float
    pct_of_target: Optional[float]
    flag: str  # Below target | Dipped below strike | On/above target | No target defined
    has_unknown_sku: bool
    notes: str = ""


@dataclass
class ReportData:
    raw_lines: List[RawLine]
    morning: List[PackerShiftResult]
    afternoon: List[PackerShiftResult]
    exclusions: ExclusionStats
    facility_workers: List[str]
    intra_rows: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)


def _shift_label(shift_raw) -> Tuple[str, str]:
    s = ("" if shift_raw is None else str(shift_raw)).strip().lower()
    if s in ("morning_shift", "morning", "day", "day_shift"):
        return "morning_shift", "Morning"
    if s in ("afternoon_shift", "afternoon", "arvo"):
        return "afternoon_shift", "Afternoon"
    # Keep unknown shifts visible rather than guessing Morning/Afternoon
    return s or "unknown_shift", (str(shift_raw).strip() if shift_raw else "Unknown")


def _num(value) -> Optional[float]:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    try:
        return float(str(value).strip().replace(",", ""))
    except ValueError:
        return None


def dandenong_worker_keys(summary_rows: List[Dict[str, Any]]) -> Dict[str, str]:
    """Map normalized name → first original spelling for facility-filtered workers."""
    out: Dict[str, str] = {}
    for r in summary_rows:
        fac = r.get("Facility Name")
        if fac is None or str(fac).strip() != FACILITY_NAME:
            continue
        display = str(r.get("Pnp Worker Name")).strip()
        key = normalize_worker_key(display)
        if key and key not in out:
            out[key] = display
    return out


def build_raw_lines(
    boxes_rows: List[Dict[str, Any]],
    facility_names: Dict[str, str],
    exclusions: ExclusionStats,
) -> List[RawLine]:
    lines: List[RawLine] = []
    for r in boxes_rows:
        display = str(r.get("Pnp Worker Name")).strip()
        key = normalize_worker_key(display)
        if key not in facility_names:
            exclusions.not_dandenong_south += 1
            continue

        sku = parse_sku(r.get("Primary Sku"))
        boxes = _num(r.get("Boxes Packed"))
        seconds = _num(r.get("Packing Time Seconds"))
        shift_key, shift_label = _shift_label(r.get("Shift"))

        if boxes is None:
            exclusions.missing_boxes += 1
            lines.append(
                RawLine(
                    report_date=r.get("Report Date"),
                    shift_key=shift_key,
                    shift_label=shift_label,
                    worker_display=display,
                    worker_key=key,
                    station=r.get("Station Name"),
                    sku=sku,
                    boxes=0.0,
                    packing_seconds=seconds or 0.0,
                    hours=0.0,
                    actual_bph=None,
                    target_bph=None,
                    strike_bph=None,
                    target_boxes=None,
                    included=False,
                    exclude_reason="Missing Boxes Packed",
                    unknown_sku=False,
                )
            )
            continue

        if seconds is None:
            exclusions.missing_time += 1
            lines.append(
                RawLine(
                    report_date=r.get("Report Date"),
                    shift_key=shift_key,
                    shift_label=shift_label,
                    worker_display=display,
                    worker_key=key,
                    station=r.get("Station Name"),
                    sku=sku,
                    boxes=boxes,
                    packing_seconds=0.0,
                    hours=0.0,
                    actual_bph=None,
                    target_bph=None,
                    strike_bph=None,
                    target_boxes=None,
                    included=False,
                    exclude_reason="Missing Packing Time Seconds",
                    unknown_sku=False,
                )
            )
            continue

        hours = seconds / 3600.0
        actual_bph = (boxes / hours) if hours > 0 else None

        unknown = False
        target_bph = strike_bph = None
        if sku in SKU_TARGETS:
            target_bph, strike_bph = SKU_TARGETS[sku]
        else:
            unknown = True
            exclusions.unknown_sku_lines += 1

        target_boxes = (hours * target_bph) if target_bph is not None else None

        included = True
        reason = ""
        if hours < MIN_HOURS_ON_SKU:
            included = False
            reason = "Under 15-minute filter"
            exclusions.under_15_min += 1

        lines.append(
            RawLine(
                report_date=r.get("Report Date"),
                shift_key=shift_key,
                shift_label=shift_label,
                worker_display=display,
                worker_key=key,
                station=r.get("Station Name"),
                sku=sku,
                boxes=boxes,
                packing_seconds=seconds,
                hours=hours,
                actual_bph=actual_bph,
                target_bph=target_bph,
                strike_bph=strike_bph,
                target_boxes=target_boxes,
                included=included,
                exclude_reason=reason,
                unknown_sku=unknown,
            )
        )
    return lines


def aggregate_shift(lines: List[RawLine], shift_key: str) -> List[PackerShiftResult]:
    by_worker: Dict[str, List[RawLine]] = {}
    display_for: Dict[str, str] = {}
    for line in lines:
        if line.shift_key != shift_key:
            continue
        by_worker.setdefault(line.worker_key, []).append(line)
        display_for.setdefault(line.worker_key, line.worker_display)

    results: List[PackerShiftResult] = []
    for key, wlines in by_worker.items():
        included = [L for L in wlines if L.included]
        # Packers who only have excluded lines still appear? Spec: per packer per shift from included lines.
        # If nothing included, skip (they have no meaningful performance) but unknown-only short lines vanish — OK.
        if not included:
            continue

        hours = sum(L.hours for L in included)
        boxes = sum(L.boxes for L in included)
        known = [L for L in included if L.target_bph is not None]
        has_unknown = any(L.unknown_sku for L in included)

        if not known:
            skus = sorted({str(L.sku) for L in included if L.unknown_sku})
            sku_note = (
                "no target defined for SKU " + ", ".join(skus)
                if skus
                else "All included SKUs lack a target — cannot score % of target"
            )
            results.append(
                PackerShiftResult(
                    shift_key=shift_key,
                    shift_label=included[0].shift_label,
                    worker_display=display_for[key],
                    worker_key=key,
                    hours=hours,
                    boxes=boxes,
                    target_boxes=0.0,
                    pct_of_target=None,
                    flag="No target defined",
                    has_unknown_sku=True,
                    notes=sku_note,
                )
            )
            continue

        target_boxes = sum(L.hours * L.target_bph for L in known)
        pct = (boxes / target_boxes * 100.0) if target_boxes > 0 else None

        dipped = False
        for L in known:
            if L.actual_bph is not None and L.strike_bph is not None and L.actual_bph < L.strike_bph:
                dipped = True
                break

        if pct is None:
            flag = "No target defined"
        elif pct < 100:
            flag = "Below target"
        elif dipped:
            flag = "Dipped below strike"
        else:
            flag = "On/above target"

        notes = ""
        if has_unknown:
            skus = sorted({str(L.sku) for L in included if L.unknown_sku})
            notes = "no target defined for SKU " + ", ".join(skus)
            # Unknown SKU boxes are in `boxes` but not in target_boxes — % uses known lines' boxes only? Spec says:
            # % = sum Boxes across included lines / sum (Hours × Target) across same lines
            # For unknown SKU, target missing — those lines shouldn't enter the ratio as guessed targets.
            # Recalculate % using only known-target lines for BOTH numerator and denominator for fairness.
            boxes_known = sum(L.boxes for L in known)
            pct = (boxes_known / target_boxes * 100.0) if target_boxes > 0 else None
            if pct is not None and pct < 100:
                flag = "Below target"
            elif pct is not None and dipped:
                flag = "Dipped below strike"
            elif pct is not None:
                flag = "On/above target"
            # Keep total boxes/hours as all included (transparency)

        results.append(
            PackerShiftResult(
                shift_key=shift_key,
                shift_label=included[0].shift_label,
                worker_display=display_for[key],
                worker_key=key,
                hours=hours,
                boxes=boxes,
                target_boxes=target_boxes,
                pct_of_target=pct,
                flag=flag,
                has_unknown_sku=has_unknown,
                notes=notes,
            )
        )

    # Worst → best by % of target (None / no target at bottom)
    def sort_key(r: PackerShiftResult):
        if r.pct_of_target is None:
            return (1, 0.0, r.worker_display.lower())
        return (0, r.pct_of_target, r.worker_display.lower())

    results.sort(key=sort_key)
    return results


def build_report(
    boxes_rows: List[Dict[str, Any]],
    summary_rows: List[Dict[str, Any]],
    boxes_dropped: Dict[str, int],
    intra_rows: Optional[List[Dict[str, Any]]] = None,
) -> ReportData:
    exclusions = ExclusionStats(blank_worker_or_sku=boxes_dropped.get("blank_worker_or_sku", 0))
    facility = dandenong_worker_keys(summary_rows)
    if not facility:
        warnings = [
            f"No workers found with Facility Name == \"{FACILITY_NAME}\" in the summary file. "
            "Nothing to score."
        ]
    else:
        warnings = []

    raw = build_raw_lines(boxes_rows, facility, exclusions)
    morning = aggregate_shift(raw, "morning_shift")
    afternoon = aggregate_shift(raw, "afternoon_shift")
    return ReportData(
        raw_lines=raw,
        morning=morning,
        afternoon=afternoon,
        exclusions=exclusions,
        facility_workers=sorted(facility.values(), key=lambda s: s.lower()),
        intra_rows=intra_rows or [],
        warnings=warnings,
    )
