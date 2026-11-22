# UI Design System Reference

Yatra's frontend implements the monochrome editorial + pastel color-block system defined in `DESIGN-figma.md`.

## Color Tokens (`frontend/tailwind.config.js`)

- **Monochrome Chrome**: `primary: #000000`, `canvas: #ffffff`, `surface-soft: #f7f7f5`, `hairline: #e6e6e6`, `hairline-soft: #f1f1f1`
- **Workspace Color Blocks**:
  - Trips & Members: `block-lime` (`#dceeb1`)
  - AI Planner & Legs: `block-lilac` (`#c5b0f4`) + single `accent-magenta` (`#ff3d8b`) AI CTA
  - Quorum Voting: `block-cream` (`#f4ecd6`)
  - Booking Saga: `block-navy` (`#1f1d3d`, inverse white ink)
  - Double-Entry Ledger: `block-mint` (`#c8e6cd`)
  - Site Operator Slots: `block-coral` (`#f3c9b6`)
  - Audit & NoSQL: `block-pink` (`#efd4d4`)
- **Semantic**: `semantic-success` (`#1ea64a`)

## Usability Simplification (v2)

Instead of a long vertical wall of forms, the UI uses a **clean pill-tab workspace switcher** (selected tab = black `#000000` pill, inactive = white pill) directly beneath a compact Trip Switcher bar. Only one pastel color-block workspace is visible in the viewport at a time, keeping every workflow fast, uncluttered, and easy to follow.
