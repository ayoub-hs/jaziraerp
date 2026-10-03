# Project Rules — Al Jazira SHSP ERP

## Testing (mandatory)
- Test command: `npm test` (backend + frontend unit tests)
- Run the test suite after EVERY meaningful change — every new table, every new route, every new component — not just at the end of a task.
- If a test fails, stop and fix it before moving to the next step. Do not continue building on top of a known failure.
- For UI/flow changes, use the browser tool to actually exercise the flow (not just unit-test the logic) before marking a step complete.
- Never mark a task complete without showing the actual test output, not just a summary claim.

## Source of truth
- `erp-spec.md` is the functional specification. Do not add features, entities, or fields beyond what it states without flagging the assumption explicitly and asking first.
- `implementation_plan.md` is the approved architecture and schema. Follow it exactly — including the supplier debt ledger and partial-refund tables, which were deliberately added to fix gaps in an earlier draft.
- `full_test_plan.md` is the acceptance checklist. Every item must be individually verified, not summarized.

## Working style
- Single user, no auth complexity beyond PIN/master password for offline unlock.
- Before implementing anything not explicitly covered by the spec, state the assumption and wait for confirmation rather than guessing.
- Work in small, testable increments. Do not generate large multi-file changes in one uninterrupted pass.
