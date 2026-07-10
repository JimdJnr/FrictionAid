---
name: Theme accent & dark-mode contrast
description: How --brand vs --brand-strong split keeps themed accents WCAG AA in both modes, and what dark mode still leaves unfinished.
---

# Theme accent contrast (WCAG AA)

`--brand` and `--brand-strong` have distinct roles — do not collapse them:

- `--brand` = the saturated accent used as a **background behind white text** (buttons,
  FAB, avatars, app bar). Must stay dark enough that white-on-it clears 4.5:1. Keep it
  equal to the user's chosen theme colour in both modes.
- `--brand-strong` = the **foreground text/icon** colour. `applyPreferences()` computes
  it per mode with `readableAccent()`: darken toward black in light mode (target ≥4.6:1
  on `--brand-soft`/nav-selected), lighten toward white in dark mode (target ≥4.6:1 on
  the dark card/soft/nav/bar-track surfaces).

**Why:** the 6 `THEME_COLORS` are mid-dark hues that read fine on white but drop to
~2.7–3.3:1 as text on the dark card — a single variable can't satisfy both "white text
on it" and "it as text on dark". Splitting the two roles resolves the conflict.

**How to apply:**
- Any place that uses the accent as *text or an icon* should reference `var(--brand-strong)`,
  not `var(--brand)`. In light mode they render identically, so switching a foreground use
  from brand→brand-strong is visually free and fixes dark mode for free.
- Any place that uses the accent as a *background with white text* must use `var(--brand)`
  (e.g. `.voice-coach`, hover states use `var(--brand)` + `filter: brightness(0.92)`).
- Semantic pills (`--danger`/`--warn`/`--ok`) are darkened at `:root` so their text clears
  4.5:1 on the pale pill backgrounds (which stay pale in both modes). Because those darkened
  values fail as *direct text on dark surfaces*, dark mode re-lightens them only for the
  specific text selectors (form messages, sched-window statuses) — not for the pills.
- Verify in a real browser (jsdom/axe can't compute contrast). A throwaway harness page under
  `public/` that inlines the same `readableAccent` math and renders the components at
  `?theme=light`/`?theme=dark` across all `THEME_COLORS` is the quickest check; delete it after.

**Known gap (not fixed here):** many report-card sub-surfaces hardcode `background:#fff`
or pale fills (inputs, `.secondary-btn`, `.outcome-btn`, `.updates-toggle`, `.ack-form`,
`.resolve-form`, `.updates-panel`, stat cards, etc.) while their text is `var(--ink)`/
`var(--muted)`/`var(--brand-strong)`. Dark mode does not flip those backgrounds, so the
themed (now-light) text lands on white — unreadable. That's a broad "finish dark-mode
surfaces" effort, separate from the accent/pill contrast audit.
