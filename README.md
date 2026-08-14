# Shift Floor Planner

**Single-file offline app.** Download `index.html` and open it in your browser (double-click / File → Open). No server.

Packer shift report (two xlsx → Morning / Afternoon vs SKU target) is **inlined in `index.html`** — no extra `js/` files needed to use it. For an auditable Excel workbook with formulas, also use the Python CLI.

## Download

https://raw.githubusercontent.com/dSFulfilment/SHIFT-TRACKER-/cursor/shift-floor-planner-f7b8/index.html

Save that file, then open it. Your data stays in the browser on that computer.

## Features

- Floor, Breaks, Tracker, Packer (Dandenong South shift report), Roster, Settings
- **Packer** — upload Boxes Packed by Worker + Intra Hour Floor Performance xlsx; Morning / Afternoon performance vs SKU target
- **Settings** holds exports, restores, and wipes

## Packer shift report (Excel)

```bash
pip install -r requirements.txt
python -m packer_shift_report --dir ./exports --out packer_shift_report.xlsx
```

See `packer_shift_report/README.md` for column validation, the 15-minute filter, and formula sheets.

## Optional developer tests

```bash
npm test
npm run verify:csv
```
