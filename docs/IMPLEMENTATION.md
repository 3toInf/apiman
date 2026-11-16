# apiman implementation ledger

Approved spec: conversation plan, 2026-11-16. Goal: local-only Talend-style API Tester for Chrome and Firefox/Zen, broad functional coverage, Talend migration verified using public fixtures.

Architecture: WXT/React/TypeScript, MV3 targets, full-page request execution, IndexedDB/Dexie. Domain boundaries: model → expressions → compile/execute → assertions/runner; import adapters and persistence consume the same versioned model; UI consumes all these boundaries.

Tasks:
- [x] 1. Build skeleton and tested HTTP execution.
- [x] 2. Persistence and Talend-style workspace.
- [x] 3. Import/export, environments, expression evaluation.
- [x] 4. Assertions and scenario execution.
- [x] 5. Browser E2E, fixtures, docs, packaging and independent review.

Ruling: use an in-place feature branch in this unborn, empty repository — the user requested implementation here and there is no existing state to isolate; no existing code is overwritten.
Ruling: contracts/core/import fixtures are implemented before UI integration — establishes testable shared interfaces without changing requested scope.

Acceptance: actual Chromium and Firefox extension tests, local echo server, expression/runner/import tests; typecheck, lint, tests, dual build, web-ext lint, zip. Public fixtures required, personal export optional. No cloud/native helper/TLS bypass/interactive OAuth/arbitrary scripts/WS/gRPC/CLI. Signing and store publication not performed.

Progress 2026-11-16: domain, importer, storage, React workspace and both MV3 bundles implemented. 18 unit/integration tests currently passing. Chromium extension send/save/reload/curl import passed; real Firefox extension HTTP/rendering passed using downloaded test Firefox and Selenium (the host /usr/bin/firefox is Snap and cannot share the default webdriver temp profile).
Ruling: minimum Firefox desktop 140, Android 142 — declares the current no-data-collection manifest field without unsupported-version warnings. Chrome minimum 120.
Ruling: use RFC9535 JSONPath interpreter and Zod v3 compatibility entrypoint — eliminates bundled dynamic Function evaluation under MV3 CSP. Hashes use maintained @noble/hashes; production npm audit currently 0 advisories.
Ruling: web-ext allows only two React DOM innerHTML implementation notices in the isolated react-vendor chunk. Application code never uses dangerouslySetInnerHTML. Every other warning/error fails scripts/lint-extension.mjs.
Remaining: finish real Talend assertion/scenario fixture, broaden core/E2E assertions, align UI with inspected original screenshot, docs/packages, final independent review and fixes. No completion claim yet.

Progress: 25 unit/integration tests pass. Expanded Chromium E2E covers assertion edits, regex worker, XPath, HTML resource isolation/form drafts, imported chained scenario, 35-second request and cancellation. Typecheck/ESLint/dual builds/web-ext pass. Firefox smoke test and fresh final review pending on final tree.
Ruling: HTML response parsing uses a disconnected template with a conservative element/attribute allowlist and sandboxed CSP preview; allow its one lint notice alongside two React notices — unlike live DOM parsing, resource elements remain inert before removal. Cost if wrong: untrusted response resource loads; local-server E2E detects these.
Ruling: scenario runs request broad HTTP(S) optional permissions to support dynamic hosts; single sends request target origin. Test copies pregrant permissions to bypass native UI. Cost: browser approval prompts still need manual acceptance/testing.
Ruling: preserve feat/apiman locally after implementation — no remote push, merge or store publication requested. The initial repository had no commits/base branch to merge into.
Ruling: bound execution/report limits (1000 steps, 64 KiB report previews, 30 reports, 500 history entries) keep long sessions usable; full response remains available during assertions/chaining. Cost: historical previews may be truncated, visibly marked.

Final review: fresh independent reviewer (gpt-6-astra, read-only), initial commit 1bb787a, no Critical findings and 7 Important findings. All Important findings accepted and fixed in one regression pass:
- Failed saves / newer drafts: atomic snapshot + matching draft deletion, validate before publishing state; storage regression RED→GREEN and real Chromium rejected-save/reload regression RED→GREEN.
- Deleted folder's unsaved children: include drafts in descendant deletion, remove drafts in the snapshot transaction; Chromium regression RED→GREEN.
- Omitted upload assets: remap every incoming file reference even without attachment records; regression RED→GREEN, shared-reference and full binary roundtrip tests added.
- Derived credentials: evaluate private expressions and collect compiled authentication headers for response/report redaction; Basic echo and private-expression regressions RED→GREEN.
- Assertion payload secrets: structural ID/name exemptions no longer apply within arbitrary actual/expected JSON values; regression RED→GREEN.
- JSON container equality: arrays and objects cannot compare equal; nested regression RED→GREEN.
- cURL data: preserve default form content type and split data-urlencode at only the first equals sign; regression RED→GREEN.

Final: minor (deferred): optional compatibility note when Talend stores a stale GET/HEAD body; effective behavior matches original (no payload) and raw source remains available in full backups. No execution behavior deferred.
Final: Ruling: string relational assertions retain Talend's documented length comparisons; numeric JSON targets remain numeric — changing this would break imported assertions. Evidence: https://help.qlik.com/talend/en-US/api-tester-user-guide/Cloud/assertion-operators . Cost: users expecting lexical text comparisons must use another assertion or transform.
Final: Ruling: reviewed exclusions (TLS bypass, OAuth wizard, arbitrary scripts, WS/gRPC and publication) remain excluded as explicitly approved; browser permission prompts and Zen-specific rendering are documented manual-test boundaries. Cost: Firefox evidence does not establish a separately tested Zen release.
Final: Ruling: native Talend 25.20.0 import/export roundtrip fixture now complements the official public v6 example; reviewer did not rerun that late fixture, so automated fixture and browser tests provide verification. Cost: compatibility with other Talend export versions is not claimed.
Final: Ruling: visual fidelity follows inspected original screenshot (dark repository sidebar, white navigation, request/response/assertion cards); independent review did not assess pixel identity. Cost: remaining visual differences require user feedback, not a claim of pixel parity.

Final verification 2026-11-16: npm run check passed (37 tests / 4 suites, TypeScript, ESLint, both MV3 builds, web-ext: 0 errors / 0 unexpected warnings / 3 documented notices); npm run test:e2e passed in Chromium and Firefox, including native Talend roundtrip scenario, long HTTP/cancel, HTML isolation, assertions, save recovery and orphan-draft deletion. npm run zip, npm run format:check and git diff --check passed. Production npm audit: 0 vulnerabilities. ZIP inspection confirms production optional permissions (no test pregrants) and no test artifacts.
All planned local implementation tasks complete. Artifacts: .output/apiman-0.1.0-chrome.zip and .output/apiman-0.1.0-firefox.zip. Signing/publication and separate Zen execution were not performed. Final fixes verified by regression tests, no duplicate review dispatch.

Follow-up: Talend URL / bare-variable compatibility, v0.1.1

User-approved requirements: preserve absent URI schemes; support bare environment references without changing quoted expressions/functions/request references; repair only saved URLs that exactly match the old importer and have verifiable Talend source; protect drafts and manual edits; report repairs and review items. No personal export data is included.

Implemented: shared Talend URL construction without protocol guessing, strict bare-variable resolution through the existing cycle/depth checks, shared HTTP URL validation before permission requests and compilation, and an idempotent snapshot repair during workspace loading. The snapshot/draft read and repaired snapshot write share a single IndexedDB transaction. Notifications run after commit; a failed repair retains the original snapshot and the UI can still load it. Saved requests with drafts are also protected. Review notices distinguish modified, draft and unverified records, including obvious doubled protocols without source.

Verification: 21 synthetic regressions added (58 total tests across 5 suites); initial run reproduced 18 failures before implementation. The focused independent review found no Critical or Important issues and one missing manual-review notice for source-less doubled protocols, reproduced RED then fixed GREEN. Existing named response bindings, quoted literals/functions, HTTP/HTTPS templates, nested/missing/cyclic/deep variables, exact-match migration, idempotence, draft protection and transaction rollback all pass. Chromium E2E seeds an isolated database with legacy records, verifies repair counts and preservation, imports and sends bare/nested URL templates, and checks actionable missing-variable/protocol errors. Full Chromium and Firefox E2E passed, including the existing 35-second request test; final v0.1.1 verification reran both browsers with --skip-slow. A direct-node Firefox attempt selected the system Snap geckodriver and failed before browser startup; invoking the documented npm script selected the project-local driver and passed. No product workaround or npm registry changes were made.

Final checks: npm run check, npm run test:e2e -- --skip-slow, npm run zip, npm run format:check, and git diff --check passed. v0.1.1 ZIP manifests retain optional host permissions; no test pregrants. Upgrade by reloading the extension and reopening the workspace, not re-importing the repository. Runtime counts depend on each browser's stored source/drafts; the supplied 172-request count was not independently verified against private data.
