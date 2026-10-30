---
target: quote editor
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:C:\\Users\\Keerthana\\ai_crm\\apps\\web\\src\\components\\quotes\\quote-editor\\quote-editor-page.tsx"
target_fingerprint: "sha256:4e1b258a1c7112f0a0e2c5fa58d6d7c617bf389eb77d41a925f1f792ef712b5a"
target_path: "C:\\Users\\Keerthana\\ai_crm\\apps\\web\\src\\components\\quotes\\quote-editor\\quote-editor-page.tsx"
timestamp: 2026-10-30T09-28-31Z
slug: quotes-quote-editor-quote-editor-page-tsx-e3db6260
---
Method: dual-agent (A: design review · B: detector + browser), run in turn because both needed the one shared browser.

# Quote editor critique, run 3: 24/40 (Acceptable)

The drop from 26 is not a regression. Run 3 found a bug that was already there: a catalog line's cost does not follow its quantity. Cost is captured at the picked quantity (1), and editing quantity only recalculates price. 500 boxes at 35% off showed a 99.8% margin on a job that loses money ($1,590 cost against $1,495). Saving re-costs on the server, so the stored quote and approval are right; the wrong number shows while pricing.

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 2 | Live margin wrong after a quantity change |
| 2 | Match with the real world | 3 | USD fallback, rigid box defaults to "Units" |
| 3 | User control and freedom | 2 | Bin deletes a line instantly, no undo |
| 4 | Consistency | 2 | Three home-made overlays beside the real dialog; read-only Billing is a disabled select |
| 5 | Error prevention | 2 | Submit live on an empty $0 quote; "No date set" unflagged in send dialog |
| 6 | Recognition rather than recall | 3 | Locked quote doesn't say which line has no cost |
| 7 | Flexibility and efficiency | 3 | Ctrl K/S good; focus lost after adding a line |
| 8 | Aesthetic and minimalist design | 3 | Calm, but a long stack of equal-weight cards |
| 9 | Error recovery | 2 | Mostly toasts; decision dialogs inline |
| 10 | Help and documentation | 2 | No explanation of margin or floors |
| **Total** | | **24/40** | **Acceptable** |

## Design specificity
Specific in words, generic in layout. Trade vocabulary, margin badges, rule-break banner, Draft → Approved → Accepted belong to this product; the page is any invoice editor, and True Cost is one number in a side card with no per-line cost.

Detector CLI: 0 findings (quote-editor, status pipeline, ui). Browser overlay: 4 findings on each of three quotes at 1440, all in the app shell sidebar (10px "Workspace"/"Owner", initials avatar 4.2:1, cream-palette warning = by design). At 390: Activity straggler, flat heading scale 1.17:1. Detector caught none of the review's main findings (logic, semantics, state).

## What's working
- Margin badge always carries a word, including loss with no floor and "Cost missing on N lines".
- Decision dialogs restate the decision; errors inline; focus returns.
- Lines become cards by container width; phone bottom bar keeps total and next step under the thumb.

## Priority issues
1. [P1] Live cost ignores quantity changes (quote-lines-table.tsx:102-127). Fix: re-resolve via /catalog/resolve-lines debounced; show "re-costing…". /impeccable harden
2. [P1] Approved quotes with an existing order (approved before order-on-acceptance) still offer Send and Mark as accepted, with copy promising to raise the order (quote-customer-panel.tsx:153). Fix: branch on order. /impeccable clarify
3. [P1] Cost invisible per line; locked view drops the "no cost" marker; approve dialog lacks per-line margin. Fix: quiet cost/margin row per line for quote:view_cost. /impeccable layout
4. [P1] Catalog picker (unlabelled search, no listbox semantics), enquiry drawer (no focus), configurator (no trap), focus lost after adding a line. Fix: build on ui/dialog, combobox; focus new line. /impeccable harden
5. [P2] Phone approved quote: empty bottom bar, Send mid-page; desktop header wraps at 1440 with sidebar. Fix: hand primary to bottom bar; container-based header layout. /impeccable adapt

## Personas
- Fast keyboard user: focus lost after Ctrl K pick; no undo on delete; Save in More menu on phone.
- Screen-reader user: unlabelled catalog search, silent results; drawer doesn't take focus; "Terms and conditions has content".
- One-handed phone: approved actions mid-screen; chrome takes ~30% of height; tax select cut to "No tax (0".
- Owner approving on a phone: can't see which line hurts margin; estimator saw 99.8% while owner sees the re-costed figure; missing valid-until/terms unflagged.

## Minor
Payment terms truncated at 1440; no thousands separators; AED example on USD quote; raw field names in Activity; More menu holds one item on locked quotes; "Accepted" said three times; accepted quote ends on amber badge; Mark as accepted dialog shows no total; configurator borders below 3:1 and engineer metadata; Sparkles icon on Configure; dark-mode active Quotes tile; Ctrl K hint on tablets; sidebar 10px labels and avatar contrast.

## Questions
- If True Cost is the brand, why is cost a card at the bottom and not on every line?
- Should a typed line with no cost reach approval at all?
- Once there's a sales order, should the quote page hand over to the order?
- Would a tablet estimator rather pick a job and quantity than fill a nine-column grid?
