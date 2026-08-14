# Warm Modern Sandstone & Golden-Amber Theme Design Spec

**Date:** 2026-08-14  
**Status:** Approved  
**Author:** AI Agent (Pair Programming with Ismail Farisi)  

---

## 1. Overview & Objectives

Transform the visual identity of Relay CRM from a standard cool-slate blue theme into a warm, modern, tactile neo-morphic design system inspired by premium dashboard aesthetics (warm sandstone cream backgrounds, vibrant golden-amber primary accents, high-contrast charcoal active tiles, generous 16px–20px rounded cards, and smooth golden data visualization widgets).

---

## 2. Design System Tokens (`globals.css`)

### 2.1 Light Theme Palette
* **`--color-canvas`**: `oklch(0.975 0.015 80)` (Warm cream oatmeal `#F9F6F0`)
* **`--color-surface`**: `oklch(1 0 0)` (Pure warm white `#FFFFFF`)
* **`--color-surface-muted`**: `oklch(0.945 0.02 80)` (Soft sandstone `#F3EDE2`)
* **`--color-border`**: `oklch(0.905 0.015 80)` (Fine sandstone border `#EBE4D8`)
* **`--color-border-strong`**: `oklch(0.82 0.025 80)` (Deep sandstone stroke `#D8CEBE`)
* **`--color-ink`**: `oklch(0.18 0.015 60)` (Warm dark espresso `#1C1B19`)
* **`--color-ink-muted`**: `oklch(0.48 0.02 60)` (Warm slate taupe `#6B665E`)
* **`--color-ink-subtle`**: `oklch(0.65 0.015 60)` (Muted sand `#9E978E`)
* **`--color-ink-inverted`**: `oklch(0.99 0 0)`
* **`--color-brand`**: `oklch(0.78 0.16 75)` (Sunny Golden-Amber `#F59E0B`)
* **`--color-brand-hover`**: `oklch(0.72 0.17 75)` (Rich Amber Gold `#D97706`)
* **`--color-brand-soft`**: `oklch(0.96 0.05 85)` (Warm Amber Tint `#FEF3C7`)
* **`--color-brand-dark`**: `oklch(0.18 0.01 260)` (Charcoal Onyx `#1E1E1E` for active sidebar tiles)
* **`--radius-card`**: `1.25rem` (20px)
* **`--radius-pill`**: `9999px`

### 2.2 Dark Theme Palette
* **`--color-canvas`**: `oklch(0.15 0.01 60)` (Deep warm obsidian `#181715`)
* **`--color-surface`**: `oklch(0.20 0.012 60)` (Warm dark charcoal `#22201D`)
* **`--color-surface-muted`**: `oklch(0.25 0.015 60)` (`#2C2A26`)
* **`--color-border`**: `oklch(0.30 0.015 60)` (`#3B3833`)
* **`--color-brand`**: `oklch(0.80 0.16 75)` (Luminous Golden Amber `#FBBF24`)
* **`--color-brand-soft`**: `oklch(0.32 0.06 75)`

---

## 3. Component System Updates

### 3.1 App Shell & Sidebar (`app-shell.tsx`)
1. **Pill Search Bar**: Fast module/global search input with magnifying glass.
2. **2-Column Quick Action Navigation Grid**:
   - 6 square/rounded tile buttons: **Dashboard**, **Inbox**, **Contacts**, **Customers**, **Quotes**, **Invoices**.
   - Active tile state: Solid **Deep Charcoal Onyx (`#1E1E1E`)** background with white text and icon.
   - Inactive tile state: Soft warm sandstone background with subtle border, hover lift, and dark ink icon.
3. **Collapsible Secondary Sections**: Rounded list items for Settings, Channels, Teams, and Permissions.
4. **User Profile Pill**: Avatar circle, User Full Name, Role badge, and Notification bell icon.

### 3.2 Dashboard Overhaul (`dashboard/page.tsx` & widgets)
1. **Hero Greeting Section**:
   - `"Good Morning, {User}"` (or Good Afternoon/Evening based on time of day).
   - Localized formatted date banner (*"Wednesday, 14 August 2026"*).
2. **Golden Stat Bar**:
   - 4 summary metrics (*Total Quotes, Active Customers, Quote Win Rate %, Open Invoices*) with icon chips.
3. **Circular Gauge Widget**:
   - SVG circular progress arc in bright golden amber (`80% Quote Win Rate` or `Revenue Target`).
4. **Golden Wave KPI Chart**:
   - Smooth SVG spline curve with golden amber stroke and gradient fill tracking monthly CRM performance.
5. **Pending Approval / Schedule Cards**:
   - Soft warm yellow gradient cards (`from-amber-100/70 to-amber-50/20`) with dark action buttons and avatar chips.
6. **Recent Deals & Customers Table**:
   - Pill search bar, generous padding, status pills, and action menu.

### 3.3 UI Primitives & Quotes Studio Harmony
* **Buttons (`button.tsx`)**:
  - `primary`: Golden amber background with dark text or crisp white text.
  - `secondary` / `dark`: Charcoal onyx `#1E1E1E` with white text.
  - `outline` / `ghost`: Warm border and hover tints.
* **Cards & Badges (`primitives.tsx`)**:
  - `rounded-2xl` / `rounded-3xl` corners with warm diffusion shadows.
  - Golden amber and sandstone badge tones.
* **Data Table (`data-table.tsx`)**:
  - Pill search bar, rounded card container, warm row hover highlights.
* **Quotes Studio (`quote-editor-page.tsx`)**:
  - Golden status pipeline ribbon, amber totals card highlights, and seamless sandstone background styling.

---

## 4. Verification Plan

1. Rebuild `@saas/shared` and compile `apps/web`.
2. Verify all pages (`/dashboard`, `/quotes`, `/quotes/new`, `/quotes/[id]`, `/customers`, `/contacts`, `/invoices`, `/inbox`, `/settings`) render with the new warm sandstone and golden-amber theme.
3. Verify both light mode and dark mode transitions.
4. Run all unit and component tests (`pnpm test`).
