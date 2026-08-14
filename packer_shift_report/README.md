# Packer shift report (Dandenong South)

Builds a Morning / Afternoon performance-vs-target workbook from the three
shift xlsx exports. Source files are never modified.

## Quick start

```bash
pip install -r requirements.txt

# Put the three exports in a folder (usual names work):
#   Boxes_Packed_by_Worker.xlsx
#   Intra_Hour_Floor_Performance.xlsx
#   Overall_Summary_by_Packer_and_Date.xlsx

python -m packer_shift_report --dir ./exports --out packer_shift_report.xlsx
```

Or pass paths explicitly:

```bash
python -m packer_shift_report \
  --boxes Boxes_Packed_by_Worker.xlsx \
  --intra Intra_Hour_Floor_Performance.xlsx \
  --summary Overall_Summary_by_Packer_and_Date.xlsx \
  --out report.xlsx
```

## Output sheets

| Sheet | Purpose |
| --- | --- |
| How this works | Plain-English method for supervisors |
| SKU targets | Hard-coded Target / Strike BPH (editable cells) |
| Raw data | Every packer+SKU line; Hours / BPH / targets as formulas |
| Morning shift | One row per packer, worst→best, red/amber/green |
| Afternoon shift | Same for afternoon |
| Exclusions | Counts by reason (blank SKU, &lt;15 min, etc.) |
| Intra hour (reference) | Kept for a later hour-slowdown view |

Morning / Afternoon metrics use `SUMIFS` into Raw data. Target BPH uses `INDEX`/`MATCH` into SKU targets.

## Rules (summary)

- Facility filter: summary rows with Facility Name = **Dandenong South** only
- Do **not** use summary blended Boxes per Hour for scoring
- Hours on SKU = Packing Time Seconds / 3600; drop lines &lt; 0.25 h
- % of target = boxes ÷ Σ(hours × SKU target) on included known-SKU lines
- Flags: Below target / Dipped below strike / On/above target
- Unknown Primary Sku → keep line, flag “no target defined for SKU X” (never guess)

## Packer tab

In the app, Packer accepts the same three xlsx files and shows Morning /
Afternoon tables. For the formula workbook, use this CLI.

## Tests

```bash
python -m unittest tests.test_packer_shift_report -v
```
