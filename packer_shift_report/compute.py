"""Core performance-vs-target calculations."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from .constants import SKU_TARGETS
from .load import normalize_worker_key, parse_sku


@dataclass
class ExclusionStats:
    blank_worker_or_sku: int = 0
    missing_boxes: int = 0
    missing_time: int = 0
    unknown_sku_lines: int = 0  # included but flagged — not an exclusion

    def as_rows(self) -> List[Tuple[str, int]]:
        return [
            ("Blank worker name or Primary Sku (trailing totals / incomplete rows)", self.blank_worker_or_sku),
            ("Missing Boxes Packed", self.missing_boxes),
            ("Missing Packing Time Seconds", self.missing_time),
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
class SkuLineWhy:
    sku: Any
    hours: float
    boxes: float
    actual_bph: Optional[float]
    target_bph: Optional[float]
    strike_bph: Optional[float]
    target_boxes: Optional[float]
    line_pct: Optional[float]
    verdict: str  # under strike | under target | on/above target | no target | excluded


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
    why: str = ""
    box_gap: Optional[float] = None  # score boxes − target boxes (positive = ahead)
    sku_lines: List[SkuLineWhy] = field(default_factory=list)
    excluded_short_lines: int = 0


@dataclass
class ShiftTotals:
    shift_key: str
    shift_label: str
    packers: int
    hours: float
    boxes: float
    target_boxes: float
    pct_of_target: Optional[float]
    box_gap: Optional[float]
    below: int
    dipped: int
    on_target: int
    no_target: int


@dataclass
class ReportData:
    raw_lines: List[RawLine]
    morning: List[PackerShiftResult]
    afternoon: List[PackerShiftResult]
    exclusions: ExclusionStats
    facility_workers: List[str]
    intra_rows: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    morning_totals: Optional[ShiftTotals] = None
    afternoon_totals: Optional[ShiftTotals] = None


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


def build_raw_lines(
    boxes_rows: List[Dict[str, Any]],
    exclusions: ExclusionStats,
) -> List[RawLine]:
    lines: List[RawLine] = []
    for r in boxes_rows:
        display = str(r.get("Pnp Worker Name")).strip()
        key = normalize_worker_key(display)

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


def _line_verdict(line: RawLine) -> str:
    if not line.included:
        return "excluded"
    if line.unknown_sku or line.target_bph is None:
        return "no target"
    if line.actual_bph is not None and line.strike_bph is not None and line.actual_bph < line.strike_bph:
        return "under strike"
    if line.actual_bph is not None and line.target_bph is not None and line.actual_bph < line.target_bph:
        return "under target"
    return "on/above target"


def _sku_why_rows(lines: List[RawLine]) -> List[SkuLineWhy]:
    out: List[SkuLineWhy] = []
    for L in lines:
        line_pct = None
        if L.target_boxes and L.target_boxes > 0 and L.included and L.target_bph is not None:
            line_pct = L.boxes / L.target_boxes * 100.0
        out.append(
            SkuLineWhy(
                sku=L.sku,
                hours=L.hours or 0.0,
                boxes=L.boxes or 0.0,
                actual_bph=L.actual_bph,
                target_bph=L.target_bph,
                strike_bph=L.strike_bph,
                target_boxes=L.target_boxes,
                line_pct=line_pct,
                verdict=_line_verdict(L),
            )
        )
    # Included known lines first, worst line_pct first, then excluded
    def sk(row: SkuLineWhy):
        if row.verdict.startswith("excluded"):
            return (2, 0.0, str(row.sku))
        if row.line_pct is None:
            return (1, 0.0, str(row.sku))
        return (0, row.line_pct, str(row.sku))

    out.sort(key=sk)
    return out


def explain_why(
    flag: str,
    pct: Optional[float],
    score_boxes: float,
    target_boxes: float,
    sku_rows: List[SkuLineWhy],
) -> str:
    """Plain-English reason a packer's shift worked or didn't."""
    gap = score_boxes - target_boxes if target_boxes is not None else None
    bits: List[str] = []

    if flag == "No target defined":
        bits.append("Cannot score % of target — no SKU on this shift has a target in the table.")
    elif flag == "Below target" and pct is not None and gap is not None:
        bits.append(
            f"Finished at {pct:.0f}% of target — short by {abs(gap):.0f} boxes for the hours worked."
        )
    elif flag == "Dipped below strike" and pct is not None and gap is not None:
        weak = [r for r in sku_rows if r.verdict == "under strike"]
        sku_list = ", ".join(str(r.sku) for r in weak) or "?"
        bits.append(
            f"Beat overall target ({pct:.0f}%, +{gap:.0f} boxes) but dipped under the strike line on SKU {sku_list}."
        )
    elif flag == "On/above target" and pct is not None and gap is not None:
        bits.append(
            f"Hit target at {pct:.0f}% — {gap:.0f} boxes above what hours × SKU targets required."
        )

    under = [r for r in sku_rows if r.verdict in ("under strike", "under target")]
    strong = [r for r in sku_rows if r.verdict == "on/above target"]
    if under:
        bits.append(
            "Dragged by: "
            + "; ".join(
                f"SKU {r.sku} {r.actual_bph:.1f} BPH vs target {r.target_bph:g}"
                + (f" / strike {r.strike_bph:g}" if r.verdict == "under strike" else "")
                for r in under
                if r.actual_bph is not None and r.target_bph is not None
            )
        )
    if strong and flag != "Below target":
        bits.append(
            "Held up by: "
            + "; ".join(
                f"SKU {r.sku} {r.actual_bph:.1f} BPH (target {r.target_bph:g})"
                for r in strong
                if r.actual_bph is not None and r.target_bph is not None
            )
        )
    excluded = [r for r in sku_rows if r.verdict.startswith("excluded")]
    if excluded:
        bits.append(f"{len(excluded)} incomplete SKU line(s) left out (missing boxes or packing time).")
    return " ".join(bits)


def shift_totals(results: List[PackerShiftResult], shift_key: str, shift_label: str) -> ShiftTotals:
    hours = sum(r.hours for r in results)
    boxes = sum(r.boxes for r in results)
    target = sum(r.target_boxes for r in results)
    score_boxes = 0.0
    for r in results:
        if r.pct_of_target is not None and r.target_boxes:
            score_boxes += r.target_boxes * r.pct_of_target / 100.0
    pct = (score_boxes / target * 100.0) if target > 0 else None
    gap = (score_boxes - target) if target > 0 else None
    return ShiftTotals(
        shift_key=shift_key,
        shift_label=shift_label,
        packers=len(results),
        hours=hours,
        boxes=boxes,
        target_boxes=target,
        pct_of_target=pct,
        box_gap=gap,
        below=sum(1 for r in results if r.flag == "Below target"),
        dipped=sum(1 for r in results if r.flag == "Dipped below strike"),
        on_target=sum(1 for r in results if r.flag == "On/above target"),
        no_target=sum(1 for r in results if r.flag == "No target defined"),
    )


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
        if not included:
            continue

        hours = sum(L.hours for L in included)
        boxes = sum(L.boxes for L in included)
        known = [L for L in included if L.target_bph is not None]
        has_unknown = any(L.unknown_sku for L in included)
        short_n = sum(1 for L in wlines if not L.included)
        sku_rows = _sku_why_rows(wlines)

        if not known:
            skus = sorted({str(L.sku) for L in included if L.unknown_sku})
            sku_note = (
                "no target defined for SKU " + ", ".join(skus)
                if skus
                else "All included SKUs lack a target — cannot score % of target"
            )
            why = explain_why("No target defined", None, 0.0, 0.0, sku_rows)
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
                    why=why,
                    box_gap=None,
                    sku_lines=sku_rows,
                    excluded_short_lines=short_n,
                )
            )
            continue

        target_boxes = sum(L.hours * L.target_bph for L in known)
        boxes_known = sum(L.boxes for L in known)
        pct = (boxes_known / target_boxes * 100.0) if target_boxes > 0 else None

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

        gap = boxes_known - target_boxes if target_boxes else None
        why = explain_why(flag, pct, boxes_known, target_boxes, sku_rows)

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
                why=why,
                box_gap=gap,
                sku_lines=sku_rows,
                excluded_short_lines=short_n,
            )
        )

    def sort_key(r: PackerShiftResult):
        if r.pct_of_target is None:
            return (1, 0.0, r.worker_display.lower())
        return (0, r.pct_of_target, r.worker_display.lower())

    results.sort(key=sort_key)
    return results


def build_report(
    boxes_rows: List[Dict[str, Any]],
    boxes_dropped: Dict[str, int],
    intra_rows: Optional[List[Dict[str, Any]]] = None,
) -> ReportData:
    """Score from Boxes Packed by Worker. Intra hour is reference only (not scoring)."""
    exclusions = ExclusionStats(blank_worker_or_sku=boxes_dropped.get("blank_worker_or_sku", 0))
    warnings: List[str] = []

    raw = build_raw_lines(boxes_rows, exclusions)
    morning = aggregate_shift(raw, "morning_shift")
    afternoon = aggregate_shift(raw, "afternoon_shift")
    workers = sorted({line.worker_display for line in raw}, key=lambda s: s.lower())
    return ReportData(
        raw_lines=raw,
        morning=morning,
        afternoon=afternoon,
        exclusions=exclusions,
        facility_workers=workers,
        intra_rows=intra_rows or [],
        warnings=warnings,
        morning_totals=shift_totals(morning, "morning_shift", "Morning"),
        afternoon_totals=shift_totals(afternoon, "afternoon_shift", "Afternoon"),
    )
