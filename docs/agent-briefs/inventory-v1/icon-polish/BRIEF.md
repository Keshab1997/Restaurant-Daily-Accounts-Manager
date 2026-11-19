# icon-polish — Worker B

**Repository:** `Keshab1997/Restaurant-Daily-Accounts-Manager` — attach this repo in a NEW Arena Agent Mode session on current remote `main`. Use your own real `arena/*` branch, not Worker A's branch.

**Goal and acceptance:** Design and implement a small consistent, professional custom SVG icon sprite to polish the inventory page. It should suit a modern restaurant stock management UI and be visually coherent at 20–24px on mobile and desktop. Provide reusable symbol IDs exactly `inventory`, `stock`, `purchase`, `sale`, `damage`, `calendar`, `upload`, `save`, `print`, `share`, `download`, `edit`, `warning` in `assets/inventory-icons.svg`; each uses `viewBox="0 0 24 24"`, strokes/currentColor, no scripts, images, fonts, external links or third-party resources. It must work with `<svg aria-hidden="true"><use href="assets/inventory-icons.svg#save"></use></svg>`. No business data, text labels or embedded secrets. Add `tests/test_inventory_icons.py` with focused offline checks for valid XML, symbol IDs, viewBox, currentColor, and absence of scripts/external references. Explain any caveats in the final report.

**Interface / exclusions:** Worker A owns the inventory page and its CSS/JS; DO NOT touch `inventory.html`, `css/inventory.css`, `js/inventory*.js`, schema, settings, tests/test_inventory.py or other files. Captain will integrate these symbols after both workers are reviewed. No dependencies, CI, PR, database changes, deployment or user data. Icon files are standalone assets only.

**Scope and gate:** See [task.json](task.json) at this same commit; do not edit it.
**Report:** worker chat (GitHub mention pending). Use the current agent-bootstrap `captain/FASTLANE.md`; keep the real linked branch. After verified PUSHED report exact base, tip, files, test, brief and commit link. If blocked, report why; no standalone work, re-pair, CI or PR.
