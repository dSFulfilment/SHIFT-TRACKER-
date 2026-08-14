"""CLI — point at Boxes + Intra Hour exports without editing code."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Optional, Tuple

from .compute import build_report
from .load import load_boxes_packed, load_intra_hour
from .validate import ColumnValidationError
from .workbook import write_workbook

BOXES_HINTS = ("boxes_packed_by_worker", "boxes packed by worker")
INTRA_HINTS = ("intra_hour_floor_performance", "intra hour floor performance", "intra_hour")


def _match_file(dir_path: Path, hints: Tuple[str, ...]) -> Optional[Path]:
    xlsx = sorted(dir_path.glob("*.xlsx")) + sorted(dir_path.glob("*.XLSX"))
    for path in xlsx:
        if path.name.startswith("~$"):
            continue
        stem = path.stem.lower().replace(" ", "_")
        name_l = path.name.lower()
        for h in hints:
            h_norm = h.lower().replace(" ", "_")
            if h_norm in stem or h.lower() in name_l:
                return path
    return None


def resolve_inputs(args: argparse.Namespace):
    if args.dir:
        d = Path(args.dir).expanduser().resolve()
        if not d.is_dir():
            raise SystemExit(f"--dir not a folder: {d}")
        boxes = Path(args.boxes).expanduser() if args.boxes else _match_file(d, BOXES_HINTS)
        intra = Path(args.intra).expanduser() if args.intra else _match_file(d, INTRA_HINTS)
        missing = []
        if not boxes:
            missing.append("Boxes_Packed_by_Worker.xlsx")
        if not intra:
            missing.append("Intra_Hour_Floor_Performance.xlsx")
        if missing:
            raise SystemExit(
                f"Could not find required file(s) in {d}: {', '.join(missing)}. "
                f"Pass --boxes / --intra explicitly, or rename files to the usual export names."
            )
        return Path(boxes), Path(intra)

    if not args.boxes or not args.intra:
        raise SystemExit("Provide --boxes and --intra, or use --dir.")
    boxes = Path(args.boxes).expanduser().resolve()
    intra = Path(args.intra).expanduser().resolve()
    return boxes, intra


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="packer-shift-report",
        description=(
            "Build a Dandenong South Morning/Afternoon packer performance-vs-target "
            "Excel report from Boxes Packed by Worker + Intra Hour Floor Performance. "
            "Never modifies the sources."
        ),
    )
    p.add_argument(
        "--dir",
        help="Folder containing the two exports (auto-matched by filename).",
    )
    p.add_argument("--boxes", help="Boxes_Packed_by_Worker.xlsx")
    p.add_argument("--intra", help="Intra_Hour_Floor_Performance.xlsx")
    p.add_argument(
        "--out",
        default="packer_shift_report.xlsx",
        help="Output workbook path (default: ./packer_shift_report.xlsx)",
    )
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        boxes_path, intra_path = resolve_inputs(args)
    except SystemExit as e:
        print(e, file=sys.stderr)
        return 2

    for label, path in (
        ("Boxes packed", boxes_path),
        ("Intra hour", intra_path),
    ):
        if not path.is_file():
            print(f"{label} file not found: {path}", file=sys.stderr)
            return 2

    try:
        boxes_rows, boxes_dropped = load_boxes_packed(boxes_path, boxes_path.name)
        intra_rows, _intra_dropped = load_intra_hour(intra_path, intra_path.name)
    except ColumnValidationError as e:
        print(str(e), file=sys.stderr)
        return 1

    report = build_report(boxes_rows, boxes_dropped, intra_rows=intra_rows)
    out = write_workbook(report, Path(args.out).expanduser().resolve())

    print(f"Wrote {out}")
    print(f"  Morning packers:   {len(report.morning)}")
    print(f"  Afternoon packers: {len(report.afternoon)}")
    print(f"  Raw lines kept:    {len(report.raw_lines)}")
    for reason, count in report.exclusions.as_rows():
        if count:
            print(f"  Exclusions — {reason}: {count}")
    for w in report.warnings:
        print(f"  WARNING: {w}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
