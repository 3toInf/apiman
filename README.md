# apiman

A local API testing workspace for users moving from Talend API Tester to Firefox or Zen. Built with TypeScript, React, and WXT, apiman uses Manifest V3 on both Chrome and Firefox. The interface follows the familiar repository tree, request, response, assertion, and scenario workflow. This is an independent implementation with no affiliation with Talend or Qlik.

## Installation

Requires Node.js 24 and npm:

```sh
npm ci
npm run build
npm run zip
```

- **Chrome / Chromium**: Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select `.output/chrome-mv3`.
- **Firefox / Zen**: Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and select `.output/firefox-mv3/manifest.json`. Temporary installations expire when the browser restarts. Permanent installation requires Mozilla signing; this repository's builds are unsigned and have not been published to an extension store.
- Click the apiman toolbar icon to open the workspace. Grant access to the target site when sending your first request. Scenarios can reference different hosts dynamically, so their first run requests HTTP and HTTPS site access.

Minimum versions: Chrome 120 and Firefox 140. Automated acceptance tests run in Chromium and Firefox. Zen is based on Firefox, but has not been tested separately.

## Everyday use

1. Click **New request**, select a method, and enter a complete URL. Headers and Body support variable expressions. Query parameters have individual enabled states and support duplicate names.
2. Manage variables in **Environments** and switch environments using the selector at the top. Both `${baseUrl}/users` and `${"baseUrl"}/users` use the current environment's variable. Private values are hidden in the editor and cleared in default backups.
3. Click **Send** to send a request, then click **Cancel** to stop it. Inspect responses using Pretty, Raw, Preview, Headers, and the sent request summary. Responses support search and download. HTML previews isolate scripts, network access, and navigation; links and forms create new request drafts for you to send.
4. Add **Assertions** for status, headers, body, size, duration, JSONPath, or XPath. Editing a condition re-evaluates it against the current complete response.
5. Organize requests into Projects, Services, and Scenarios. Scenarios execute an explicit sequence of steps, with repeat, delay, and stop-on-failure options. Projects and services run requests in name order.
6. Use `Ctrl/Cmd+S` to save and `Ctrl/Cmd+Enter` to send. Drafts and tabs are restored, and History entries can be replayed as drafts.

Authentication supports Basic, Bearer, and API Key. Request bodies support JSON, XML, text, URL-encoded forms, multipart file uploads, and binary files. Uploaded files are stored locally in IndexedDB.

## Talend migration and backups

Export your API Tester repository as JSON from Talend, then select **Import → Choose file → Preview import → Import data** in apiman. The preview shows item counts and compatibility notes. Imports append to the current repository without replacing existing items.

- The primary migration format is **Talend JSON version 6**, including projects, services, scenario steps, requests, environment variables, enabled states, assertions, expressions, and references between requests. See [tests/fixtures/README.md](tests/fixtures/README.md) for fixture sources.
- Explicit HTTP/HTTPS schemes are preserved. If Talend leaves the scheme unset, apiman keeps the URL template unchanged: `${host}/health` works when `host` is `https://example.test`. The final expanded URL must include HTTP or HTTPS; apiman does not guess a protocol.
- Bound request references are tracked by ID, so renaming items or importing projects with duplicate names preserves their original dependencies. Ambiguous references entered manually produce an error and require an explicit project path.
- Unsupported execution settings are listed and block sending. Use **Discard unsupported settings** only after reviewing the configuration. Full backups retain the original request source data.
- Postman v2, OpenAPI / Swagger, HAR 1.2, and common cURL commands can also be imported. OpenAPI imports generate request examples; fill in parameters and authentication, and review compatibility notes before sending. Postman scripts and shell commands are never executed.
- **Export** creates a native apiman JSON backup that can be imported in either browser. You can select a project and optionally include private values and uploaded files. Both are excluded by default. Compatibility with importing these backups back into Talend is not guaranteed.

If an earlier apiman build added `http://` to imported URL templates, update/reload the extension and reopen the workspace. It repairs a saved URL only when the retained Talend source confirms the scheme was unset and the URL still exactly matches the old importer's output. Modified URLs, requests with unsaved drafts, and records without verifiable source data are left unchanged. A notice shows the repair count and lists items needing manual review. Check preserved drafts before saving them. Re-importing the same repository is unnecessary and would create duplicates.

Expression examples:

```text
${host}
${"token"}
${"Login"."response"."body".jsonPath("$.token")}
${"Project"."Login"."response"."headers"."Content-Type"}
${"text".base64()}
${"7".math("MULTIPLY", "6")}
${timestamp().formatDate("TIMESTAMP", "ISO_8601")}
```

Expressions use a restricted interpreter with string, encoding, hash/HMAC, math, date, and random functions. Bare names such as `${host}` must match an enabled variable in the active environment; missing variables produce an explicit error. Nested variables retain cycle and depth checks. Existing quoted expressions, functions, and request/response references keep their semantics. Response references can access responses already available in the current session. Each scenario iteration uses an independent response context. Unsupported functions return explicit errors; expressions do not execute JavaScript.

## Data storage and browser limitations

Workspace data is stored in the current browser's IndexedDB. There are no accounts, synchronization services, telemetry, or native helpers. Network traffic comes from requests you send. Private variables are stored locally and are **not encrypted**. Keep backups secure, and export your workspace before uninstalling the extension or clearing its data.

History retains up to 500 entries, with body previews limited to 1 MiB. The latest 30 scenario reports are retained, with up to 64 KiB of body content per step. The default response limit is 20 MiB and can be changed in request settings. A scenario run is limited to 1,000 steps. Truncated results are not used to re-evaluate assertions. History and reports mask known credentials and private variables, but do not automatically identify all sensitive business data in responses.

HTTP requests execute in the full workspace page, avoiding dependence on the background service worker's lifetime. Closing or refreshing the workspace stops active runs. When reopened, reports are marked as interrupted; requests are not automatically resent.

Requests follow the browser's certificate trust, cookie policies, redirect behavior, and restricted-header rules. Cookie, Host, Origin, and User-Agent headers cannot be overridden, and GET/HEAD request bodies are not supported. There is no TLS verification bypass, interactive OAuth login wizard, WebSocket, gRPC, or arbitrary user scripting support.

## Development and verification

```sh
npm run dev                 # Chrome
npm run dev:firefox         # Firefox
npm run check               # Types, ESLint, unit/integration tests, both builds, web-ext lint
npx playwright install --with-deps chromium firefox
npm run test:e2e            # Install both extensions and test against a local HTTP server
npm run format:check
npm audit --omit=dev
```

E2E tests require Python 3 to create temporary XPI packages, Selenium/geckodriver, and Playwright Firefox. Use `FIREFOX_BIN` to specify a non-Snap Firefox binary. Tests access only a loopback echo server. Host permissions are pregranted in disposable extension copies to bypass native permission prompts, so those prompt interactions are not automatically tested. Production manifests retain optional host permissions.

The `web-ext` check allows three reviewed `innerHTML` notices: two internal React DOM implementations and the parser in `core/html.ts`, which uses a disconnected `<template>` and sanitizes the result with an allowlist. Every other warning and all errors fail the check. Tests verify that previews neither execute scripts nor load resources.

Code is organized by responsibility: `src/core` contains requests, expressions, assertions, and execution; `src/importers` contains format adapters; `src/storage` handles local persistence; and `src/ui` implements the workspace. Build artifacts are in `.output`, and test screenshots are in `test-results`. See [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) for implementation and review records.

Assertion comparisons follow Talend's type semantics: numbers compare by value, ordinary strings compare by length, and JSON assertions preserve the distinction between arrays and objects. See the [Talend assertion operator documentation](https://help.qlik.com/talend/en-US/api-tester-user-guide/Cloud/assertion-operators).
