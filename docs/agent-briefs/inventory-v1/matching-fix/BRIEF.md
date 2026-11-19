# matching-fix — Worker A

**Repository:** `Keshab1997/Restaurant-Daily-Accounts-Manager` — attach this repo in Arena Agent Mode, reuse your original actual `arena/*` branch at the exact verified base in task.json.

**Goal and acceptance:** Correct the reviewed stock-sheet checkpoint. The initial version forces manual mapping for every dish despite the requirement to match report dishes to stock items. Add conservative name-based matching suggestions: existing saved mappings/Ignore always win; for an unmapped dish suggest a stock item only when normalized whole-word item-name matching identifies exactly one candidate; show the suggestion and its reason, and require user review before import. Never auto-map ambiguous candidates; show them for manual choice. Account for case, punctuation, whitespace; avoid substring false positives. Preserve editable mapping, ignored dishes, piece multiplier, preview, duplicate replacement and earlier-day balances. Add tests for exact and whole-word matching, ambiguity, prior saved mapping precedence, ignored items and false positives. Update setup instructions.

Also replace the known-vulnerable old SheetJS 0.18.5 browser dependency with a verified currently maintained official spreadsheet reader compatible with both .xls and .xlsx. Pin its version and document origin and integrity verification. If a safe compatible dependency cannot be verified, report BLOCKED rather than claiming it is fixed. Do not send workbook data to any server.

**Interface / exclusions:** Only task.json paths. No changes to accounting tables, navigation, CI, configuration, secrets or deployment. Do not run migration or operate on live restaurant data. Existing `inventory.html` URL and data contracts must remain compatible.

**Scope and gate:** See [task.json](task.json) at this same commit; do not edit it. Run focused pytest gate and inspect your diff.

**Report:** worker chat (GitHub mention pending). Use current agent-bootstrap `captain/FASTLANE.md`; preserve the linked branch and history. After verified PUSHED report the exact base, tip, files, gate, pinned brief and commit link. If blocked, report why; no re-pair, CI, PR, merge or branch switch.
