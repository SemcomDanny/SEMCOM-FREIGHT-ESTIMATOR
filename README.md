# Semcom Freight Estimator

Internal tool for costing a carton-based consignment: enter the cartons, see the
volume and chargeable volume immediately, watch how it loads into containers or
onto pallets, and get an LCL / FCL / airfreight comparison that feeds the
existing quote spreadsheet.

It is an **estimating** tool. It does not book, it does not talk to forwarders,
and it is not a TMS.

## What it does

**Carton entry.** Paste a block straight out of Excel, or type it. Volume,
gross weight, density and chargeable volume update on every keystroke. Carton
specs can be saved to a library and reused by SKU.

**Chargeable volume.** LCL bills on the W/M revenue tonne — `max(CBM, kg/1000)`.
Actual and chargeable volume are shown separately everywhere and never
conflated. Anything over 1,000 kg/CBM is flagged as weight-charged.

**Loading.** Floor-loaded or palletised. Palletising works out cartons per layer
across both orientations plus leftover-strip fills, layers from the height and
weight limits, and the cubed volume that actually governs container fit. The
packer is a deterministic block-and-guillotine heuristic, not a true 3D optimum,
with a stow efficiency factor (default 85%) applied to the theoretical fit. The
3D view colour-codes each carton type to match the input table, isolates a type,
steps through the loading sequence, and exports a PNG for the RFQ email.

**Costing.** LCL off a fitted three-point curve, FCL off the cheapest container
mix, airfreight off a weight-break structure — all with ancillary charges, FX,
and a formula and rate version behind every figure. The output defaults to
whichever is cheaper, states the saving, and toggles without recalculating. The
breakeven volume tells you whether it is worth asking the client to order more.

**Rates.** Append-only. Saving a change writes a new version and stamps the old
one superseded; nothing is overwritten, so an estimate from six months ago still
resolves to the rates it was priced on. Rate history charts variance over time
and offers a trailing average or linear trend as the estimating basis — always
labelled Forecast, never Quoted.

**Forwarder rate requests.** Send a forwarder a tokenised link from the Rates
tab. They enter LCL and FCL figures and their ancillaries without an account,
and can attach their PDF quote. You review it and import it as a normal rate
version, forwarder named in the note. Email is sent via SMTP if configured, and
otherwise the link is handed to you to send yourself.

**Workflow.** A one-button forwarder RFQ email, CSV/XLSX/clipboard export with
your own column headings and order, saved jobs with version history, invoiced
actual vs estimate, and an indicative landed cost.

## Running it

```bash
git clone https://github.com/SemcomDanny/SEMCOM-FREIGHT-ESTIMATOR.git
cd SEMCOM-FREIGHT-ESTIMATOR
git checkout claude/freight-estimate-container-tool-ryc7mq
npm install
npm run setup
npm run dev
```

The `git checkout` line is only needed until this work reaches `main`. `npm run
dev` puts the API on :4000 and Vite on :5173.

Needs Node 22 or 24 — the database library only ships pre-compiled builds for
those, and `npm install` refuses to start on anything older rather than
producing a wall of compiler errors.

Sign in with the seeded admin (`SEED_ADMIN_EMAIL`, default
`admin@sem.com.au`). **Change that password before anyone else uses the tool.**

**To run it for the team, see [DEPLOY.md](DEPLOY.md).** The short version:

```bash
npm install && npm run setup && npm run build && npm start
```

The API serves the built frontend, so there is one process and one port, and
everyone else reaches it on the host machine's network address. A Dockerfile is
included if you would rather run it as a container.

Everything lives in one SQLite file (`data/semcom.db`) — every rate version,
job and audit record. `npm run backup` takes a safe copy while the tool is
running. Set it up on a schedule; see DEPLOY.md.

There is no public sign-up. An admin creates users under Admin → Users.

## Layout

```
engine/   Pure TypeScript calculation engine — no framework, no I/O.
          Packing, palletising, curve fitting, costing, forecasting. Unit tested.
server/   Express + SQLite. Auth, rate versioning, jobs, audit log.
web/      React + Vite + Tailwind UI. Runs the engine client-side for live
          figures; the server runs the same engine for what gets stored.
```

The engine is deliberately independent of both. `npm test` exercises it on its
own, which is where the accuracy guarantees live.

```bash
npm test                  # engine unit tests
npm run build             # engine, then web, then server
```

## Things worth knowing before you trust a number

**Container dimensions are defaults, not gospel.** Internal dimensions vary by
carrier and build. Admin → Container types is editable for exactly that reason.

**The packing result is an estimate.** It is a deterministic heuristic with a
stow efficiency factor, not a stow plan. The screen says so; keep saying so to
clients. Actual stow is the packer's call.

**The LCL curve cannot dip.** A quadratic through three points can fall in the
middle, pricing more cargo cheaper than less. Every fit here is constrained
monotonic: piecewise linear passes through the quoted points exactly and
extrapolates off each end at the adjacent slope floored at zero; log-linear and
power fits have their slope clamped non-negative. If the quoted points
themselves fall, they are corrected by isotonic regression and the change is
reported rather than applied silently.

**Ancillaries decide the answer as often as the ocean rate does.** A $180/CBM
LCL rate loses to FCL far sooner once $650 of destination charges are in. Enter
them.

**The breakeven is volume-based.** It assumes the consignment keeps its current
density and the current stow factor. It answers "how much more cargo before FCL
wins", which is a hypothetical-shape question that a 3D pack cannot answer.

**A forecast is not a quote.** Trailing average and trend rates are labelled
Forecast in the UI and in the export. Do not paste one into a client quote as a
firm rate.

**Landed cost is indicative.** Duty sits on the customs value, GST on CIF plus
duty. Tariff classification, FTA concessions and valuation rules can move both
materially. It is not customs advice.

**Australian Standard pallets load badly in ISO containers.** Two 1165 mm
pallets across is 2,330 mm in a 2,350 mm internal width, leaving 20 mm total
clearance. The tool warns; the warning is worth reading.
