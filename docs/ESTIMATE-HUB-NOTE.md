# Estimate Hub — pre-prompt note

Working note, not a spec. Captures the requirement as given so the build prompt
can be written from it later. Companion app to the Freight Hub; the two share
jobs and quantity breaks.

## What it does

**Job**
- Select an existing job by search — job name or job number.
- Create a new quote against it.
- Quantity breaks per quote, entered as unit quantities: 100, 200, 300, …

**Cost lines**
- Repeating list. Per line: quantity, total cost (input), and **cost per unit
  shown beside it as a read-only derived value**. Button to add more lines.
- Each line has an origin: **Australia, New Zealand, USA, China**.
- Cost is entered in the origin's currency — AUD, NZD, USD — except **China,
  which is entered in USD** (Chinese suppliers quote USD).

**Totals**
- All lines converted and totalled in **AUD**.
- Display toggle for AUD / NZD / USD. Display only — AUD stays the base.

**Freight**
- Imported directly from the Freight Hub for the matching quantity break, not
  re-entered. The freight figure already exists there against that break.

**Margin → price**
- Default is a **regression margin** on cost:
  - cost ≤ **$15,000 AUD** → **35%**
  - rising linearly to **25%** at **$150,000 AUD**
  - `margin% = 35 − 10 × (cost − 15,000) / 135,000`, clamped to 25–35
  - check: $15k → 35%, $82.5k → 30%, $150k → 25%
- Alternative: **client fixed margin**. Only arrangement so far is
  **Kenvue = 25.25%**. No others yet — build the table, seed the one row.

**Output**
- Quote disclaimers, editable in settings.
- Final quote rendered on our template, for the client to review.

## Decide before writing the build prompt

1. **Margin or markup?** "35%" can mean price = cost × 1.35 (markup, giving a
   25.9% gross margin) or price = cost ÷ 0.65 (true 35% margin). On $100 that is
   $135 vs $153.85. Needs to be settled explicitly, and the UI should say which
   it is.
2. **Margin on what base?** Goods cost only, or goods + freight? Changes both
   the price and which band of the regression the quote falls into.
3. **Which cost drives the band?** Same question again for the $15k/$150k
   thresholds — per quote, or per quantity break? A break-dependent margin is
   defensible but means the margin moves with quantity.
4. **Above $150k?** Assume held at 25% unless told otherwise.
5. **FX rates — source and storage.** Where do AUD/NZD/USD rates come from, and
   a quote must reproduce later, so store the rate used on the quote rather than
   re-converting at read time. Same discipline the Freight Hub uses for rate
   versions.
6. **Quantity break matching.** Freight Hub breaks are scale factors on a base
   carton list carrying a unit count; Estimate Hub breaks are unit quantities.
   The import matches on units — confirm the mapping holds when a job's cartons
   have mixed units per carton.
7. **Freight missing for a break.** What the quote shows when the Freight Hub
   has no figure for that quantity — blank, estimated, or blocked.

## Notes for the build

- Reuse the Freight Hub's conventions: derived values never editable, every
  figure traceable to an input or a stored rate, quotes saved as versions rather
  than overwritten.
- The per-unit cost beside each line is the same read-only-derived pattern as
  CBM-each in the calculator.
- Margin selection wants the same treatment as the estimating basis selector:
  show which rule produced the number, on the quote itself.
