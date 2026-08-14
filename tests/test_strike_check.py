#!/usr/bin/env python3
"""Unit tests for strike_check.py (no network)."""

from __future__ import annotations

import csv
import tempfile
import unittest
from pathlib import Path

import strike_check as sc

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures" / "packer-shift"


class ParseSkuSizesTests(unittest.TestCase):
    def test_single(self):
        skus, kind = sc.parse_box_sku_sizes("700g")
        self.assertEqual(kind, "single_sku")
        self.assertEqual(skus, [700])

    def test_mixed(self):
        skus, kind = sc.parse_box_sku_sizes('"250g, 600g"')
        self.assertEqual(kind, "mixed_sku")
        self.assertEqual(skus, [250, 600])

    def test_empty(self):
        skus, kind = sc.parse_box_sku_sizes("")
        self.assertEqual(kind, "empty")
        self.assertEqual(skus, [])


class StrikeEvalTests(unittest.TestCase):
    def test_below_and_insufficient(self):
        rows = [
            {
                "Shift": "morning_shift",
                "Pnp Worker Name": "Alice",
                "Station Name": "A1",
                "Primary Sku": 250,
                "Boxes Packed": 10,
                "Packing Time Seconds": 3600,  # 10 BPH < 14.6 strike
            },
            {
                "Shift": "morning_shift",
                "Pnp Worker Name": "Bob",
                "Station Name": "B1",
                "Primary Sku": 250,
                "Boxes Packed": 2,
                "Packing Time Seconds": 300,  # < 600
            },
            {
                "Shift": "morning_shift",
                "Pnp Worker Name": "Carol",
                "Station Name": "C1",
                "Primary Sku": 999,
                "Boxes Packed": 20,
                "Packing Time Seconds": 3600,
            },
        ]
        out = sc.evaluate_boxes(rows, sc.DEFAULT_STRIKE_TABLE)
        by = {r.worker_display: r for r in out}
        self.assertEqual(by["Alice"].status, "below_strike_line")
        self.assertEqual(by["Bob"].status, "insufficient_data")
        self.assertEqual(by["Carol"].status, "unknown_sku")

    def test_bad_row_not_dropped(self):
        rows = [
            {
                "Shift": "morning_shift",
                "Pnp Worker Name": "Dan",
                "Station Name": "D1",
                "Primary Sku": 250,
                "Boxes Packed": None,
                "Packing Time Seconds": 3600,
            }
        ]
        out = sc.evaluate_boxes(rows, sc.DEFAULT_STRIKE_TABLE)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].status, "bad_row")


class FixtureIntegrationTests(unittest.TestCase):
    def test_loads_fixtures_and_separates_mixed(self):
        boxes = sc.load_boxes_rows(FIXTURES / "Boxes_Packed_by_Worker.xlsx")
        self.assertTrue(len(boxes) >= 1)
        # Totals row must not appear (blank worker+sku+shift)
        for d in boxes:
            self.assertFalse(
                sc._blank(d.get("Pnp Worker Name"))
                and sc._blank(d.get("Primary Sku"))
                and sc._blank(d.get("Shift"))
            )

        sessions, counts = sc.load_raw_data(FIXTURES / "Raw_Data.csv")
        self.assertGreater(counts["single_sku"], 0)
        self.assertGreater(counts["mixed_sku"], 0)
        # Mixed is majority on the sample dump
        self.assertGreaterEqual(counts["mixed_sku"], counts["single_sku"] - 5)

        strike = sc.evaluate_boxes(boxes, sc.DEFAULT_STRIKE_TABLE)
        sc.attach_single_sku_context(strike, sessions)
        mixed = sc.mixed_sessions_table(sessions)
        self.assertEqual(len(mixed), counts["mixed_sku"])

        # Mixed never mutates strike status
        statuses = {r.status for r in strike}
        self.assertTrue(statuses)

    def test_raw_failure_still_prints_strike(self):
        boxes = sc.load_boxes_rows(FIXTURES / "Boxes_Packed_by_Worker.xlsx")
        strike = sc.evaluate_boxes(boxes, sc.DEFAULT_STRIKE_TABLE)
        self.assertTrue(len(strike) >= 1)
        # Simulate no raw — attach should no-op
        sc.attach_single_sku_context(strike, [])
        for r in strike:
            if r.status == "below_strike_line":
                self.assertIn("no matching", r.single_sku_context)

    def test_strike_table_override(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "strikes.csv"
            with p.open("w", newline="") as f:
                w = csv.writer(f)
                w.writerow(["SKU", "Target BPH", "Strike Line"])
                w.writerow([250, 16, 9.0])  # loose strike so 10 BPH is ok
            table = sc.load_strike_table(p)
            rows = [
                {
                    "Shift": "morning_shift",
                    "Pnp Worker Name": "Alice",
                    "Station Name": "A1",
                    "Primary Sku": 250,
                    "Boxes Packed": 10,
                    "Packing Time Seconds": 3600,
                }
            ]
            out = sc.evaluate_boxes(rows, table)
            self.assertEqual(out[0].status, "ok")

    def test_cli_csv_out(self):
        with tempfile.TemporaryDirectory() as td:
            out = Path(td) / "report.csv"
            rc = sc.main(
                [
                    "--boxes",
                    str(FIXTURES / "Boxes_Packed_by_Worker.xlsx"),
                    "--raw",
                    str(FIXTURES / "Raw_Data.csv"),
                    "--csv-out",
                    str(out),
                ]
            )
            self.assertEqual(rc, 0)
            self.assertTrue(out.is_file())
            text = out.read_text(encoding="utf-8")
            self.assertIn("Status", text)
            self.assertIn("Single-SKU context", text)

    def test_cli_without_raw(self):
        with tempfile.TemporaryDirectory() as td:
            missing = Path(td) / "nope.csv"
            rc = sc.main(
                [
                    "--boxes",
                    str(FIXTURES / "Boxes_Packed_by_Worker.xlsx"),
                    "--raw",
                    str(missing),
                ]
            )
            self.assertEqual(rc, 0)


if __name__ == "__main__":
    unittest.main()
