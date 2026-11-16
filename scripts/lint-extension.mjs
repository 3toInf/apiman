import { spawnSync } from "node:child_process";
const result = spawnSync(
  "node",
  [
    "node_modules/web-ext/bin/web-ext.js",
    "lint",
    "--source-dir",
    ".output/firefox-mv3",
    "--output=json",
  ],
  { encoding: "utf8" },
);
if (!result.stdout) {
  console.error(result.stderr);
  process.exit(1);
}
const report = JSON.parse(result.stdout);
// React DOM ships the implementation of dangerouslySetInnerHTML. apiman never uses that
// prop. Keep this narrowly scoped to the isolated, unmodified React vendor chunk;
// The only application exception is core/html.ts: a disconnected template parses
// untrusted HTML inertly, then an allowlist strips active markup before sandboxed preview.
// Browser E2E verifies no scripts or resources execute. All other warnings fail.
const known = (report.warnings ?? []).filter(
  (w) =>
    w.code === "UNSAFE_VAR_ASSIGNMENT" &&
    /^(?:chunks|assets)\/(react-vendor|html-preview)-[\w-]+\.js$/.test(w.file),
);
const unexpected = (report.warnings ?? []).filter((w) => !known.includes(w));
console.log(
  `web-ext: ${report.errors?.length ?? 0} errors, ${unexpected.length} unexpected warnings; ${known.length} documented React DOM / inert-template notices.`,
);
for (const item of [...(report.errors ?? []), ...unexpected])
  console.error(item);
if (report.errors?.length || unexpected.length || result.status !== 0)
  process.exit(1);
