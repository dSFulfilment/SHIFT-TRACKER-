# Shift Floor Planner

**Single-file offline app.** Download `index.html` and open it in your browser (double-click / File → Open). No server.

## Download

https://raw.githubusercontent.com/dSFulfilment/SHIFT-TRACKER-/cursor/shift-floor-planner-f7b8/index.html

Save that file, then open it. Your data stays in the browser on that computer (use **Backup** on Floor Plan if you want a copy).

## Features

- Floor Plan, Breaks, Shift Tracker, Packer (Day/Afternoon × Mon–Fri), Roster
- Whole-app **Backup** / **Restore** (toolbar on Floor Plan)
- Packer end-of-shift: Boxes Packed by Worker + Intra Hour CSVs
- **Week review** export: dates + boxes packed on each SKU
- People view merges duplicate names, lists SKUs, shows BPH target hit

## Optional developer tests

```bash
npm test
npm run verify:csv
```

`js/` is for Node tests only. The live app is the inlined copy inside `index.html`.
