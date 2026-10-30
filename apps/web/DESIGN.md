---
name: Kerf
description: The CRM that counts every cut — customers, costed quotes, production, stock and the books in one place.
colors:
  board-cream: "oklch(0.975 0.015 80)"
  surface: "oklch(1 0 0)"
  surface-muted: "oklch(0.945 0.02 80)"
  border: "oklch(0.92 0.012 80)"
  border-strong: "oklch(0.84 0.02 80)"
  border-control: "oklch(0.62 0.02 80)"
  workshop-ink: "oklch(0.18 0.015 60)"
  ink-muted: "oklch(0.44 0.02 60)"
  ink-subtle: "oklch(0.52 0.015 60)"
  ink-inverted: "oklch(0.99 0 0)"
  cut-line-amber: "oklch(0.78 0.16 75)"
  cut-line-amber-hover: "oklch(0.72 0.17 75)"
  amber-soft: "oklch(0.96 0.05 85)"
  on-brand: "oklch(0.18 0.015 60)"
  focus-ring: "oklch(0.6 0.15 70)"
  charcoal: "#1E1E1E"
  charcoal-hover: "#2C2C2C"
  on-charcoal: "oklch(0.99 0 0)"
  success: "oklch(0.52 0.14 155)"
  success-soft: "oklch(0.955 0.04 155)"
  warning: "oklch(0.52 0.12 65)"
  warning-soft: "oklch(0.96 0.05 85)"
  danger: "oklch(0.53 0.2 25)"
  danger-hover: "oklch(0.47 0.2 25)"
  danger-soft: "oklch(0.96 0.03 25)"
  info: "oklch(0.52 0.14 240)"
  info-soft: "oklch(0.955 0.035 240)"
typography:
  headline:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.33
    letterSpacing: "-0.025em"
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.43
    letterSpacing: "-0.025em"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.33
    letterSpacing: "0.05em"
  caption:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.33
    letterSpacing: "0.025em"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.33
rounded:
  sm: "0.5rem"
  control: "0.75rem"
  card: "1rem"
  pill: "9999px"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.cut-line-amber}"
    textColor: "{colors.on-brand}"
    rounded: "{rounded.pill}"
    padding: "0 1.125rem"
    height: "2.5rem"
  button-primary-hover:
    backgroundColor: "{colors.cut-line-amber-hover}"
  button-dark:
    backgroundColor: "{colors.charcoal}"
    textColor: "{colors.on-charcoal}"
    rounded: "{rounded.pill}"
    padding: "0 1.125rem"
    height: "2.5rem"
  button-dark-hover:
    backgroundColor: "{colors.charcoal-hover}"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.workshop-ink}"
    rounded: "{rounded.pill}"
    padding: "0 1.125rem"
    height: "2.5rem"
  button-ghost:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.pill}"
    padding: "0 1.125rem"
    height: "2.5rem"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.ink-inverted}"
    rounded: "{rounded.pill}"
    padding: "0 1.125rem"
    height: "2.5rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.workshop-ink}"
    rounded: "{rounded.control}"
    padding: "0 0.75rem"
    height: "2.5rem"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "1.25rem 1.5rem"
  badge-neutral:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "0.125rem 0.625rem"
  nav-tile-active:
    backgroundColor: "{colors.charcoal}"
    textColor: "{colors.on-charcoal}"
    rounded: "{rounded.card}"
    padding: "0.75rem"
  nav-tile:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.card}"
    padding: "0.75rem"
---

# Design System: Kerf

## Overview

**Creative North Star: "The Well-Run Workshop"**

Kerf should feel like walking into a clean, well-organised shop. The floor is swept and the bins are labelled. Every tool hangs where you expect it, and the one thing that needs your attention is marked in amber. The surfaces are warm and calm: cream board, white sheets, ink in a warm near-black. The colour comes from the saw cut in the logo, and it's spent only on the action that moves a job forward.

This is an Operate system first. Owners, estimators, storekeepers, accountants and operators each spend their day in it, on a desk monitor, on a phone in the field, or on a shared tablet by a machine. The quality shows as precision: figures line up in their columns, states are unmistakable, and controls are big enough to hit with a thumb. Expression lives in a few precise details. The sidebar's tiles are amber only on the action that counts, near-black marks where you are, and the corners are soft and friendly.

We reject two looks outright. One is the generic SaaS dashboard: purple gradients, glassy cards, decorative charts with no numbers. The other is the playful consumer app: big illustrations, emoji everywhere, bouncy motion.

**Key Characteristics:**
- A warm cream canvas with opaque white working surfaces.
- One accent, Cut-Line Amber, kept for the primary action and the focus ring.
- Charcoal near-black marks "you are here" and the strongest secondary actions.
- Pill buttons, rounded cards and generous controls: friendly and sturdy.
- Figures are always set in tabular numerals.
- Light and dark themes come from one set of semantic tokens.

## Colors

The palette is warm and restrained: a cream-and-ink base, one amber accent, and four status colours that only ever carry meaning.

### Primary
- **Cut-Line Amber** (`cut-line-amber`). This is the saw cut in the Kerf mark. It's used for the primary button (with Workshop Ink text, never white), the focus ring on every control, the selected checkbox, active icons in the sidebar lists, and count badges. It turns one step deeper on hover (`cut-line-amber-hover`).
- **On Amber** (`on-brand`). The text on every amber fill. It is Workshop Ink in both themes, because amber stays light in dark mode and body ink does not.
- **Focus Ring** (`focus-ring`, `--color-brand-ring`). A deeper amber than the fill, so the 2px focus outline holds 3:1 on white and cream.
- **Amber Soft** (`amber-soft`). A pale amber wash for selected table rows and the brand badge tone.

### Secondary
- **Charcoal** (`charcoal`, with `on-charcoal` text). The active sidebar tile and the `dark`/`secondary` button. It means "you are here" or "the strong alternative". In dark mode it flips to a light cream tile with Workshop Ink text, because a near-black tile on a near-black sidebar disappears.

### Neutral
- **Board Cream** (`board-cream`). The page canvas behind everything, like cream greyboard.
- **Surface** (`surface`). Cards, tables, dialogs, the sidebar and inputs. This is the white sheet the work sits on.
- **Surface Muted** (`surface-muted`). Recessed areas: table headers, idle nav tiles, hover fills, skeletons and the neutral badge.
- **Border** (`border`) and **Border Strong** (`border-strong`). Hairline structure between surfaces.
- **Control Border** (`border-control`). The outline of every field, 3:1 against what it sits on, so the box itself is visible.
- **Workshop Ink** (`workshop-ink`). Body text, headings, figures, and the text on amber.
- **Ink Muted** (`ink-muted`). Secondary text, descriptions and table header labels.
- **Ink Subtle** (`ink-subtle`). Placeholders, hints, section labels and idle icons.

### Status
- **Success**, **Warning**, **Danger** and **Info**. Each has a strong text value and a `-soft` wash, and they're used together in badges and alerts (wash background, strong text, a 20% border of the same hue). Danger also fills the destructive button.

### Named Rules
**The One Cut Rule.** Amber is spent on the single action that moves the job forward, and on focus. If two amber buttons sit side by side, one of them is wrong.

**The Status Means Something Rule.** Green, amber-warning, red and blue appear only to report a state: paid, overdue, failed, information. They are never decoration, and they always come with a word, because colour alone doesn't carry meaning.

**The Readable Ink Rule.** Every text colour, Ink Subtle and the status colours included, passes 4.5:1 on Surface, Board Cream and Surface Muted, in both themes. Amber is a fill and a focus ring, never text.

**The One Dark Mode Rule.** Dark mode is the `.dark` class on the page, and Tailwind's `dark:` variant is bound to it in `globals.css`. Never let a style follow the operating system on its own.

**The Token Only Rule.** Colour comes from the semantic tokens (`bg-surface`, `text-ink-muted`, `text-danger`), never from raw Tailwind palette classes (`text-amber-600`, `text-slate-500`) or hex. Raw values don't follow dark mode. Hundreds of them exist in the code today. That's drift to pay down, not precedent.

## Typography

**Body Font:** the system UI stack (`ui-sans-serif, system-ui, sans-serif`).
**Mono Font:** the system monospace stack, used for tool names, expressions and identifiers.

**Character:** a single plain sans in tight, small sizes. It reads like a tidy job sheet: dense, quiet, and dependable on any device.

Geist and Geist Mono are loaded in `src/app/layout.tsx` (`--font-geist-sans`, `--font-geist-mono`), but `--font-sans` is never mapped to them, so the app renders in the system stack. Wiring Geist in is a deliberate decision to make later, not an accident to copy.

### Hierarchy
- **Headline** (700, 1.5rem, tight tracking). The page title in `PageHeader`, one per page.
- **Title** (600, 0.875rem, tight tracking). Card and dialog titles. They're small on purpose: structure comes from position and weight, not size.
- **Body** (400, 0.875rem). Table cells, form values and descriptions. Descriptions use Ink Muted.
- **Label** (600, 0.75rem, 0.05em tracking, uppercase). Table column headers and sidebar section headings (at 11px).
- **Caption** (500, 11px, 0.025em tracking). Badges, nav tile counts and the user's role chip.

### Named Rules
**The Tabular Figures Rule.** Every quantity, price, margin, total and date in a column uses `tabular-nums`, so the digits line up. It's already used in nearly 300 places. A misaligned column of money is a bug.

**The Small Title Rule.** Inside the app, hierarchy comes from weight, position and ink tone, not from big type. Only the page headline goes above 0.875rem.

## Layout

There's a fixed 16rem sidebar on the left from the `lg` breakpoint (1024px) up. Below that, it becomes a slide-in drawer opened from a menu button. A sticky 3.5rem header carries the breadcrumb (organisation › page), the assistant launcher, notifications and the theme toggle.

Content sits in a centred column capped at 72rem (`max-w-6xl`). The padding is 1rem on the sides and 1.5rem vertically on small screens, and 2rem on both at `lg` and up. Sections stack with a 1.5rem gap.

Cards pad 1.5rem horizontally and 1.25rem vertically, and their headers 1.5rem by 1rem. Tables offer two densities: comfortable rows (0.875rem cell padding) and compact rows (0.625rem) for long lists on desktop. Tables scroll sideways inside their card on narrow screens, never the whole page.

The same screens serve a desktop, a phone and a shop-floor tablet. Primary actions must stay reachable without horizontal scrolling at phone width.

### Named Rules
**The Thumb Rule.** Controls are at least 2.5rem tall (inputs and default buttons). On screens used on the floor or on a phone, actions use the large button (2.75rem). The small button (2rem) is only for dense desktop toolbars and table rows.

## Elevation & Depth

Surfaces are solid and the depth is soft. Depth comes mainly from tone: white surfaces on Board Cream, recessed Surface Muted areas and hairline borders. Shadows are faint and ambient, and they're never structural.

The current code renders cards, tables and dialogs slightly see-through with a light backdrop blur (`bg-surface/85 backdrop-blur-xs`). The confirmed direction is opaque surfaces with the same soft feel, because they read better in bright light and over busy content. New work uses solid `bg-surface`, and the translucency gets removed as screens are touched.

### Shadow Vocabulary
- **Whisper** (`0 2px 10px rgba(0,0,0,0.015)`). Resting cards and table containers. It's barely there and only separates the sheet from the board.
- **Lift** (`0 10px 40px rgba(0,0,0,0.06)`). Dialogs. A modal sits clearly above the page.
- **Pressed tile** (Tailwind `shadow-md`). Only the active Charcoal sidebar tile.
- **Drawer** (Tailwind `shadow-xl`). The mobile navigation drawer over a 40% black scrim.

### Named Rules
**The Solid Sheet Rule.** Working surfaces are opaque. No frosted glass on cards, tables or dialogs. Blur is allowed only on the scrim behind a modal or drawer and on the sticky header.

## Shapes

The form language is soft and friendly. Actions are pills: buttons, badges, the sidebar search and count chips are all fully rounded (`pill`). Containers use generous 1rem corners (`card`): cards, tables, dialogs and nav tiles. Form controls and alerts use 0.75rem corners (`control`), and small inline controls use 0.5rem (`sm`). The Kerf mark is a rounded square (7/28 radius) with a white stroke and an amber cut through it.

`--radius-card: 1.25rem` is defined in `globals.css` but nothing uses it. The rendered card radius is 1rem.

## Components

### Buttons
Friendly and sturdy: a pill, a confident weight, and a slight press.
- **Shape:** fully rounded (`pill`). Heights are 2rem (`sm`), 2.5rem (`md`, the default), 2.75rem (`lg`) and a 2.25rem square icon button.
- **Primary:** Cut-Line Amber with Workshop Ink text, semibold. One per view, for the action that moves the job forward.
- **Dark / Secondary:** Charcoal with white text. Use it for the strong alternative.
- **Outline:** a surface fill with a hairline border, for neutral actions beside the primary.
- **Ghost:** no fill and muted ink that darkens on hover. Use it for toolbar and icon actions.
- **Danger:** a red fill with white text, only for destructive confirmation.
- **States:**
  - Hover deepens the fill.
  - Pressing scales to 0.99.
  - Focus shows a 2px amber outline at a 2px offset.
  - While loading, a spinner appears and clicks are refused, but the button keeps its place.
  - Disabled is 50% opacity.

### Badges
- **Style:** a pill with the soft wash of its tone, strong text in the same hue, and a 20% border. The text is 11px medium.
- **Tones:** neutral, brand, success, warning, danger and info. They're used for statuses: draft, sent, paid, overdue, matched.

### Cards / Containers
- **Corner style:** 1rem (`card`).
- **Background:** solid Surface on the Board Cream canvas.
- **Shadow:** Whisper.
- **Border:** a hairline in Border at low opacity. The header gets its own bottom hairline.
- **Internal padding:** 1.5rem by 1.25rem for the body, and 1.5rem by 1rem for the header.

### Inputs / Fields
- **Style:** a Surface fill, a Control Border outline that darkens on hover, 0.75rem corners, and 2.5rem height.
- **Label:** above the field, 0.875rem medium in Workshop Ink. A required field shows a red asterisk.
- **Focus:** a Focus Ring border and a 1px Focus Ring ring.
- **Error:** a Danger border, with one message slot under the field. A hint and an error share that slot, so the layout never jumps twice.
- **Disabled:** 60% opacity and a not-allowed cursor.

### Tables
- **Container:** a card (1rem corners, Whisper) that clips its contents and scrolls sideways when it's too wide.
- **Header:** a recessed Surface Muted row with uppercase 0.75rem labels in Ink Muted.
- **Rows:**
  - Hairline dividers between rows.
  - Hovering fills the row with Surface Muted.
  - Selected rows get an Amber Soft wash, with amber checkboxes.
- **Numbers:** in tabular numerals, aligned to the right.
- **States:** loading shows skeleton bars, and an empty table shows a centred icon, a title, a line of explanation and one action.

### Dialogs
- **Style:** a native `<dialog>` centred in the viewport, with 1rem corners, a Surface fill, the Lift shadow and a 25% black scrim.
- **Structure:** a title and description over a hairline, a scrolling body capped at 65% of the viewport height, and a footer on a muted wash with actions on the right.
- **Own-header overlays** (the catalog picker, a configurator, a drawer) use `ModalShell`: the same native `<dialog>`, near the top or on the end edge, so focus moves in, stays in, and goes back to what opened it. Never a hand-built `div` overlay.

### Navigation
- **Core tiles:** the main destinations are a two-column grid of rounded tiles (72px minimum height) with an icon above a label. Idle tiles are Surface Muted with muted ink. The active tile is Charcoal with white text and the Pressed tile shadow.
- **Lists:** secondary sections are collapsible lists with uppercase 11px headings. Their items are 0.75rem medium, with an amber icon when active.
- **Mobile:** the same content in a slide-in drawer.

### Kerf Mark (signature)
A 28-unit rounded square in near-black, with a white upright stroke and an amber diagonal cut. It's shared with the marketing site. It sits with the "Kerf" wordmark and a small uppercase "Workspace" label at the top of the sidebar.

## Do's and Don'ts

### Do:
- **Do** use the semantic colour tokens (`bg-surface`, `text-ink`, `text-ink-muted`, `border-border`, `bg-brand`, `text-danger`), so dark mode follows automatically.
- **Do** keep one amber primary button per view, with On Amber text on it in both themes.
- **Do** set every quantity, price, margin and date in `tabular-nums`, aligned to the right in tables.
- **Do** use solid `bg-surface` for cards, tables and dialogs, with the Whisper shadow and a hairline border.
- **Do** make primary controls at least 2.5rem tall, and use the 2.75rem button on phone and floor screens.
- **Do** pair every status colour with a word, in a badge or an alert.
- **Do** use logical spacing and alignment (`ms-`/`me-`, `ps-`/`pe-`, `text-start`/`text-end`) in new work, so layouts can flip for Arabic later.

### Don't:
- **Don't** drift towards a generic SaaS dashboard: no purple or blue gradients, no glassy frosted cards, no decorative charts without real numbers.
- **Don't** drift towards a playful consumer app: no big illustrations, no emoji as interface, no bouncy or springy motion.
- **Don't** use raw Tailwind palette classes (`text-amber-600`, `bg-slate-50`, `text-rose-600`) or hex values for interface colour.
- **Don't** put white text on Cut-Line Amber.
- **Don't** use type larger than 0.875rem inside cards. Only the page headline is large.
- **Don't** let a wide table scroll the page. It scrolls inside its own card.
