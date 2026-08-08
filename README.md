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

## App file

**Use only `index.html`.** Open it in a browser — Floor Plan, Breaks, Shift Tracker, Packer, and Roster are all inside that one file. No server and no other app files needed.

## Optional developer tests

```bash
npm test
npm run verify:csv
```

`js/` is for Node tests only. The live app is the inlined copy inside `index.html`.
