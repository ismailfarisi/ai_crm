---
target: quote editor
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 3
target_identity: "file:C:\\Users\\Keerthana\\ai_crm\\apps\\web\\src\\components\\quotes\\quote-editor\\quote-editor-page.tsx"
target_fingerprint: "sha256:6fa259a08eeb2ec7f0500e7c4b2475459f7476bf0e48b1eb8f3161d702ed5cd5"
target_path: "C:\\Users\\Keerthana\\ai_crm\\apps\\web\\src\\components\\quotes\\quote-editor\\quote-editor-page.tsx"
timestamp: 2026-10-29T22-13-17Z
slug: quotes-quote-editor-quote-editor-page-tsx-e3db6260
closed: true
---
Method: dual-agent (A: an independent design-review agent · B: an independent detector-and-browser agent)

# Critique: Quote editor (apps/web/src/components/quotes/quote-editor/)

**19/40, Poor.** The catalog picker and the template configurator are genuinely good. But the margin, which True Cost™ promises, can show a loss in a green "healthy" badge, and sending a quote to the customer has no safeguard.

## Design health score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of system status | 2 | No unsaved indicator; no Sent or Accepted step in the pipeline; a −22.1% margin shows a green pill |
| 2 | Match with the real world | 1 | Software, SLA and Odoo copy; USD default; "Units" for boxes; software-style terms |
| 3 | User control and freedom | 2 | No undo for a deleted line; AI Apply replaces every line; leaving the page drops edits without a prompt |
| 4 | Consistency and standards | 2 | Three amber elements in the top fold; emerald Approve override; money written two ways; ⌘K shown on Windows |
| 5 | Error prevention | 1 | One-click Send works on drafts and below-floor quotes, and sends the saved version, not what's on screen |
| 6 | Recognition rather than recall | 3 | Labels visible and the picker shows cost; on phone and tablet the columns scroll away from their headings |
| 7 | Flexibility and efficiency | 2 | Ctrl-K and picker arrow keys are good; no Ctrl-S, no duplicate or reorder line, no bulk quantity change |
| 8 | Aesthetic and minimalist design | 2 | Calm palette, but 8 actions in two bars, the title twice and the quote number three times |
| 9 | Error recovery | 2 | Configurator and guardrail messages are good; everything else is a toast |
| 10 | Help and documentation | 2 | Good inline notes (reverse charge, margin over-estimate, price breaks) and nothing beyond |
| **Total** | | **19/40** | **Poor** |

## Design specificity verdict

**Design review:** mostly category-interchangeable.
- **Grounded in the trade:** the catalog picker (cost beside price) and the template configurator ("sheets are bought whole…", lead time, blank preview).
- **Generic CRM quote form:**
  - Placeholders "Enterprise CRM Software & Services" (quote-header-form.tsx:128), "Phase 1: Implementation" and "99.9% uptime SLA" (quote-lines-table.tsx:199,243).
  - Default terms mention acceptance testing (quote-editor-page.tsx:129).
  - USD default (:94).
  - Labels "Untaxed Amount" and "Order Lines & Deliverables".
  - The AI drawer has CRM and penetration-test presets, says "structured Odoo quotes", and carries a v2.0 badge.

**Deterministic scan:**
- **CLI:** clean (exit 0) apart from 4 advisory `design-system-font-size` items, all 10px text off the type ramp. Two are kbd hints (catalog-picker.tsx:120, quote-editor-page.tsx:543) and two are in ui/data-table. These are likely false positives.
- **Browser:** 15 problems on the quote page at 1440px, 17 on /quotes/new and 10 at 390px. They are mostly `low-contrast`:
  - The ink-subtle token (globals.css:17) at 3.0–3.3:1.
  - Amber text at 2.3–2.4:1 (quote-editor-page.tsx:559, quote-tabs-section.tsx:41).
- **False positives:** `cream-palette` is an intentional brand choice.
- **Overlays:** they remain in the Ego Lite tab "[Human] Quotation Editor · Kerf".

## Overall impression
The bones are good: costing is fast, keyboard-friendly and trade-literate. But the margin is the easiest thing on the page to misread, and the most consequential button has no guard. Biggest opportunity: pin the total and margin beside the primary action, and tie Send to approval.

## What's working
1. **Catalog picker:** Ctrl-K, arrow keys and Enter, with cost under each price.
2. **Template configurator:** a price-break ladder that includes the quantity asked for, a blank preview, lead time, and plain-word "cannot be made" messages.
3. **Honest margin plumbing:** the card is permission-gated, warns about the over-estimate on hand-typed lines, and explains reverse charge in plain words.

## Priority issues

**[P0] A loss shows as healthy.**
- The tone depends only on a `MARGIN_BELOW_FLOOR` violation (quote-margin-card.tsx:27,37-41), so with no floor a negative margin is green. Verified live: −22.1%, a $3,600 loss, in a green pill.
- The floor is never shown, and the figures have no `tabular-nums`.
- **Fix:**
  - Set the tone from margin against the floor and zero.
  - Always add a word, and show the floor value.
  - Pin total and margin in the sticky bar.
- **Command:** /impeccable harden

**[P0] Sending to the customer has no guard.**
- Send is primary amber on drafts with no confirm (quote-customer-panel.tsx:65-76,146-157).
- The API accepts drafts and below-floor quotes, and sends the saved version.
- **Fix:**
  - Save first, or disable Send while there are unsaved edits.
  - Confirm with the recipient, total in AED, validity and margin status.
  - Require approval when there are violations.
  - Make Send primary only after approval.
- **Command:** /impeccable harden

**[P1] The AI Copilot is a client-side simulation that replaces all lines.**
- A regex parser behind a setTimeout (quote-ai-drawer.tsx:260); `setItems(draft.items)` drops costed lines (quote-editor-page.tsx:264).
- Off-domain presets, Odoo copy, and an emoji in the label.
- **Fix:** remove it, or route it to the real assistant. Append rather than replace, and confirm first.
- **Command:** /impeccable distill

**[P1] Phone and tablet aren't usable.**
- At 390px the sticky ribbon takes about 240 of 844px, and 42 of 45 controls are under 44px.
- `min-w-[840px]` on the table pushes prices off-screen, and the UoM column is empty at 1024px.
- **Fix:**
  - A phone bottom bar with total, margin and one 44px primary.
  - Lines as stacked cards below md.
  - md/lg button sizes.
- **Command:** /impeccable adapt

**[P1] Accessibility.**
- 23 fields have no programmatic label: the header labels aren't linked (quote-header-form.tsx:140ff) and the table inputs have no aria-label.
- Margin state is carried by colour alone.
- Contrast is 2.3–3.3:1.
- **Fix:**
  - Link the labels and add per-line aria-labels.
  - Darken ink-subtle to at least 4.5:1.
  - Stop using amber as a text colour.
- **Command:** /impeccable audit, then /impeccable polish

## Persona red flags
- **Alex (power user):**
  - No Ctrl-S or unsaved indicator, and silent loss on navigation.
  - No reorder, duplicate or undo-delete.
  - No bulk quantity change.
- **Sam (keyboard and screen reader):**
  - 23 unlabelled fields; delete is named only by `title`.
  - No `aria-current` on the pipeline; margin carried by colour alone.
  - Click-only price-break rows; Esc doesn't close the print preview.
- **Casey (one-handed phone):**
  - 42 of 45 targets under 44px.
  - All actions at the top of the screen.
  - Sideways scroll needed to see prices.
- **Omar (owner approving on his phone):**
  - 32px Approve and Reject, and Approve is a raw emerald.
  - Margin two screens down.
  - No confirm on Approve, and no reason on Reject.

## Minor observations
- **Wording and defaults:**
  - "1 products".
  - "Quotation confirmed & approved!" is off-voice.
  - The picker footer is dev copy.
  - US date formats.
  - The unit price shows "4.6".
- **Customer:** a split select plus free-text field, so the customer isn't linked: no address or TRN, and VAT at 0%.
- **Repetition and layout:** the title appears twice and the quote number three times; the totals card is `max-w-sm`, leaving dead space.
- **Colour:** green on the discount row; an undefined `text-accent`.
- **Print preview:** it drops sections and notes, has no VAT or TRN, and says "Total Due".
- **Permissions:** `isReadOnly` ignores `quote:update`.
- **Design-system drift:** translucent cards against the Solid Sheet rule, and raw palette classes.

## Questions to consider
1. If True Cost™ is the claim, why is margin the eighth thing on the page rather than a figure pinned beside the total?
2. Should a below-floor quote ever reach a customer without a person's yes?
3. What if the screen started from the job (board, blank, quantity) instead of a generic order-line grid?
