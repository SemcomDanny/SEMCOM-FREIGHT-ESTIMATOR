# Reverse prompt — Freight Estimator module for the Semcom PMS portal

Paste the whole of the "PROMPT" section below into Lovable. Everything above it
is context for whoever is doing the pasting.

---

## Before you paste

**What this is.** A working prototype of a freight estimating tool exists as a
separate Node/React application. This document is a specification precise enough
to rebuild it inside the existing Lovable-built PMS portal, as a sub-section
rather than a standalone app.

**Why it is this long.** Most of the value is not in the screens — it is in a
dozen small rules that are wrong by default and expensive to discover: the
chargeable-volume rule freight is actually billed on, a rate curve that must not
dip, cost rows that must reconcile, rate versions that must never be
overwritten. Each of those was a real bug in the prototype before it was a rule
here. Cutting them shortens the prompt and lengthens the debugging.

**How to use it.** Paste it in one go. Lovable will not finish in one pass — the
prompt is written in five stages, and the last line of each stage tells it to
stop. Work through them in order, checking the acceptance criteria at the end of
each stage before moving on.

**What to change first.** Search the prompt for `[PORTAL:` — those are the five
places where it needs to know something about your existing portal (auth table,
role model, layout component, route prefix, brand). Fill them in before pasting.

---

## PROMPT

You are adding a **Freight Estimator** module to an existing property/project
management portal. It is a sub-section of that portal, not a new application.

### Integration constraints — read first

- Mount everything under the route prefix `[PORTAL: route prefix, e.g. /freight]`.
- Wrap every screen in the portal's existing layout/shell component
  `[PORTAL: layout component name]`. Do not build a new nav, header or sidebar.
- Use the portal's existing Supabase Auth. Do **not** create a users table.
  Reference `auth.users` and the portal's existing profile table
  `[PORTAL: profiles table name]`.
- Two capabilities, expressed against the portal's existing role model
  `[PORTAL: how roles are stored, e.g. profiles.role text column]`:
  - **estimator** — the default. Creates and edits jobs, runs calculations,
    exports. Read-only on rates.
  - **freight_admin** — all of the above, plus creating rate versions and
    editing lanes, containers, pallets and settings.
- Match the portal's existing visual language `[PORTAL: brand/theme notes]`.
  Use shadcn/ui components and Tailwind. Dense, table-heavy, keyboard-friendly:
  this is a tool people use forty times a day, not a marketing page.
- Stack: React + TypeScript + Tailwind + shadcn/ui + Supabase (Postgres, Auth,
  Storage, Edge Functions). Recharts for charts. react-three-fiber + drei for 3D.

### The domain, in one paragraph

A small import team receives a carton list from a supplier, works out how much
space it takes, decides whether it ships as loose cartons in a shared container
(LCL), a whole container (FCL) or by air, prices it against rates their
forwarder quoted, and puts a freight figure into a customer quote. The tool must
get them from a pasted carton list to a defensible price in under a minute, and
must make every number traceable to an input or a stored rate months later.

### Non-negotiable domain rules

These are the rules that are wrong by default. Implement them exactly.

1. **Chargeable volume is not volume.** LCL bills on the W/M revenue tonne:
   `chargeable_cbm = max(total_cbm, total_kg / 1000)`. Show actual and
   chargeable volume as separate figures, always both visible, never conflated.
   Flag any consignment over 1,000 kg/CBM as weight-charged.

2. **The LCL rate curve must never fall as volume rises.** The forwarder quotes
   a total price at three volumes (e.g. 1, 5, 15 CBM) and the app interpolates.
   A quadratic through three points dips in the middle — that would price more
   cargo cheaper than less, which is nonsense that reaches a customer quote.
   Default to **monotone piecewise-linear** interpolation, passing exactly
   through every quoted point, extrapolating off each end at the adjacent
   segment's slope **floored at zero**. Offer log-linear (`a + b·ln V`) and
   power (`a·V^b`) as alternatives with their slope clamped non-negative, and
   show R² and per-point residuals for each. If the quoted points themselves
   fall, correct them with isotonic regression (pool-adjacent-violators) and
   **tell the admin what was adjusted** rather than silently fixing it.

3. **Rates are append-only.** Saving a rate change inserts a new version and
   stamps the previous one's `superseded_by`. Nothing is ever updated in place.
   An estimate saved six months ago must still resolve to the exact rate version
   it was priced on. Every rate write is audited.

4. **Every cost row must reconcile.** `ocean + port_charges + ancillaries =
   total`, exactly, on screen and in every export. FCL origin and destination
   charges are a separate visible column — if they are folded into the total but
   not shown, the row silently does not add up and nobody trusts the tool again.

5. **The container fit is geometry, not pricing.** Work out how the cargo loads
   whether or not the lane has rates. With no FCL rate there is no cost to
   minimise, so choose the mix that uses the fewest containers.

6. **A forecast is never a quote.** Trailing-average and trend rates must be
   labelled "Forecast" everywhere they appear, including exports.

7. **Say it is an estimate.** The packing result is a deterministic heuristic
   with a stow-efficiency factor, not a stow plan. Display "Estimate only —
   actual stow subject to forwarder/packer" on the loading screen and in the
   forwarder email.

---

### Stage 1 — Data model and master data

Create these Postgres tables with RLS. Read for any authenticated portal user;
write on the rate and master-data tables restricted to `freight_admin`.

```
freight_lanes(id, origin_port, destination_port, active, unique(origin,destination))
freight_container_types(id text pk, name, int_l_mm, int_w_mm, int_h_mm, max_payload_kg, active)
freight_pallet_types(id text pk, name, l_mm, w_mm, deck_h_mm, max_load_h_mm, max_load_kg, overhang_mm, active)

freight_rate_cards(id, lane_id, mode check in ('LCL','FCL','AIR'), currency,
                   fx_to_aud, effective_from date, entered_by, entered_at,
                   note, superseded_by)
freight_fcl_rates(id, rate_card_id, container_type_id, ocean_cost, origin_charges, dest_charges)
freight_lcl_points(id, rate_card_id, volume_cbm, total_price)
freight_lcl_config(rate_card_id pk, fit_model, min_charge, min_cbm)
freight_air_rates(rate_card_id pk, min_charge, breaks_json, fuel_surcharge_per_kg,
                  security_surcharge_per_kg, volumetric_divisor)
freight_ancillary_charges(id, rate_card_id, name,
                          basis check in ('per_shipment','per_cbm','per_container','per_kg'), amount)

freight_jobs(id, ref, client, lane_id, status check in ('Draft','Quoted','Won','Lost'),
             incoterm, commodity, hs_code, cargo_ready_date, dangerous_goods,
             loading_mode, pallet_type_id, stow_efficiency, fx_override, notes,
             breaks_json, created_by, created_at, updated_at)
freight_job_lines(id, job_id, position, description, l_mm, w_mm, h_mm, weight_kg,
                  qty, units_per_carton, stackable, max_layers, this_way_up)
freight_job_results(id, job_id, mode_selected, rate_card_id, total_cost,
                    breakdown_json, calculated_at)
freight_job_actuals(id, job_id, invoiced_cost, invoice_ref, note, entered_by, entered_at)

freight_carton_library(id, sku unique, description, l_mm, w_mm, h_mm, weight_kg,
                       units_per_carton, stackable, max_layers, created_at, updated_at)
freight_settings(key pk, value)
freight_audit_log(id, entity, entity_id, action, changed_by, changed_at, detail_json)
```

Seed this master data exactly:

**Containers** (internal dimensions — treat as editable defaults, carrier
variance is real):

| id | name | L × W × H (mm) | Max payload |
|---|---|---|---|
| 20GP | 20' GP | 5900 × 2350 × 2390 | 28,000 kg |
| 40GP | 40' GP | 12030 × 2350 × 2390 | 26,500 kg |
| 40HC | 40' HC | 12030 × 2350 × 2690 | 26,500 kg |

**Pallets** (all: deck 150 mm, max load height 1,150 mm, max load 1,000 kg,
overhang 0):

| id | name | Footprint |
|---|---|---|
| AU-STD | Australian Standard | 1165 × 1165 |
| EUR1 | Euro EUR1 | 1200 × 800 |
| EUR2 | Euro EUR2 / Industrial | 1200 × 1000 |

**Settings defaults:** `stow_efficiency` 0.85, `stale_rate_days` 60,
`default_duty_pct` 5, `default_gst_pct` 10, `pallet_tare_kg` 25.

Build an **Admin** screen for lanes (create, deactivate, delete), container
types, pallet types and settings. Deleting a lane must be **refused** while any
rate version or job references it, with a message telling the user to deactivate
instead — deactivating hides it from the estimator and keeps the history.

**Stop here.** Confirm the tables, RLS and admin screen work before continuing.

---

### Stage 2 — The calculation engine

Put every calculation in `src/lib/freight/` as pure TypeScript with no React and
no Supabase imports. It must be unit-testable on its own; this is where the
accuracy guarantees live. Canonical units throughout: millimetres, kilograms,
cubic metres.

**`units.ts`** — mm/cm/in and kg/lb conversion, mm³→CBM.

**`cartons.ts`** — per-line volume and weight; consignment totals; density;
`chargeable_cbm = max(cbm, kg/1000)`; which of the two drove it.

**`paste.ts`** — parse a block pasted from Excel. Tab-separated first, then
comma, then two-or-more spaces. Skip a header row. Handle rows with and without
a leading description column. Strip thousands separators, currency symbols,
non-breaking spaces and trailing unit suffixes. Return per-row errors rather
than silently dropping rows. **This one feature saves the team the most time —
make it forgiving.**

**`pallets.ts`** — cartons per layer, testing: both 0°/90° uniform orientations,
plus filling the leftover strip along L and along W with cartons turned 90°
(this is the simple form of the pinwheel patterns packers actually use). Take
the best count, tie-broken by tighter footprint, deterministically. Layers from
`floor(max_load_h / carton_h)`, capped by stackability, max stack layers, and
pallet weight limit. Output cartons/layer, layers, pallets, loaded height, gross
weight, and the **cubed volume** (footprint × loaded height) — that, not carton
volume, is what governs container fit. Cube the part-filled tail pallet at its
own shorter height, not full height.

**`packing.ts`** — deterministic 3D heuristic, not a true optimum:
1. Group identical items into rectangular blocks.
2. Try every allowed orientation (6, or 2 if "this way up") in every free space.
3. Take the block that fills the most volume; ties go to lowest z, then most
   door-ward.
4. Guillotine-split the consumed space into the three remaining cuboids.
5. Sort items heaviest-first so heavy cargo lands on the floor.
6. Never create the space above a non-stackable item. **A `max_stack_layers`
   limit must seal the column, not merely cap one block** — otherwise a second
   block stacks on the first and the limit is silently exceeded.
7. Stop filling a container when placed volume reaches `stow_efficiency ×
   interior volume`, or when payload is reached (flag which).

Report per container: placements with positions, volumetric utilisation, payload
utilisation, and anything unplaced with a reason.

**`curve.ts`** — LCL curve fitting per rule 2 above. Also `chargeableLclPrice`
applying minimum CBM then minimum charge, in that order.

**`costing.ts`** —
- LCL: `curve(chargeable_cbm)` + ancillaries.
- FCL: cheapest container mix + per-container ocean/origin/dest + ancillaries.
  Evaluate three candidate families and take the cheapest that places
  everything: *n* of one type; that with the last container downsized to any
  other type; and a greedy mix picking the best cost-per-CBM-loaded each round.
- Air: `chargeable_kg = max(gross_kg, cbm × 1,000,000 / divisor)` with divisor
  6000. Weight breaks at 0/45/100/300/500 kg, applying the standard rule that
  you pay for a **higher break if it comes out cheaper** — `min over breaks of
  max(chargeable_kg, threshold) × rate`. Then fuel and security per kg.
- Every cost component carries a human-readable formula string and the id of the
  rate version it came from. The UI shows these on hover. Report `ocean_cost`,
  `port_charges_cost` and `ancillaries_cost` separately so rows reconcile.
- Apply FX to AUD from the rate card, overridable per estimate.

**`compare.ts`** — run every priced mode, default to the cheapest, and produce a
one-line reason: *"LCL selected — $412 cheaper than 1 × 20' GP"*. Compute all
modes in one pass so the UI toggle needs no recalculation.

**Breakeven**: the volume at which FCL becomes cheaper than LCL. FCL is a step
function of volume and LCL is continuous and increasing, so walk the
container-count step boundaries and bisect inside the interval where they cross.
Hold the consignment's density constant while scaling. Label it as volume-based
and state that assumption on screen — the cargo shape is hypothetical at that
point, so a 3D pack cannot answer it.

**`breaks.ts`** — quantity breaks. A break is a label plus a multiplier on the
base carton quantities (rounded to whole cartons, never rounding a non-zero line
to nothing). Cost each break independently — packing, mode choice and all — and
report freight per carton and per unit, plus the percentage change against the
base. Also expose `multiplierForUnits(lines, targetUnits)` so a user can ask for
"2,000 units" rather than "1.6×".

**`stats.ts`** — reduce each rate version to one comparable number so versions
can be charted: FCL at a chosen container type, LCL at a **nominated reference
volume** (a whole curve moving is not one number), air at a reference weight.
Then min/max/mean/population-stdev over 3/6/12-month windows, change vs previous
version, trailing-average and linear-trend forecasts, and staleness against the
threshold.

**`validation.ts`** — zero/negative dimensions; a carton that fits no available
container in any orientation; single cartons over 30 kg (manual handling);
pallet loads over height or weight; payload rather than volume forcing an extra
container; and specifically: **Australian Standard pallets in ISO containers** —
two 1165 mm pallets across is 2,330 mm in a 2,350 mm internal width, leaving
20 mm total clearance. Warn, with those numbers in the message.

**`landed.ts`** — indicative landed cost. Duty on the **customs value**, GST on
**CIF + duty**. Label it indicative, not customs advice.

Write unit tests for the engine — at minimum the acceptance criteria at the end
of this prompt.

**Stop here.** Confirm the engine tests pass before building any UI.

---

### Stage 3 — The estimator screen

One screen, top to bottom. Everything recalculates as the user types; the
calculation is fast enough (~25 ms for 1,800 cartons) that no debounce is needed.

**Job bar.** Job number, client, lane, status, with "Open a job" and "New job".
An estimate belongs to a job, so the job is where you start. Highlight the job
number field until it is filled in.

**Carton table.** Columns: description/SKU, L, W, H, gross kg, cartons,
units/carton, CBM each, CBM total. A colour swatch per row that matches the 3D
view. Unit toggle (mm/cm/in, kg/lb) above the table. Enter on the last row adds
another. Per row: duplicate, save to carton library, delete. A collapsible
"stacking constraints" section for stackable / max stack layers / this way up. A
**"Paste from Excel"** dialog that previews what it parsed, lists unreadable
rows, and offers append or replace.

**Quantity break tabs.** A row of tabs — "As entered", "2×", "3×", "+ Add
quantity". The carton rows hold the *base* quantities; selecting a tab scales
them and switches the **whole screen** — totals, packing, 3D view, costing — to
that order size. "+ Add quantity" accepts either a target unit count or a
multiple. Clients ask what freight costs at hypothetical MOQs and the answer is
rarely proportional, so this must be one click, not a re-entry.

**Live totals bar.** Cartons, total volume, gross weight, density, chargeable
(W/M) volume, units. Chargeable volume gets a hover explaining the max() rule.
Warn prominently when the consignment is weight-charged.

**Tabs below**, in this order:

1. **Cost estimate** — side-by-side LCL / FCL / Air: mode, basis, ocean/air,
   origin+dest, ancillaries, total, total AUD, per CBM, per carton, per unit.
   Cheapest highlighted, with the saving stated. A toggle that switches the
   detailed breakdown without recalculating. Every component expandable to its
   formula and rate version. Then the breakeven volume, with how far the current
   consignment is from it. Banners for stale rates, for a forecast basis, and
   for rate versions that exist but are not yet in force.

2. **Quantity breaks** — every quantity side by side: cartons, units, CBM, kg,
   mode, basis, freight, per carton, per unit, and change vs base. Mark the best
   per-unit row. Clicking a row switches the estimator to that quantity. A "copy
   for Excel" button.

3. **Loading & 3D view** — floor-loaded vs palletised toggle; stow efficiency
   slider (default 85%); pallet type and per-estimate overrides for max load
   height, max weight, overhang. A palletisation table (per layer, layers, per
   pallet, pallets, loaded height, pallet gross, cubed CBM) with the cubed total
   stated against the carton total. Container fit summary with utilisation. Then
   the 3D view — see Stage 4.

4. **Calculation report** — an internal record of how the figure was reached:
   consignment breakdown, loading assumptions, stow factor, container fit, every
   cost line with its formula and rate version, totals, warnings. Copyable and
   downloadable. Below it, a configurable column mapper — the user renames and
   reorders columns to match their existing quote spreadsheet — with copy-to-
   clipboard (tab-separated, for pasting into Excel), CSV and XLSX.

5. **Job & actuals** — saved estimate history for this job; entry of the
   invoiced freight once the job closes, with variance against the estimate; and
   an optional landed-cost panel (goods value, insurance, duty %, GST %).

**Save bar, fixed to the bottom of the screen.** Shows "Unsaved changes" in
amber or "Saved at 14:32" in green, plus job number, active quantity and current
figure, with a Save button always in reach. Do not put saving on a tab — work
gets lost. **The save handler must read current state through refs, not close
over it**, or it will silently save stale values.

**Stop here.** Confirm the estimator calculates and saves before building 3D.

---

### Stage 4 — 3D loading view

react-three-fiber. Scale mm to metres for the scene.

- Container as a wireframe box with optional transparent walls.
- One `InstancedMesh` per carton type — thousands of cartons must stay
  interactive.
- **Every box needs a wireframe outline.** Without it, stacked same-colour
  cartons render as one solid mass and you cannot see how many there are. An
  `InstancedMesh` cannot carry per-instance edges, so build the 12 edges of
  every box once into a single merged `LineSegments` geometry — one draw call,
  drawn over the solid boxes.
- **Draw the pallet deck separately.** A palletised item arrives as one block
  covering deck plus cargo; rendered that way you cannot tell there is a pallet
  under the load. Carry the deck height on each placement and render it as a
  timber-coloured slab beneath the cargo, with a legend entry.
- Colours must match the carton table exactly — one shared palette indexed the
  same way in both.
- Controls: orbit/pan/zoom; preset Iso / Top / Side / Door-end views; transparent
  walls toggle; click a legend entry to isolate one carton type; a slider to step
  through the loading sequence; container selector when there is more than one.
- **Export PNG** — requires `preserveDrawingBuffer: true` on the canvas and a
  fresh render immediately before `toDataURL`.
- Show volumetric and payload utilisation under the view, agreeing exactly with
  the packing result.

**Stop here.**

---

### Stage 5 — Rates, history and the forwarder portal

**Rates screen** (admin writes, everyone reads). Lane and mode selector. A
version list showing effective date, currency, who entered it, the note, and
whether it is current or superseded — nothing is ever removed. A "copy into
form" button to base a new version on the current one.

The new-version form per mode:
- **LCL**: a volume/price point table (three minimum, more allowed) with implied
  per-CBM shown; fit model selector; minimum CBM and minimum charge. **A live
  chart** plotting the quoted points against the fitted curve, with R²,
  residuals, the value at 0.5 and 25 CBM, and a blocking warning if the fit
  falls anywhere in range.
- **FCL**: ocean, origin and destination charges per container type, with the
  all-in total per container.
- **Air**: weight breaks, minimum charge, fuel and security surcharges,
  volumetric divisor.
- Ancillary charges for all modes, with suggestions: customs clearance, CTO /
  unpack fee, quarantine (DAFF) inspection, fumigation, delivery cartage,
  documentation. **These decide the answer as often as the ocean rate does** — a
  cheap per-CBM LCL rate loses to FCL once destination charges are counted.

**Rate history screen.** Line chart of the comparable value per version over
time; variance table over all time and 3/6/12 months; change vs previous
version; and the forecast options, each labelled Quoted or Forecast. The
estimator has an "Estimating basis" selector that applies a forecast as a ratio
against the current quoted rate — **applied to freight only, never to ancillary
charges**, which do not move with the ocean market.

**Forwarder rate request portal.** From the Rates screen, an admin enters a
forwarder's email and one click sends a tokenised link. The forwarder opens it
**without an account**, enters LCL and FCL rates and ancillaries, optionally
attaches their PDF quote, and submits. The admin reviews and imports it as a new
rate version in one click, with the forwarder named in the version note.

Terms are fixed and stated on the email, on the form, and on the FCL table
header: **Incoterm FOB, quoted in AUD, and destination charges must include
delivery of the container to one metro address in the destination city** (derive
the city from the lane — Shenzhen→Sydney says Sydney). A quote to the wharf is
not comparable with one to the door, and forwarders quote to the wharf unless
told otherwise.

Supabase specifics for the public portal:
- Tables `freight_forwarders`, `freight_rfq_requests` (token, lane, forwarder,
  status, expiry, consignment snapshot), `freight_rfq_responses` (append-only —
  a corrected quote is a new row and the latest wins).
- The public page is anonymous, so do **not** expose the tables to `anon`.
  Expose two `SECURITY DEFINER` functions that take the token: one returning
  only that request's public view, one accepting a submission. RLS stays closed.
- Token: 32 random bytes as hex, format-checked before lookup, with an expiry
  (default 21 days).
- PDF upload to a **private** Storage bucket. Cap at 10 MB. **Verify the file
  actually begins with `%PDF-`** — the content type is supplied by the uploader
  and trivially faked. Serve it back only to signed-in staff via a signed URL,
  always as an attachment.
- Rate-limit the public endpoints on **every** request, not just failures.
- The public view must expose one lane and nothing else — no token, no your-side
  rates, no other forwarder's quote.
- Email via an Edge Function (Resend or your provider). If no provider is
  configured, return the link and a `mailto:` URL so the estimator can send it
  themselves — that is a supported path, not a failure.

---

### Traps that cost real debugging time

Every one of these was a live bug in the prototype.

1. **Cost rows that do not add up.** FCL origin and destination charges were in
   the total but in no column: $1,600 + $220 shown, $2,920 charged. Give port
   charges their own field and assert `ocean + port + ancillaries = total` in a
   test.

2. **`??` versus `||` on form and config values.** A multipart form posts
   untouched fields as empty strings, and `'' ?? fallback` keeps the empty
   string. An empty signing key, an empty effective date. Normalise blanks to
   null on the way in, and test truthiness where a value must be present.

3. **Future-dated rate versions.** A forwarder quotes rates valid from a date
   two weeks out. The version saves correctly, is not in force, and the
   estimator says "no priced option" with no explanation. Report the effective
   date on import, and show scheduled rates on the estimator.

4. **A stale build looks exactly like a broken deploy.** If you cache or skip a
   build step after fetching new source, you serve the old version and nothing
   indicates it.

5. **Stack limits that only limit one block.** Covered above; it needs a test
   that asserts no placement sits above the limit.

6. **The 3D view depending on rates.** Loading is geometry. Do not gate it on
   pricing.

7. **Rounding a scaled quantity to zero.** A 0.1× break on a single-carton line
   must not produce zero cartons.

8. **Breakeven that does not balance.** At the reported breakeven volume, LCL
   and FCL totals must come out within $1 of each other. Test it.

---

### Acceptance criteria

1. Three carton types and quantities produce total CBM, gross weight and
   chargeable volume within 0.01 CBM of a manual calculation.
2. A consignment over 1,000 kg/CBM is flagged weight-charged and bills on
   `kg/1000`, with actual volume still shown separately.
3. Pasting a tab-separated Excel block with a header row creates the right rows;
   unreadable rows are reported, not dropped.
4. Three LCL points produce a curve that is monotonic across 0.1–200 CBM, passes
   exactly through all three points in piecewise-linear mode, and extrapolates
   sensibly to 0.5 and 25 CBM.
5. Quoted points that fall are corrected by isotonic regression and the
   adjustment is reported.
6. Changing an FCL rate creates a new version; the previous one remains
   queryable and appears on the history chart.
7. For a consignment where LCL is cheaper, the output defaults to LCL, states
   the saving, and the toggle switches to FCL without recalculating.
8. `ocean + port charges + ancillaries` equals the total, for every mode.
9. The breakeven CBM, entered as a consignment volume, produces LCL and FCL
   totals within $1 of each other.
10. Packed cartons never overlap and never exceed the container's interior; a
    container never exceeds `stow_efficiency × interior volume` or its payload.
11. A "this way up" carton keeps its height axis vertical; a `max_stack_layers`
    limit is never exceeded anywhere in the container.
12. The 3D view renders each carton type in a distinct colour with a matching
    legend, individual boxes visibly outlined, pallet decks visible, and
    utilisation percentages agreeing with the packing result.
13. Quantity breaks: total freight rises with quantity while freight per unit
    falls, and each break is priced on its own cheapest mode.
14. The container fit is produced on a lane with no rate cards at all.
15. Export columns can be renamed and reordered, and paste into a spreadsheet
    without rework.
16. A forwarder opens the tokenised link with no account, submits rates and a
    PDF, and an admin imports it as a rate version in one click.
17. A non-PDF upload with a faked content type is rejected and leaves no file.

---

### Build order

Ship each stage usable on its own: **(1)** data model and admin → **(2)** engine
with tests → **(3)** estimator screen → **(4)** 3D view → **(5)** rates, history
and the forwarder portal.
