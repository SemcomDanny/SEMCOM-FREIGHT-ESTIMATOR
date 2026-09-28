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

**Overseas allowance**
- Toggle on a line whose origin is not Australia: multiply its cost by **1.10**
  (freight & GST allowance) **in the origin currency, before conversion**.
- US$100 → US$110 → convert to AUD.
- The ×1.10 and the FX multiply commute, so the AUD figure is the same either
  way — but the line must **display the grossed-up origin-currency figure**, so
  do it in this order and carry full precision, rounding only for display.

**Price**

Per line:
```
adjusted_origin = cost_in_origin_currency × (overseas_toggle ? 1.10 : 1.00)
line_aud        = adjusted_origin × fx_to_aud(origin_currency)
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

- **Markup, not margin.** `price = base × (1 + rate)`.
- **Base is goods + freight**, both in AUD, goods after the overseas allowance.
- **Overseas allowance is ×1.10 in origin currency, before FX.**

## Still to decide

1. **Does the 10% double-count freight?** It is described as a *freight & GST*
   allowance, but actual freight is added separately from the Freight Hub. If
   the 10% is mostly the GST on import — 10% of the taxable value, which lines
   up — then the naming is just legacy and nothing is wrong. If it genuinely
   carries freight too, overseas goods are being marked up on freight counted
   twice. Either is a fine commercial decision; worth being a decision.
2. **Toggle scope.** Per line, or one switch for the whole quote? Suggest per
   line, defaulted **on** for any non-Australian origin and overridable — that
   matches "for anything coming from overseas" while allowing the exception.
3. **Is NZ overseas?** Geographically yes, so the default catches it. Confirm
   that is wanted, given no duty applies and the freight profile is different.
4. **Which figure tests the band?** Assumed `base_aud` — goods + freight after
   allowance — for the $15k/$150k thresholds. Note this makes the markup rate
   move with quantity, since freight and goods both scale per break. That is
   probably right, but it means the same job quotes at different markup rates
   across its breaks, and the quote should show which rate each break used.
5. **Above $150k?** Assumed held at 25%.
6. **Kenvue's 25.25%.** Internal rule is markup, but a client arrangement is
   often negotiated as margin. Worth confirming which was agreed — 25.25%
   markup is a 20.2% gross margin.
7. **FX rates — source and storage.** Where AUD/NZD/USD rates come from, and a
   quote must reproduce later, so store the rate used on the quote rather than
   re-converting at read time. Same discipline the Freight Hub uses for rate
   versions.
8. **Quantity break matching.** Freight Hub breaks are scale factors on a base
   carton list carrying a unit count; Estimate Hub breaks are unit quantities.
   The import matches on units — confirm the mapping holds when a job's cartons
   have mixed units per carton.
9. **Freight missing for a break.** What the quote shows when the Freight Hub
   has no figure for that quantity — blank, estimated, or blocked.

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
