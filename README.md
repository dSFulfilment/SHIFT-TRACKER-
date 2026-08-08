# Shift Floor Planner

Single-file warehouse shift tool (`index.html`). Open it in a browser — no server, works offline.

Includes:

- Floor Plan board (staff, SKUs, stations, annotations)
- Break Planner (role-based break groups)
- Shift Tracker (plan vs actual packing rate)
- Packer CSV import and performance dashboard
- Roster / week attendance

## Use it live (offline)

1. Download the latest `index.html` from the branch or PR (raw file).
2. Open that file in Chrome/Edge/Safari (double-click or File → Open).
3. Data stays in the browser (`localStorage` / host `window.storage` when available).

You only need `index.html`. Optional folders:

- `fixtures/` — sample CSVs for trying Packer upload
- `js/packer-analytics.js` + `tests/` — for developers running unit tests only

## Latest updates

Branch: `cursor/shift-floor-planner-f7b8`  
PR: https://github.com/dSFulfilment/SHIFT-TRACKER-/pull/1  

Raw HTML (always current on that branch):

https://raw.githubusercontent.com/dSFulfilment/SHIFT-TRACKER-/cursor/shift-floor-planner-f7b8/index.html

Save that file and reopen it whenever you want the newest build.

## Developer tests (optional)

```bash
npm test
npm run verify:csv
```
