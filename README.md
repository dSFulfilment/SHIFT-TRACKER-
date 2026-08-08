# Shift Floor Planner

**Single-file offline app.** Download `index.html` and open it in a browser — no server.

## Live updates

Always-current file on the working branch:

https://raw.githubusercontent.com/dSFulfilment/SHIFT-TRACKER-/cursor/shift-floor-planner-f7b8/index.html

Save over your local copy and reopen to pick up changes. Browser data (localStorage) is kept on that machine.

PR: https://github.com/dSFulfilment/SHIFT-TRACKER-/pull/1

## Features

- Floor Plan, Breaks, Shift Tracker, Packer (Day/Afternoon × Mon–Fri), Roster
- Whole-app **Backup** / **Restore** (toolbar on Floor Plan)
- Packer end-of-shift: Boxes Packed by Worker + Intra Hour CSVs
- People view merges duplicate names, lists SKUs, shows BPH target hit
- CSV rows route by report date and Day/Afternoon (hour ≥14 → Afternoon)

## Optional developer tests

```bash
npm test
npm run verify:csv
```

`js/packer-analytics.js` is only for Node tests; the browser uses the copy inlined in `index.html`.
