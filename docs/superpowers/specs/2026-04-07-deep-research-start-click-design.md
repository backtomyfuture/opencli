# Gemini `deep-research` Start Confirmation Fix Design

## Background

Current behavior for:

```bash
opencli gemini deep-research "研究周末最重要的5个新闻" -f json
```

can return:

```json
[{"status":"started","url":"https://gemini.google.com/app/xxxx"}]
```

even when the opened page is still on the “start research” stage and Deep Research has not actually started.

This is a false-positive `started` status and breaks downstream automation expectations.

## Goals

1. `started` must mean: confirm action succeeded **and** research is observably in progress.
2. Distinguish “not started yet but waiting at start step” from generic confirm failure.
3. Reuse status-detection semantics from `deep-research-result.ts` where practical.
4. Keep existing send/retry protections (no duplicate prompt resend during confirm retries).

## Non-Goals

1. Redesigning full Gemini automation flow.
2. Introducing external dependencies.
3. Changing the behavior contract of unrelated Gemini commands.

## Chosen Approach

Use **Approach A (state-machine verdict)** plus **partial Approach C (shared status predicates)**:

- `deep-research.ts` remains the flow orchestrator.
- Move Deep Research semantic text checks into shared helpers in `utils.ts`.
- `started` is no longer inferred from URL shape alone.

## Proposed Design

## 1) Shared Deep Research status predicates (`utils.ts`)

Add shared helpers:

- `isDeepResearchInProgressText(text: string): boolean`
- `isDeepResearchWaitingForStartText(text: string): boolean`
- (optional) `isDeepResearchCompletedText(text: string): boolean` for future consistency

These helpers consolidate and normalize regex patterns currently split between `deep-research.ts` and `deep-research-result.ts`.

## 2) `deep-research.ts` verdict model

Replace URL-based success shortcut with a verdict function that evaluates:

- latest URL,
- snapshot generation signal (`snapshot.isGenerating` where available),
- latest assistant/status text.

Verdict mapping:

- `started`:
  - confirm click occurred in flow, and
  - strong in-progress signal detected (`isGenerating` or `isDeepResearchInProgressText`), and
  - not simultaneously blocked by waiting-for-start signal.
- `waiting-for-start`:
  - waiting/start-plan/start-research signals detected after confirm attempts.
- `confirm-not-found`:
  - fallback when `started` and `waiting-for-start` conditions are not met.

Deterministic rule order (first match wins):

1. If `confirmMatched === true` and `inProgressSignal === true` and `waitingSignal === false` => `started`
2. Else if `waitingSignal === true` => `waiting-for-start`
3. Else => `confirm-not-found`

Where:

- `confirmMatched`: at least one confirm-click attempt returned a matched confirm label
- `inProgressSignal`: `snapshot.isGenerating === true` OR `isDeepResearchInProgressText(statusText) === true`
- `waitingSignal`: `isDeepResearchWaitingForStartText(statusText) === true`

## 3) Retry policy (unchanged in spirit)

Keep current retry behavior:

- submission retry once if initial submit signal is missing,
- confirm retry path without resending prompt,
- short fallback confirm pass with expanded labels.

But final status is now produced strictly by verdict model above.

## Data Flow

1. `startNewGeminiChat`
2. `selectGeminiTool`
3. `sendGeminiMessage`
4. `waitForGeminiSubmission` (retry once when needed)
5. `waitForGeminiConfirmButton` (primary + fallback retry)
6. Collect runtime signals:
   - current URL
   - `readGeminiSnapshot(...).isGenerating` (safe best-effort)
   - latest assistant/status text
7. Produce final status:
   - `started` / `waiting-for-start` / `confirm-not-found` (+ existing early exits)

## API / Output Contract

Existing statuses preserved:

- `tool-not-found`
- `submit-not-found`
- `confirm-not-found`
- `started`

New status:

- `waiting-for-start`

`columns` remains `['status', 'url']`.

## Testing Plan

## Unit tests

Update/add tests in `clis/gemini/deep-research.test.ts`:

1. URL switched to `/app/<id>` but text still indicates “Start research” => `waiting-for-start`.
2. Confirm click returned a label, but no in-progress signal appears => `waiting-for-start`.
3. Confirm click returned a label and in-progress signal appears => `started`.
4. No confirm label, but in-progress signal appears => `confirm-not-found` (per strict contract).
5. Neither in-progress nor waiting signal => `confirm-not-found`.
6. Ensure no duplicate resend in root-url retry path remains true.

Add helper-focused tests (new or existing test file under `clis/gemini/`):

- in-progress regex coverage
- waiting-for-start regex coverage
- conflict precedence (when waiting and in-progress both appear, `waiting-for-start` wins)
- decision-table coverage for all `{confirmMatched, inProgressSignal, waitingSignal}` combinations

Add regression tests for `clis/gemini/deep-research-result.ts` to ensure shared predicate extraction does not change current output semantics:

- in-progress text still maps to waiting message behavior
- completed text still maps to completed/no-docs behavior
- neutral text still maps to pending behavior

## Local verification

Run repository validators according to project scripts (test/lint/typecheck as available), then perform one real-browser manual check:

```bash
opencli gemini deep-research "研究周末最重要的5个新闻" -f json
```

Expected:

- If page still waits for manual start => `waiting-for-start`
- If research actually running and confirm was matched in flow => `started`

## Risks and Mitigations

1. **UI text drift**: Gemini labels may change.
   - Mitigation: centralized predicates in `utils.ts` and test coverage for aliases.
2. **Signal ambiguity**: transient UI can briefly show mixed states.
   - Mitigation: precedence and fallback polling; avoid URL-only verdict.
3. **Behavioral compatibility**: consumers may only handle old statuses.
   - Mitigation: keep old statuses intact and add one explicit intermediate status (`waiting-for-start`).

## Rollout Notes

This is a behavior-tightening bugfix. No migration needed for internal code, but downstream callers should be informed to handle `waiting-for-start`.
