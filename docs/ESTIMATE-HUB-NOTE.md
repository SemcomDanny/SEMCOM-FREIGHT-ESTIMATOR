# Estimate Hub — pre-prompt note

Working note, not a spec. Captures the requirement as given so the build prompt
can be written from it later. Companion app to the Freight Hub; the two share
jobs and quantity breaks.

## What it does

**Job**
- Select an existing job by search — job name or job number.
- Create a new quote against it.
- Quantity breaks are **named ordinals — Break 1, Break 2, Break 3, …** — created
  by the user, each carrying its own unit quantity (Break 1 = 100 units,
  Break 2 = 200, Break 3 = 500).
- **Both apps use the same structure, and the match is by ordinal:** Freight Hub
  Break 1 ↔ Estimate Hub Break 1. Not by unit count.
- Each break can carry different item quantities on the Estimate Hub side.

**Cost lines**
- Repeating list. Per line: quantity, total cost (input), and **cost per unit
  shown beside it as a read-only derived value**. Button to add more lines.
- Each line has an origin: **Australia, New Zealand, USA, China**.
- Cost is entered in the origin's currency — AUD, NZD, USD — except **China,
  which is entered in USD** (Chinese suppliers quote USD).

**Totals**
- All lines converted and totalled in **AUD**.
- Display toggle for AUD / NZD / USD. Display only — AUD stays the base.

**Freight — three modes per quote**
1. **Linked** — imported from the Freight Hub for the matching break ordinal.
2. **Manual** — freight cost typed in directly, no link.
3. **None** — no freight line at all.

Linked but unresolvable (no figure saved yet, or no matching break):
- **Warn**, but still create the freight line at **$0**, marked *to be added in
  Freight Hub*.
- **Re-match later**: when the Freight Hub figure appears, the quote picks it up.
- A $0 freight line understates `base_aud`, so both the markup rate and the
  price come out low. The warning must survive as far as the quote output — see
  the hazards below.

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
- **If the daily refresh fails**, use the latest known rate and **flag it before
  output** — carry the rate's age on the warning.
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

Alternative: **client fixed markup**. Only arrangement so far is **Kenvue =
25.25% markup** — confirmed: $10,000 cost quotes at **$12,525**. No others yet —
build the table, seed the one row.

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

## All resolved

- Kenvue 25.25% is **markup** — $10,000 cost → $12,525 quoted.
- The markup rate moves between breaks by design: more quantity, lower rate,
  **floored at 25%** once `base_aud` reaches $150,000.
- Breaks are matched **by ordinal**, Break N ↔ Break N.
- Freight has three modes; linked-but-missing yields a warned $0 line that
  re-matches later.
- A failed FX refresh falls back to the last known rate, flagged before output.

## Two hazards to design against

**1. Ordinal matching can silently mismatch quantities.** Break 2 means "the
second break" in each app, not "200 units". If someone inserts a break in one
app and not the other, Break 2 in the Estimate Hub is 200 units while Break 2 in
the Freight Hub is now 150 — and the quote takes freight for the wrong quantity
without complaining.

Mitigation: match on ordinal as specified, but **carry the unit quantity from
both sides and compare**. Where they disagree, show both figures and warn. Cheap
to build, and it turns a silent wrong number into an obvious one.

**2. A $0 freight line quietly produces a cheap quote.** It understates
`base_aud`, which lowers the price *and* can push the quote into a higher markup
band — so the error does not even look like an error. On a $1,800 freight cost
that is most of the markup given away.

Mitigation: the warning must follow the quote all the way to output. Suggest
the template refuses to render a client-facing quote while a $0 placeholder is
present, unless someone explicitly acknowledges it. Blocking is safer than a
banner nobody reads.

## Affects the Freight Hub

The Freight Hub as built labels breaks *As entered / 2× / 3×* and stores a
**multiplier** on a base carton list. To match Break N ↔ Break N, it needs the
same **named-ordinal structure with an explicit unit quantity per break**.

That is a change to the Freight Hub — small, but it has to land there first, and
`docs/LOVABLE-REBUILD-PROMPT.md` needs the same edit so a rebuild does not
reintroduce multipliers.

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
