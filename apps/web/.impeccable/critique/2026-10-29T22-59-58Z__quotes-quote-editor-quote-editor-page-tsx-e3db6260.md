---
target: quote editor
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
target_identity: "file:C:\\Users\\Keerthana\\ai_crm\\apps\\web\\src\\components\\quotes\\quote-editor\\quote-editor-page.tsx"
target_fingerprint: "sha256:e80a9121a2499f2209abf0aa498ea59f8ef40c603f2cf52eb4420487f5f70b16"
target_path: "C:\\Users\\Keerthana\\ai_crm\\apps\\web\\src\\components\\quotes\\quote-editor\\quote-editor-page.tsx"
timestamp: 2026-10-29T22-59-58Z
slug: quotes-quote-editor-quote-editor-page-tsx-e3db6260
closed: true
---
Method: dual-agent (A: independent design-review agent · B: independent detector-and-browser agent)

# Critique: Quote editor (second run)

**26/40, Acceptable** (previously 19/40, Poor).

## Design health score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of status | 3 | The margin badge hides cost gaps; the pipeline ends at Approved |
| 2 | Real world | 3 | USD and "Units" defaults; dev copy in the picker |
| 3 | User control | 3 | No undo on line delete |
| 4 | Consistency | 2 | Three money formats, three date formats, mixed casing |
| 5 | Error prevention | 2 | A draft can be sent without approval; the discount row misleads; currency change doesn't reprice |
| 6 | Recognition | 3 | — |
| 7 | Flexibility | 3 | No duplicate or reorder; picker adds at quantity 1 |
| 8 | Minimalism | 2 | Quote number shown 3×; "Add from catalog" twice at xl; customer panel on drafts |
| 9 | Error recovery | 3 | Raw err.message in toasts |
| 10 | Help | 2 | "No margin floor set" doesn't link to settings |
| **Total** | | **26/40** | **Acceptable** |

## Design specificity
About 60% Kerf-specific.
- **Kerf-specific:** catalog lines with cost, enquiry drafting, margin floors, price breaks, the reverse-charge note, overs-and-unders terms.
- **Generic:** the "Quotation Header" card, USD and "Units" defaults, a 0%-only tax list.

## Deterministic scan
- **CLI:** 3 advisory `design-system-font-size` items: catalog-picker.tsx:120, data-table-card-grid.tsx:83, data-table-toolbar.tsx:144.
- **Browser, editor:** clean in light mode.
- **Browser, dark mode:**
  - Primary button 1.7:1 (button.tsx:10, `text-ink` on brand).
  - `dark:` variant follows the OS rather than the `.dark` class (no `@custom-variant` in globals.css); 213 usages.
- **Shell (outside the editor):** 10px "WORKSPACE" and role chip; the avatar is 4.2:1.
- **False positives:** cream-palette, flat-type-hierarchy at 390px, nested-cards on the read-only terms box.

## Priority issues
**[P0] Dark-mode primary buttons are 1.7:1.**
- **Fix:**
  - An `--color-on-brand` token used for primary button text.
  - Darken the dark-mode danger colour.
  - Add `@custom-variant dark (&:where(.dark, .dark *));`
- **Command:** /impeccable audit, then /impeccable polish.

**[P1] Margin badge ignores hasCompleteCost.**
- **Fix:** a warning "Cost missing on N lines" in the badge and both dialogs; match drafted lines to the catalog; swap-for-catalog on typed lines.
- **Command:** /impeccable harden.

**[P1] Totals read as unbalanced.** The subtotal is already net of discount.
- **Fix:** Lines total → Discount → Subtotal → VAT → Total.
- **Command:** /impeccable clarify.

**[P1] Two ways forward on a clean draft; approval is optional by accident.**
- **Fix:** pick one model; hide the customer panel until sending is possible.
- **Command:** /impeccable harden.

**[P2] UAE defaults and redundancy.**
- **Defaults:** org base currency; valid until = issue date + 30 days.
- **Tax list:** fix "No tax (0%) (0%)"; warn when there is no 5% VAT code.
- **Redundancy:** remove the duplicate header label and the duplicate catalog button.
- **Command:** /impeccable distill.

## Persona red flags
- **Alex:**
  - About 25 tab stops before the editor.
  - No reorder, duplicate or undo.
  - Picker adds at quantity 1.
- **Sam:**
  - Focus ring 2.05:1; input borders about 1.2:1.
  - Tabs lack role=tab; tab labels have no htmlFor; header icons are not aria-hidden.
- **Casey:**
  - Undersized targets: billing select 33px, Attach 32px, configurator back 28px.
  - Line cards are long.
  - No primary in the bottom bar on an approved quote.
- **Omar:**
  - The approve dialog lacks lines, submitter and cost completeness.
  - No self-approval signal; no "approved by".
  - No nudge to set a floor.

## Minor observations
- **Colour:** `text-accent` undefined; raw colours in the template configurator.
- **Shapes:** billing control radius 0.25rem.
- **Copy:** Title Case remnants.
- **Formats:** raw ISO valid-until date; "0.4" price format.
- **Layout:** the toast covers the badge.
- **Pipeline:** ends at Approved.

## Questions to consider
1. Who is "Submit for approval" for on a clean quote?
2. Should the margin % be hidden until costs are complete?
3. Should one strip cover Draft → Approved → Sent → Accepted → Order?
