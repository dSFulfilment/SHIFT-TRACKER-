# Shift Floor Planner

Single-page warehouse shift tool with:

- Floor Plan board (staff, SKUs, stations, annotations)
- Break Planner (role-based break groups)
- Shift Tracker (plan vs actual packing rate)
- Packer CSV import and performance dashboard

## Run the dashboard

Open `index.html` in a browser, or from this folder:

```bash
npm start
```

Then visit http://localhost:8080 and use the bottom nav to open **Packer**.

Data persists in local storage (or the host `window.storage` API when available). Original CSV text is stored unchanged alongside cleaned analytics rows.

## Packer CSV

Upload one or more CSV exports. Headers are auto-detected (case-insensitive). Supported shapes:

- **Summary** — Shift, worker, station, boxes (+ optional items/pouches/seconds/SKU)
- **Hourly** — Worker, report date hour, boxes
- **End of shift** — Worker, SKU, boxes, packing hours
- **Detailed** — Worker + boxes with optional date/hour/shift/station/SKU/idle/target

Sample fixtures live in `fixtures/`.

## Tests

```bash
npm test
npm run verify:csv
```
