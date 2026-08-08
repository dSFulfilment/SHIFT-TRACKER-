# Shift Floor Planner

**Single-file offline app.** Download `index.html` and open it in your browser (double-click / File → Open). No server.

## Download

https://raw.githubusercontent.com/dSFulfilment/SHIFT-TRACKER-/cursor/shift-floor-planner-f7b8/index.html

Save that file, then open it. Your data stays in the browser on that computer.

## Features

- Floor, Breaks, Tracker, Packer (Day/Afternoon × Mon–Fri), Roster, Settings
- **Settings** holds all exports, restores, and wipes (CSV + JSON)
- Packer end-of-shift: Boxes Packed by Worker + Intra Hour CSVs
- People view merges duplicate names, lists SKUs, shows BPH status

## Optional developer tests

```bash
npm test
npm run verify:csv
```

`js/` is for Node tests only. The live app is the inlined copy inside `index.html`.
