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

**Offshore allowance** (the "10%")
- Despite the legacy name *freight & GST allowance*, it is **an arbitrary company
  buffer** against overseas suppliers under-quoting and against communication
  error. It is not freight and not GST, so it does not double-count the freight
  imported from the Freight Hub. Name it what it is in the UI.
- **One toggle per quote, applied to every offshore line** — not per line item.
- Multiply by **1.10 in the origin currency, before conversion**. US$100 →
  US$110 → convert.
- **Offshore = any origin except Australia.** New Zealand counts as offshore
  manufacturing and gets the allowance.
- The ×1.10 and the FX multiply commute, so the AUD figure is the same either
  way — but the line must **display the grossed-up origin-currency figure**, so
  apply it in this order and carry full precision, rounding only for display.

**FX**
- Rates from **xe.com, refreshed daily**.
- Apply a **5% buffer**: `rate_used = xe_rate × 1.05`. Buffer applies to any
  non-AUD conversion; AUD lines are unaffected.
- Store `xe_rate`, the buffer and `rate_used` **on the quote**, so it reproduces
  later rather than re-converting at today's rate.
- Note the two buffers stack on an offshore line: `1.10 × 1.05 = 1.155`, a
  **15.5% uplift before markup**. Deliberate and for different risks, but worth
  being a visible number rather than a surprise.

**Price**

Per line:
```
adjusted_origin = cost_in_origin_currency × (offshore_toggle && origin != AU ? 1.10 : 1.00)
rate_used       = xe_rate(origin_currency → AUD) × 1.05      -- 1.00 for AUD lines
line_aud        = adjusted_origin × rate_used
```

Then:
```
goods_aud  = Σ line_aud
base_aud   = goods_aud + freight_aud        -- freight from the Freight Hub
price_aud  = base_aud × (1 + markup_rate)
```

**It is markup on cost, not margin.** $100 cost → $135 charged. Label it
"markup" in the UI, because the achieved gross margin is lower than the number
reads and people will otherwise assume they are the same:

| Markup | Price on $100 | Actual gross margin |
|---|---|---|
| 35% | $135.00 | 25.9% |
| 30% | $130.00 | 23.1% |
| 25% | $125.00 | 20.0% |
| 25.25% (Kenvue) | $125.25 | 20.2% |

**Markup rate** — default is the regression on `base_aud`:
- ≤ **$15,000** → **35%**
- rising linearly to **25%** at **$150,000**
- `markup% = 35 − 10 × (base_aud − 15,000) / 135,000`, clamped to 25–35
- check: $15k → 35%, $82.5k → 30%, $150k → 25%

Alternative: **client fixed markup**. Only arrangement so far is
**Kenvue = 25.25%**. No others yet — build the table, seed the one row.

**Output**
- Quote disclaimers, editable in settings.
- Final quote rendered on our template, for the client to review.

## Settled

- **Markup, not margin.** `price = base × (1 + rate)`. $100 cost → $135.
- **Base is always goods + freight**, in AUD — for the price *and* for the
  $15k/$150k band test.
- **Offshore allowance is ×1.10 in origin currency, before FX**, toggled once
  per quote, applied to every non-Australian line.
- **New Zealand is offshore.**
- **FX is xe.com daily + a 5% buffer.**
- The 10% is a risk buffer, not freight or GST — no double-count with the
  Freight Hub figure.

## Still to decide

1. **Above $150k?** Assumed the markup holds at 25%.
2. **Kenvue's 25.25%.** The internal rule is markup, but a client arrangement is
   often negotiated as margin. Worth confirming which was agreed — 25.25% markup
   is a 20.2% gross margin.
3. **The markup rate moves between quantity breaks.** Because the band is tested
   on goods + freight and both scale with quantity, a 100-unit break may sit at
   35% while a 500-unit break falls to 31%. Probably intended — bigger order,
   thinner markup — but each break must show the rate it resolved to, or it
   reads as an error.
4. **Quantity break matching.** Freight Hub breaks are scale factors on a base
   carton list carrying a unit count; Estimate Hub breaks are unit quantities.
   The import matches on units — confirm the mapping holds when a job's cartons
   have mixed units per carton.
5. **Freight missing for a break.** What the quote shows when the Freight Hub
   has no figure for that quantity — blank, estimated, or blocked.
6. **Stale FX.** What happens if the daily xe.com refresh fails — last known
   rate with a warning, or block the quote.

## Notes for the build

- Reuse the Freight Hub's conventions: derived values never editable, every
  figure traceable to an input or a stored rate, quotes saved as versions rather
  than overwritten.
- The per-unit cost beside each line is the same read-only-derived pattern as
  CBM-each in the calculator.
- Markup selection wants the same treatment as the estimating basis selector:
  show which rule produced the rate — regression or client fixed — on the quote
  itself, alongside the rate it resolved to.
- Show the working on each line: entered cost, allowance applied, FX rate used,
  AUD figure. A quote nobody can retrace is a quote nobody can defend.
