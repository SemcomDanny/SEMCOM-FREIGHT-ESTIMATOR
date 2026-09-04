# Booking workflow — spec for the Lovable build

Estimate → order → conditional booking authority → automatic approval → hands-off
tracking.

Written to be pasted into Lovable in stages, the same way as
`LOVABLE-REBUILD-PROMPT.md`. Search for `[PORTAL:` before pasting.

---

## The shape of it

The existing flow is: estimate in the calculator → **Proceed to consignment** →
save the job → add booking detail → it appears as an order → **Send booking
request**. This spec picks up at that button and removes the human from
everything after it except one decision, on the shipments where that decision
is actually worth making.

The change to the request itself is that it carries **conditional booking
authority**: *quote this, and if your quote lands within our tolerance, book it
without coming back to us.* That collapses two round trips into one. Trade
practice calls it "book subject to rate confirmation"; it is how experienced
shippers work, because space and rates both move faster than an approval email.

The forwarder replies **by email** — that is what their ops staff actually do,
and no portal will change it. The reply is parsed, reconciled against the frozen
estimate, and either auto-approved or put in front of a person with the reason
stated.

---

## Stage 1 — Freeze the estimate onto the order

**The snapshot is the contract.** At *Proceed to consignment*, copy the estimate
onto the order and never read it live again. Everything downstream — the
tolerance test, the variance report, the invoice check — measures against this
frozen copy. If it points at the live job instead, someone edits the calculator
next week and the baseline silently moves.

```
freight_orders
  id
  ref                          -- order number, distinct from the job ref
  job_id                       -- the estimate it came from
  status

  -- Frozen estimate: the tolerance baseline. Written once, never updated.
  estimate_captured_at
  estimate_mode                -- LCL | FCL | AIR as recommended at capture
  estimate_total_aud
  estimate_components_json     -- ocean, port charges, ancillaries, each with
                               -- its formula string and source rate version
  estimate_rate_card_ids_json  -- the exact versions priced on
  estimate_rate_stale          -- was any card stale at capture
  estimate_quantity_break      -- which break was selected
  estimate_metrics_json        -- cartons, CBM, chargeable CBM, gross kg

  -- Booking detail, added on the screen after the handoff
  incoterm                     -- FOB
  cargo_ready_date
  commodity, hs_code, dangerous_goods, dg_details
  supplier_name, supplier_contact, supplier_phone, supplier_email
  pickup_address
  delivery_address             -- the metro address destination charges must cover
  special_instructions

  approved_quote_id, approved_at, approved_by   -- approved_by null when automatic
  created_by, created_at, updated_at
```

Re-baselining is allowed but must be explicit and audited: a **Re-estimate**
action that writes a new snapshot with a reason, not an edit that quietly
replaces one.

Two things worth surfacing on the booking-detail screen, because they decide
whether the auto-approval can run at all:

- **A stale-rate warning.** If the estimate was priced on a rate card older than
  the staleness threshold, say so here — auto-approval will be refused later and
  it is better to know now.
- **Cargo ready vs quote validity.** A spot rate that expires before the cargo
  is ready is worthless. Show the date and let them adjust it before sending.

---

## Stage 2 — The outgoing request

One email, carrying both the quote request and the booking authority.

Fixed terms, stated in the email and not negotiable per-shipment: **Incoterm
FOB**, **quoted in AUD**, and **destination charges must include delivery of the
container to one metro address in the destination city** (derive the city from
the lane; include the actual delivery address from the order). A quote to the
wharf is not comparable with a quote to the door, and forwarders quote to the
wharf unless told otherwise.

The body must contain a **fill-in block**. This is the single highest-leverage
detail in the whole design: most ops staff will complete a block because it is
less work than composing a reply, which gives you near-deterministic parsing on
the majority of responses and — critically — forces them to state exclusions.

```
--- PLEASE COMPLETE AND REPLY (or attach your quote) ---
OCEAN FREIGHT ......................... ________ AUD
ORIGIN CHARGES ........................ ________ AUD
DESTINATION CHARGES ................... ________ AUD
    (must include delivery to: <delivery address>)
CUSTOMS CLEARANCE ..................... ________ AUD
OTHER CHARGES (itemise) ............... ________________________
NOT INCLUDED (important) .............. ________________________
RATE VALID UNTIL ...................... ____/____/______
ETD ................................... ____/____/______
TRANSIT TIME .......................... ______ days
FREE TIME AT DESTINATION .............. ______ days
--------------------------------------------------------
```

Followed by the authority, in plain words:

> If your all-in figure is within our expected range we will confirm
> automatically and this email is your authority to book. If it falls outside,
> we will come back to you before you book.

Address it to a named person where you have one. `rates@` inboxes are where
follow-ups go to die.

---

## Stage 3 — Parsing the reply

Inbound email lands on a per-order reply address (`orders+<token>@[PORTAL: mail
domain]`) so the message is attributed without matching on subject lines.

Parse in this order, stopping at the first that produces a complete result:

1. **The fill-in block**, by pattern. Deterministic, no model, highest trust.
2. **Attached PDF quote.** Most forwarder quotes are PDFs. Claude reads them
   natively as a `document` content block — no OCR pipeline.
3. **Free-text body.**

For 2 and 3, extract with `claude-opus-5` via `@anthropic-ai/sdk` in an Edge
Function, using `output_config.format` so the response is schema-validated JSON
rather than something to regex. Cache the system prompt — it is stable across
every extraction and the email is the only part that varies.

### The extraction contract

```ts
{
  ocean_freight_aud:      number | null,
  origin_charges_aud:     number | null,
  destination_charges_aud:number | null,
  customs_clearance_aud:  number | null,
  other_charges: [{ description: string, amount_aud: number | null }],

  currency_quoted:        string,        // as written; flag if not AUD
  destination_includes_delivery: boolean | null,
  excluded:               string[],      // anything they said is NOT included
  validity_until:         string | null, // ISO date
  etd:                    string | null,
  transit_days:           number | null,
  free_time_days:         number | null,

  unreadable:             string[],      // fields present but not confidently read
  notes:                  string | null
}
```

Three rules the prompt must enforce, and the schema must permit:

- **Return `null`, never a guess.** A missing figure is information; an inferred
  one is a fabricated commitment.
- **`excluded` is mandatory output.** If they wrote "excludes quarantine
  inspection", that string belongs here. This field is where the money hides.
- **Quote the source.** Keep the raw email and attachment against the order so
  any parse can be checked against what was actually said.

**The model extracts. It never decides.** Deterministic code does the comparison
and the approve/decline. That keeps the decision auditable and unit-testable,
and means a parsing error can only ever route to a human — never authorise a
booking.

---

## Stage 4 — The decision

A pure function. No I/O, no model, fully testable — this is the piece that
commits money.

```ts
function decideQuote(quote, snapshot, policy): {
  outcome: 'auto_approved' | 'needs_review',
  reason: string,
  reconstructedTotalAud: number,
  variancePct: number,
  gates: { name: string, pass: boolean, detail: string }[]
}
```

**Every gate must pass for auto-approval.** Any failure routes to a person with
the failing gate named.

| Gate | Passes when |
|---|---|
| `policy_enabled` | Auto-approval is on globally, and for this client and lane |
| `complete_parse` | Every component the estimate priced has a counterpart — a number, or an explicit exclusion |
| `no_unpriced_exclusions` | Nothing in `excluded` corresponds to something the estimate costed |
| `currency_aud` | Quoted in AUD |
| `delivery_included` | Destination charges confirmed to include metro delivery |
| `rate_card_fresh` | The snapshot was not priced on a stale rate card |
| `validity_covers_ready_date` | Quote validity is on or after cargo ready date |
| `within_tolerance` | Reconstructed all-in within the asymmetric band |
| `under_absolute_cap` | Reconstructed all-in below the dollar ceiling |
| `forwarder_in_good_standing` | Forwarder not suspended from auto-approval |

### Why the tolerance is asymmetric

Only *over* costs you money. But a quote well *under* estimate is not a win
either — it is nearly always a missing inclusion, and catching it before booking
is the difference between a conversation and an invoice dispute.

```
policy:
  auto_approve_max_over_pct    default  5     -- up to estimate + 5%
  auto_approve_max_under_pct   default 25     -- more than 25% under → review
  auto_approve_ceiling_aud     default 6000   -- absolute cap regardless of %
  enabled                      default false  -- opt in deliberately
```

Per-client and per-lane overrides, and a global kill switch reachable in one
click. The first time it misfires you will want it off immediately, not after a
deploy.

**The percentage is meaningless without the completeness gate.** "Within 10% of
the estimate" on a quote that omitted destination charges is 10% of the wrong
number. Completeness first, arithmetic second.

### On approval

- Write `approved_quote_id`, `approved_at`, `approved_by` (null when automatic).
- Send the booking instruction immediately, with a written record of exactly
  what was authorised: *"We have authorised booking at AUD X against your quote
  of [date]. Components: ..."* This is both courtesy and the document you will
  want if the rate is later disputed.
- Feed the accepted quote back into the estimator as a new rate version, with
  the forwarder named in the note — the same path the RFQ import already uses.
  An accepted spot quote is the best rate intelligence you have, and without
  this loop your estimates drift from what you are actually paying.

**Auto-approval means auto-commitment.** Once the forwarder books, cancelling
costs money and sometimes carrier no-show fees. That is the trade being made for
speed; set the tolerance with someone who knows it.

---

## Stage 5 — Tracking identifiers

Ask for these in the booking confirmation:

| Field | Notes |
|---|---|
| Carrier name / SCAC | Who is actually carrying it |
| Carrier booking number | The carrier's, not the forwarder's SO |
| Master B/L number | The main tracking key |
| Vessel name | |
| IMO number | 7 digits, check-digit validated |
| Voyage number | |
| Container number(s) | ISO 6346, check-digit validated |
| POL / POD | UN/LOCODE |

**Identifiers arrive in stages.** Container numbers do not exist at booking —
they are assigned at packing or gate-in, often after departure. Model them as
rows that arrive over time, not a form that must be completed at once, and start
tracking on whatever you have: vessel and voyage first, container later.

**Validate on entry.** Both identifiers carry check digits, so a typo is caught
at submission instead of three days later when tracking silently returns nothing.

*ISO 6346 container number* — 4 letters (owner + category) then 6 digits then the
check digit. Letter values are A=10 … Z=38 **skipping every multiple of 11**
(so no 11, 22, 33). Multiply each of the first 10 characters by 2^position
(position 0-9), sum, `mod 11`, then `mod 10` — that is the check digit.

*IMO number* — 7 digits. Multiply the first six by 7, 6, 5, 4, 3, 2, sum, and the
last digit of the sum is the check digit.

### Where the data actually comes from

There is **no good free public API for container tracking**. Verify current
pricing on all of these; the market moves.

| Source | What it gives | Reality |
|---|---|---|
| **Tracking aggregators** (Terminal49, Vizion, project44, Portcast) | Container-level milestones across carriers | The actual answer. Paid, roughly per-container, one integration. Trivial against the labour saved |
| **Carrier APIs direct** (Maersk, Hapag-Lloyd, CMA CGM …) | Same, per carrier | Free or cheap at low volume, but one integration each and coverage only where you built it |
| **AIS / vessel position** (MarineTraffic, VesselFinder, AISHub) | Where the *ship* is | Cheap, sometimes free. Refines ETA once you have vessel + voyage. Not container-level — a supplement, not the answer |
| **Forwarder** | Whatever they tell you | Free, and the thing you are trying to stop depending on |

Carrier ETD/ETA beats forwarder ETD/ETA and updates itself. That is the whole
point — and it is achievable in weeks, unlike a CargoWise feed, which needs the
forwarder's IT department to agree to build something for you.

Write every source through **one shipment-update path** with a source ranking —
carrier feed beats forwarder portal beats forwarder email beats manual entry —
so a later, better source can correct an earlier one without a special case.

### Forwarder portals (Logixboard and similar)

Our forwarders use **Logixboard**, so it is worth being precise about what that
does and does not give us.

Logixboard is sold **to forwarders**, not to shippers. It is a white-label
customer-experience layer: the forwarder licenses it, and it ingests from their
TMS — CargoWise, Descartes and the rest — by API, FTP file drop or database
sync, then presents milestones, documents and tracking to that forwarder's
customers under the forwarder's own branding. **The documented integrations all
run inbound**, TMS into Logixboard. There is no publicly documented outbound API
for a forwarder's customer to pull their own shipments into their own system.

That does not mean the answer is no — it means the answer is not ours to give.
Three routes, in the order worth trying:

**1. The notification emails — free, and available today.** Portals of this kind
email the customer on milestones: booking confirmed, departed, arrived,
available for pickup, documents ready. Those emails land in the same inbox this
spec is already parsing quote replies from. Point the same pipeline at them,
match on the SO or B/L number, and file them through the standard update path.
No permission needed, no integration project, and it works across every
forwarder who sends notifications regardless of which portal they run. **Do this
first.** It may well be enough.

**2. Ask the forwarder for API access to their tenant.** Even if an API exists,
it is scoped to the forwarder's tenancy and enabled by them — so this is a
request to the forwarder, not a signup. It is a much lighter ask than a
CargoWise feed, because giving a customer their own data is on-mission for a
customer-experience product, where an eAdaptor feed is a bespoke integration
project. Worth asking; not worth planning around until answered.

The question to put to them, in one line:

> Does your Logixboard portal expose an API or webhook we can use to pull our
> own shipment milestones into our system, and if so what would we need from you
> to enable it?

**3. Carrier data direct.** Independent of the forwarder entirely, and the only
route that keeps working when the forwarder is unresponsive. Covered in the
table above.

Design note: model the portal as **one more source behind the same interface**,
ranked between the carrier feed and forwarder email. If access does arrive
later, it is a new adapter and a row in the ranking, not a rework. If it never
arrives, nothing was built on the assumption that it would.

---

## Stage 6 — Chasing, only where it earns its place

**One low-frequency scheduled job, running daily.** It walks every active order
and decides, per order, whether an update is due — from **that shipment's own
dates**, not a fixed cadence. There is no per-shipment timer, no queue of
scheduled sends, and nothing to clean up when a shipment changes shape: the
decision is recomputed from current state each morning.

```
daily job:
  for each order where status is active:
    facts   = what we know (dates, numbers, documents present)
    due     = triggers whose condition is met and whose fact is still missing
    unsent  = due minus what has already been sent for this order
    for each unsent trigger:
      send it, record it
```

Daily is the right frequency. Every trigger below is measured in days, the
recurring database cost is negligible, and the trade-off — missing an event by
up to 24 hours — is the correct one for ocean freight. Do not build a
higher-frequency job for this.

Chase against **expected milestone dates**, never elapsed silence.
Shenzhen–Sydney is 14–18 days with genuinely nothing to report mid-ocean;
chasing into that void trains the forwarder to ignore you, which poisons the
triggers that matter.

| Trigger | Action |
|---|---|
| Approved, no booking confirmation after 2 business days | Reminder |
| ETD within 24 h, no departure confirmed | "Has it sailed?" |
| ETD passed by 2 days, no departure confirmed | Reminder, then escalate |
| ETA within 48 h, no arrival detail | "Arrival and delivery details?" |
| Delivered, no POD after 3 days | POD request |
| Quote validity expires with the order not yet booked | Re-request, notify us |

Four rules make this behave:

- **Once per condition per order.** A `freight_order_nudges` row — order id,
  trigger key, sent at — is written on send and checked before the next. Without
  it the daily job re-sends the same reminder every morning until the condition
  clears, which is how an automated chaser becomes an ignored one.
- **Stop the moment the fact arrives, from any source.** The trigger tests for
  the missing fact, not for a reply. If a departure date arrives from the
  carrier feed, the "has it sailed?" chaser never fires — even though the
  forwarder never answered.
- **Suppress everything for a forwarder whose data arrives by feed.** Per
  forwarder flag. Chasing someone who is already pushing you the answer is worse
  than not chasing at all.
- **Escalation needs a named owner and a queue.** Every order carries an owner;
  escalation raises it to them in the portal, not into a shared inbox where a
  fourth email goes unread.

Log every send against the order, so who was chased and when is visible on the
shipment rather than buried in a mail server.

---

## Traps

1. **The tolerance baseline moving.** Covered above, and the reason the snapshot
   exists. Test it: change the job after the handoff, confirm the order's
   baseline is unchanged.
2. **Comparing unlike totals.** The most expensive failure available here.
   Completeness gate before arithmetic, always.
3. **Letting the model decide.** Extraction and decision are separate. The model
   never authorises anything.
4. **A quote that is suspiciously cheap.** Not a win. Route it to review.
5. **Auto-approving on a stale estimate.** Freshness is a hard gate, not a
   warning.
6. **Rounding a reconstructed total before comparing.** Compare in cents.
7. **The reply address leaking.** A per-order token in the address means anyone
   holding it can post a quote against that order. Do not reuse it across
   orders, and do not accept a parse from an address that does not match the
   order's forwarder without review.
8. **Duplicate replies.** Forwarders resend and reply-all. Dedupe on message-id;
   a second quote is a new row, and the latest wins — but only through the same
   gates.

---

## Acceptance criteria

1. Proceeding to consignment writes a frozen estimate snapshot; editing the
   source job afterwards does not change the order's baseline.
2. A reply completing the fill-in block parses without invoking a model.
3. A PDF-attached quote parses into the same schema.
4. A quote missing destination charges never auto-approves, regardless of how
   close its headline figure is.
5. A quote whose exclusions name something the estimate priced never
   auto-approves.
6. A quote 5% over estimate auto-approves; 12% over goes to review; 40% under
   goes to review.
7. A quote above the absolute ceiling goes to review even at 1% variance.
8. A quote priced against a stale rate card never auto-approves.
9. A quote whose validity expires before cargo ready date goes to review.
10. Auto-approval sends the booking instruction and a written confirmation of
    what was authorised, and records `approved_by` as null.
11. An approved quote creates a new rate version with the forwarder named.
12. A container number with a bad check digit is rejected at entry.
13. Identifiers can be added in stages; tracking starts with vessel and voyage
    before a container number exists.
14. A carrier-sourced ATD overwrites a forwarder-sourced one; the reverse does
    not.
15. Every chaser stops when the fact it asks for arrives from any source,
    including a source other than the forwarder being chased.
16. A given chaser fires once per condition per order, however many times the
    daily job runs while the condition holds.
17. Chasers are fully suppressed for a forwarder marked as feed-connected.
18. A parsed portal notification email files through the same update path as a
    manual entry and is ranked above it.
19. The kill switch stops all auto-approval without a deploy.

---

## Build order

1. Estimate snapshot on the order + booking detail screen.
2. Outgoing request with the fill-in block and the stated authority.
3. Inbound email capture and deterministic block parsing.
4. The decision function, with tests, behind a default-off flag.
5. LLM extraction for PDFs and free text.
6. Identifiers, validation, and portal notification-email parsing — the
   cheapest tracking source and the one needing nobody's permission.
7. Milestone chasers on the daily job.
8. A paid carrier or aggregator feed, once the identifiers prove reliable.

Stages 1–4 are usable without 5–8: even with every quote going to review, the
frozen baseline and the reconciled comparison are worth having on their own.
