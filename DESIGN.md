---
version: "helpix-v1"
name: "helpix - AI support agent for shops"
description: "Design system for helpix: a calm, mint-on-neutral support product with a dense operational dashboard and a friendly chat widget. Light and dark themes have equal standing. Tokens live in packages/ui/src/styles/globals.css; brand rules in brand/brand-sheet.html."
colors:
  primary: "#08705F"          # Mint 700 (dark: #2FC3A7) - buttons, links, small mint text
  brand: "#0C9A82"            # Mint 600 (dark: #3FD1B5) - logo, launcher, icons, text >= 24px
  brand-bright: "#3FD1B5"     # Mint 400 - accents on dark
  secondary: "#E3F4EF"        # Mint wash (dark: #11302A) - agent bubbles, soft panels, active nav
  background: "#F4F7F6"       # dark: #0B100F
  surface: "#FFFFFF"          # card; dark: #131A19
  surface-inset: "#EAF0EE"    # muted; dark: #1A2322 - nested panels, table hover
  text-primary: "#101A18"     # Ink; dark: #E9F0EE
  text-secondary: "#56645F"   # dark: #97A6A1
  border: "#DCE3E0"           # dark: #25302D
  destructive: "#C2413A"      # dark: #F0776F
  night: "#0F1716"            # dark brand backgrounds
typography:
  display-lg:
    fontFamily: "Bricolage Grotesque"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: "1.15"
    letterSpacing: "-0.015em"
  metric:
    fontFamily: "Bricolage Grotesque"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: "1.1"
    letterSpacing: "-0.02em"
  body-md:
    fontFamily: "Instrument Sans"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "1.43"
  label-md:
    fontFamily: "IBM Plex Mono"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: "1.2"
    letterSpacing: "0.08em"
    textTransform: "uppercase"
spacing:
  base: "4px"
  gap: "8px"
  card-padding: "24px"
  panel-padding: "16px"
  section-gap: "24px"
  page-padding: "32px 16px"
  content-max-width: "1024px"
rounded:
  card: "1.05rem"   # rounded-xl
  panel: "0.75rem"  # rounded-lg
  control: "0.6rem" # rounded-md - buttons, inputs, badges
  pill: "9999px"    # launcher, avatar, status dot
components:
  card:
    background: "surface token, 1px border, shadow-sm; border first, shadow second"
    radius: "card"
  panel:
    background: "surface-inset at 50% inside a card, 1px border, no shadow"
    radius: "panel"
  button:
    background: "primary for the one main action per view; secondary/outline/ghost for the rest"
    radius: "control"
  badge:
    background: "soft tints: secondary + primary text for good states, destructive/10 for bad"
    radius: "control"
---

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/logo/lockup/helpix-lockup-on-dark.svg">
    <img src="brand/logo/lockup/helpix-lockup-primary.svg" alt="helpix" width="240">
  </picture>
</p>

# helpix - AI support agent for shops

The source of truth for tokens is [`packages/ui/src/styles/globals.css`](packages/ui/src/styles/globals.css), and for brand rules it is [`brand/brand-sheet.html`](brand/brand-sheet.html) (v1, 30 Sep 2026). The frontmatter above mirrors them. If this file and the CSS disagree, fix one of them on purpose. Don't override styles locally.

## Overview

helpix is the AI support agent that lives in a shop's chat widget. There are two surfaces:

- **Admin dashboard** (`apps/admin-dashboard`): an operational tool for super-admins and shop admins. It should feel **dense, modular and calm**, with compact panels, clear metric emphasis and a steady rhythm. It is not a marketing page.
- **Chat widget** (step 4): sits on someone else's shop. It should be friendly and quiet, speak in the shop's name, and keep helpix to the "Powered by" footer.

Mint is the only brand colour, and everything else is a tinted green-grey neutral. Light and dark themes have equal standing. The theme follows the system, or the user can pick one in the header (`.dark` on `<html>`, see `apps/admin-dashboard/src/lib/theme.ts`).

## Logo

<p>
  <img src="brand/logo/refined/h-pixel-mint.svg" alt="helpix mark" width="48">
  &nbsp;
  <img src="brand/logo/refined/h-pixel-app-icon.svg" alt="helpix app icon" width="48">
</p>

The mark is a lowercase **h** for help, with a **pixel** above it for the "pix" in the name.

| Use | File (under `brand/logo/`) |
| --- | --- |
| Default lockup, on light | `lockup/helpix-lockup-primary.svg` |
| On dark | `lockup/helpix-lockup-on-dark.svg` |
| On a mint panel | `lockup/helpix-lockup-on-mint.svg` |
| On photos or any dark background | `lockup/helpix-lockup-white.svg` |
| One colour | `lockup/helpix-lockup-mono.svg` |
| Mark only | `refined/h-pixel-mint.svg`, `refined/h-pixel-mono.svg` |
| App icon / favicon | `refined/h-pixel-app-icon.svg`, `png/h-pixel-app-icon-{16,32,48,180,512,1024}.png`, `favicon.ico` |
| PNG exports | `png/helpix-lockup-*-2000w.png`, `png/h-pixel-mint-1024.png` |

- **In app code, use `<HelpixLogo>` from `@helpix/ui`.** Size it with a height class (`h-6` in the header, `h-9` on sign-in). For the square mark, pass `mark-only` and size it with `size-*`. It colours itself (`text-brand` mark, `fill-foreground` wordmark), so it works in both themes. Never set "helpix" in live text as a logo, because the lockup files have the wordmark outlined to paths.
- Use the lockup by default. Use the mark alone when the name is nearby or the space is square (empty states, favicons).
- **x** is the pixel's width (12.5% of the mark grid). Keep **1x** clear on every side. The mark–wordmark gap is **1.5x**, and the mark is 74% of the wordmark's size, on its baseline.
- Smallest mark: **16 px** (below that, use the app icon). Smallest lockup: **72 px** wide.
- Always lowercase. Don't rotate, stretch, recolour outside the palette, move or drop the pixel, or add shadows, outlines or gradients.

## Colors

The palette is anchored on **Mint** (`brand` #0C9A82, `primary` #08705F) over tinted neutrals. Keep the background, surface, inset panel, text and border roles distinct, because the dashboard's hierarchy depends on that contrast.

| Token (Tailwind class) | Light | Dark | Use |
| --- | --- | --- | --- |
| `brand` (Mint 600) | `#0C9A82` | `#3FD1B5` | Logo, launcher, icons, metric accents, text ≥24 px |
| `primary` (Mint 700) | `#08705F` | `#2FC3A7` | Primary buttons, links, small mint text |
| `brand-bright` (Mint 400) | `#3FD1B5` | `#3FD1B5` | Logo and accents on dark |
| `secondary` / `accent` (Mint wash) | `#E3F4EF` | `#11302A` | Agent bubbles, active nav, positive badges, hover |
| `background` | `#F4F7F6` | `#0B100F` | Page |
| `card` (surface) | `#FFFFFF` | `#131A19` | Cards, dialogs, header |
| `muted` (surface-inset) | `#EAF0EE` | `#1A2322` | Nested panels, table row hover |
| `foreground` (Ink) | `#101A18` | `#E9F0EE` | Body text, wordmark |
| `muted-foreground` | `#56645F` | `#97A6A1` | Secondary text, mono labels |
| `border` / `input` | `#DCE3E0` | `#25302D` | Rules, input borders |
| `ring` | `#0C9A82` | `#2FC3A7` | Focus rings |
| `destructive` | `#C2413A` | `#F0776F` | Errors, suspend, delete |
| Night | `#0F1716` | — | Dark brand backgrounds |

> **Mint 600 fails AA for small text on white (3.5:1).** Use `text-primary` for links and labels under 24 px. Use `text-brand` only for the logo, icons and large text or numbers.

Use only the semantic classes (`bg-primary`, `text-muted-foreground`, `border-border`…). Never hard-code hex values in components. Mint stays rare: one primary action per view, plus status and metric accents.

## Typography

| Role | Face | Weights | Where |
| --- | --- | --- | --- |
| Display (`font-display`) | **Bricolage Grotesque** | 500, 700 | Wordmark, `h1`/`h2` (`tracking-tight`), metric numbers |
| Interface (`font-sans`) | **Instrument Sans** | 400, 500, 600 | All UI text, widget messages, docs |
| Mono (`font-mono`) | **IBM Plex Mono** | 400, 500 | Section labels, keys, IDs, timestamps, tabular data |

All three load from Google Fonts in `apps/admin-dashboard/index.html` (`display=swap`). The fallbacks are Avenir Next / Helvetica Neue / Menlo, then `system-ui`.

| Style | Classes | Use |
| --- | --- | --- |
| Page title | `text-2xl font-semibold` | One `h1` per page |
| Metric | `font-display text-3xl font-bold tracking-tight tabular-nums` | The number in a stat panel |
| Hero card title | `font-display text-xl tracking-tight` | Sign-in |
| Dialog title | `text-lg font-semibold leading-none` | Dialogs |
| Card title | `font-semibold leading-none` | Cards |
| Body (default) | `text-sm` | Tables, forms, buttons, nav, descriptions |
| Small | `text-xs` | Badges, hints, small buttons. Nothing smaller |
| **Mono label** | `font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground` | Panel eyebrows ("DOCUMENTS", "LAST 7 DAYS"), metadata, key/ID captions |

Use `font-medium` for labels and buttons and `font-semibold` for titles. Use mono with `tabular-nums` for anything compared in columns (counts, sizes, dates, keys).

## Layout

Spacing follows Tailwind's **4 px scale**. Stick to these steps:

| Step | px | Use |
| --- | --- | --- |
| `0.5` / `1` / `1.5` | 2 / 4 / 6 | Icon-to-label, badge padding, nav item gaps |
| `2` | 8 | **Default gap** inside controls and between small items |
| `3` | 12 | Header action groups, list rows, nav links (`px-3`) |
| `4` | 16 | Page gutter, form field gaps, **dense panel padding** (`p-4`), gaps in grids of panels |
| `6` | 24 | **Section rhythm** (`grid gap-6`), card padding (`px-6` / `py-6`) |
| `8` | 32 | Main content padding (`py-8`) |
| `12` | 48 | Empty states |

**Page structure** (`apps/admin-dashboard/src/layouts/AppLayout.vue`):

- Sticky header: `h-14 border-b`, translucent `bg-card/85 backdrop-blur`, with the same `max-w-5xl px-4` column as the content so the edges line up.
- Content: `mx-auto max-w-5xl px-4 py-8`.
- A page is a `grid gap-6` stack: a title row (title + primary action on the right), then panels.
- Panel grids: put related metrics or summaries in a modular grid (`grid gap-4 sm:grid-cols-2 lg:grid-cols-3`), not one long column of full-width cards. Uneven spans (`lg:col-span-2`) are fine when one panel matters more. Grids collapse to one column on mobile.
- Two-pane tools (agent settings beside the playground): `grid items-start gap-6 lg:grid-cols-2`.
- Narrow screens (sign-in): `max-w-sm`. Dialogs: `max-w-lg`, with `p-6 gap-4` inside.
- Control heights: buttons are h-8, h-9 or h-10 (sm, default, lg). Inputs are h-9 to match default buttons. Table header rows are h-10 with `px-2` cells.

## Components

Reuse `@helpix/ui` first: **Button, Badge, Card (Header/Title/Description/Content/Footer), Table, Dialog, Input, Textarea, Label, EmptyState, CopyButton, HelpixLogo.** New shared primitives go into `packages/ui`, not into the app.

- **Cards** are `rounded-xl border bg-card shadow-sm`. Elevation is a border first, then a soft shadow.
- **Nested surfaces:** inside a card, group secondary content (key/value blocks, previews, tool-call details, source lists) in an inset panel: `rounded-lg border bg-muted/50 p-4`. Use one level of nesting. Never put a card inside a card.
- **Stat panel** (metric emphasis): a mono label on top, the metric number below in `font-display text-3xl tabular-nums`, and an optional `text-xs text-muted-foreground` delta or caption. Keep it compact (`p-4`). Colour the number `text-brand` only for the one headline metric. The rest stay `text-foreground`.
- **Buttons:** `default` (Mint 700) for the one main action, plus `secondary`, `outline`, `ghost`, `destructive` and `destructive-outline`. Sizes are `sm`, `default` and `lg`.
- **Badges:** `positive` (wash + Mint 700) for Ready/Active and `negative` (destructive tint) for Failed/Suspended. Add `dot` for a status dot.
- **Tables** carry dense lists (tenants, documents, conversations): `text-sm`, mono `tabular-nums` for sizes, dates and counts, `hover:bg-muted/50` rows, and whole-row click targets that open detail pages.
- **Empty states** use `<EmptyState>`: the mark in a mint-wash circle, a title, one sentence and at most one action.
- **Radius language:** buttons, inputs and badges share `rounded-md`, panels use `rounded-lg`, cards and dialogs use `rounded-xl`, and the launcher and dots use `rounded-full`. Don't mix in other radii.

**Chat surfaces** (widget, playground, conversation detail):

- **Agent bubbles:** `bg-secondary text-secondary-foreground`, with the bottom-left corner tightened. **Customer bubbles:** `bg-foreground text-background`, with the bottom-right corner tightened.
- Assistant text renders as **plain text** (`whitespace-pre-wrap`), never as HTML. Tool activity (KB searches) shows as small chips or inset panels under the message, labelled in mono.
- Widget launcher: 56 px circle on Mint 600, 16 px from the bottom and right edges, with a 28 px white mark. A shop may recolour it, but the mark stays white and is never mint on mint.
- The widget header shows **the shop's name**, not helpix. The footer reads "Powered by" plus the lockup at 12 px.

## Motion

Smooth and restrained. Motion explains a change. It never decorates.

- **Curves:** `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` and `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` (these override Tailwind's defaults).
- **Durations:** 150 ms for state changes, 200 ms for entrances, faster for exits. Nothing in the UI runs longer than 300 ms.
- **Press:** buttons scale with `active:scale-[0.97]` over 150 ms.
- **Hover lift:** only on clickable cards and panels. Use `transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md`. Static cards don't move.
- **Staggered entrance:** when a list or panel grid first loads, fade each item in from 4 px below (`opacity` + `translateY`) over 200 ms, staggered 30–40 ms per item, for the first ~8 items only. Don't animate on re-render, filtering or polling updates.
- **Dialogs:** `.hx-dialog` enters in 200 ms (opacity + scale from 0.96) and exits in 150 ms.
- **Streaming replies:** text appears as it streams. Don't add typewriter effects on top.
- **Theme switch** is instant (`.hx-theme-switching`).
- **Reduced motion:** remove all transforms (lift, stagger offset, scale) and keep opacity fades of 150 ms or less.

## Effects

Atmosphere is a supporting layer behind content, never behind data.

- The only ambient effect is a **faint mint-wash radial glow** behind focal, low-density screens such as sign-in (`bg-[radial-gradient(60rem_30rem_at_50%_-10%,var(--color-secondary),transparent_70%)]`, `pointer-events-none`, `aria-hidden`).
- No WebGL, particles, animated gradients or glow behind tables, forms or chat. Keep the dashboard fast and legible.
- Floating elements (widget panel, launcher, dialogs) may use a soft, mint-tinted shadow. Everything else uses `shadow-sm` or less.

## Guardrails

- Mint is the only accent. Don't add a second brand colour, and don't use teal variants outside the tokens.
- Keep light and dark at equal quality. Check every new screen in both.
- Don't flatten dashboards into one long column of identical full-width cards. Group them into modular panels with clear metric emphasis.
- Keep buttons, inputs, badges, panels and cards on the same radius and border language.
- One primary (mint) action per view.
- Never render model output as HTML.
- Voice: plain and specific. Say what happened and what to do next ("Suspending stops the shop's widget and blocks its admins from signing in. No data is deleted."). Use sentence case for labels, and keep mono labels uppercase.

## Notes

The format and the dashboard feel (mono labels, metric emphasis, nested surfaces, modular panels, hover lift, staggered entrances) are adapted from a Neuform "Nexis Compute" design brief. Its palette, fonts, dark-only mode and WebGL effects were deliberately **not** adopted, so helpix keeps its own brand. Stat panels, inset panels, hover lift and staggered entrances are guidance for new and updated screens. They are not all in the dashboard yet.
