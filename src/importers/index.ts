import { bindRequestReferences, interpolate } from "../core/expressions";
import { environmentContext } from "../core/model";
import { parse } from "yaml";
import { validateWorkspace } from "../core/schema";
import type { ImportReport, Workspace } from "../core/model";
import { importTalend } from "./talend";
import {
  importPostman,
  importHar,
  importOpenApi,
  importCurl,
} from "./portable";
export { exportCurl } from "./portable";
export function importDocument(text: string): ImportReport {
  if (text.length > 50 * 1024 * 1024) throw new Error("Import exceeds 50 MiB");
  if (text.trimStart().startsWith("curl ")) return importCurl(text.trim());
  let d: any;
  try {
    d = JSON.parse(text);
  } catch {
    try {
      d = parse(text, { maxAliasCount: 50 });
    } catch {
      throw new Error("Not valid JSON, YAML or curl");
    }
  }
  if (!d || typeof d !== "object") throw new Error("Invalid import document");
  let report: ImportReport;
  if (d.format === "apiman") {
    report = {
      format: "apiman",
      workspace: validateWorkspace(d),
      warnings: [],
      errors: [],
    };
  } else if (d.entities && d.version !== undefined) report = importTalend(d);
  else if (d.info && Array.isArray(d.item)) report = importPostman(d);
  else if (d.log?.version === "1.2" && Array.isArray(d.log.entries))
    report = importHar(d);
  else if (
    (String(d.openapi ?? "").startsWith("3.") || d.swagger === "2.0") &&
    d.paths
  )
    report = importOpenApi(d);
  else
    throw new Error(
      "Unrecognized format. Use Talend v6, apiman, Postman v2, OpenAPI, HAR 1.2 or curl.",
    );
  report.workspace = validateWorkspace(report.workspace);
  const ctx = environmentContext(report.workspace);
  report.workspace.requests = report.workspace.requests.map((r) =>
    bindRequestReferences(r, ctx),
  );
  return report;
}
export function sensitiveValues(w: Workspace): string[] {
  return [
    ...w.environments.flatMap((e) =>
      e.variables
        .filter((v) => v.private)
        .flatMap((v) => {
          try {
            return [
              v.value,
              interpolate(
                v.value,
                environmentContext({ ...w, activeEnvironmentId: e.id }),
              ),
            ];
          } catch {
            return [v.value];
          }
        }),
    ),
    ...w.requests.flatMap((r) => [
      r.auth.password ?? "",
      r.auth.token ?? "",
      r.auth.value ?? "",
      ...r.headers
        .filter((h) =>
          /^(authorization|proxy-authorization|cookie|x-api-key|api-key)$/i.test(
            h.name,
          ),
        )
        .map((h) => h.value),
    ]),
  ]
    .flatMap((value) => {
      try {
        return [value, interpolate(value, environmentContext(w))];
      } catch {
        return [value];
      }
    })
    .filter((v) => v && !v.includes("${"));
}
export function redactTree<T>(value: T, secrets: string[]): T {
  const structural = new Set([
    "id",
    "requestId",
    "parentId",
    "name",
    "format",
    "schemaVersion",
    "type",
    "target",
    "operator",
    "method",
    "fileId",
    "activeEnvironmentId",
    "referenceIds",
    "requestIds",
  ]);
  function mask(text: string) {
    return text
      .split(/(\$\{[^}]*\})/g)
      .map((part) => {
        if (part.startsWith("${")) return part;
        let s = part;
        for (const secret of secrets
          .filter(Boolean)
          .sort((a, b) => b.length - a.length)) {
          if (secret.length >= 4)
            s = s
              .replaceAll(secret, "••••")
              .replaceAll(encodeURIComponent(secret), "••••");
          else {
            const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            s = s.replace(
              new RegExp(
                "(?<![a-zA-Z0-9_])" + escaped + "(?![a-zA-Z0-9_])",
                "g",
              ),
              "••••",
            );
          }
        }
        return s;
      })
      .join("");
  }
  function visit(v: any, key = "", payload = false): any {
    payload ||= key === "actual" || key === "expected";
    if (!payload && structural.has(key)) return v;
    if (typeof v === "string") return mask(v);
    if (Array.isArray(v)) return v.map((x) => visit(x, "", payload));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v))
        if (k !== "source") out[k] = visit(x, k, payload);
      return out;
    }
    return v;
  }
  return visit(value);
}
export function exportWorkspace(
  w: Workspace,
  options: { includeSecrets?: boolean; includeAttachments?: boolean } = {},
): string {
  let copy = structuredClone(w);
  if (!options.includeSecrets) {
    copy = redactTree(copy, sensitiveValues(w));
    for (const e of copy.environments)
      for (const v of e.variables) if (v.private) v.value = "";
    for (const r of copy.requests) {
      if (r.auth.password) r.auth.password = "";
      if (r.auth.token) r.auth.token = "";
      if (r.auth.value) r.auth.value = "";
      for (const h of r.headers)
        if (
          /^(authorization|proxy-authorization|cookie|x-api-key|api-key)$/i.test(
            h.name,
          )
        )
          h.value = "";
    }
  }
  if (!options.includeAttachments) delete copy.attachments;
  return JSON.stringify(copy, null, 2);
}

/** Include dependency and ancestor closure so a scoped backup is independently importable. */
export function exportScope(w: Workspace, rootId: string): Workspace {
  const nodeIds = new Set([rootId]),
    requestIds = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of w.nodes)
      if (n.parentId && nodeIds.has(n.parentId) && !nodeIds.has(n.id)) {
        nodeIds.add(n.id);
        changed = true;
      }
  }
  for (const r of w.requests)
    if (r.id === rootId || (r.parentId && nodeIds.has(r.parentId)))
      requestIds.add(r.id);
  for (const s of w.scenarios)
    if (nodeIds.has(s.id)) for (const id of s.requestIds) requestIds.add(id);
  changed = true;
  while (changed) {
    changed = false;
    for (const r of w.requests)
      if (requestIds.has(r.id))
        for (const id of Object.values(r.referenceIds ?? {}))
          if (!requestIds.has(id)) {
            requestIds.add(id);
            changed = true;
          }
  }
  const includeParents = (parentId: string | undefined) => {
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      nodeIds.add(parentId);
      parentId = w.nodes.find((n) => n.id === parentId)?.parentId;
    }
  };
  for (const r of w.requests)
    if (requestIds.has(r.id)) includeParents(r.parentId);
  for (const n of w.nodes) if (nodeIds.has(n.id)) includeParents(n.parentId);
  return {
    ...w,
    nodes: w.nodes.filter((n) => nodeIds.has(n.id)),
    requests: w.requests.filter((r) => requestIds.has(r.id)),
    scenarios: w.scenarios
      .filter((s) => nodeIds.has(s.id))
      .map((s) => ({
        ...s,
        requestIds: s.requestIds.filter((id) => requestIds.has(id)),
      })),
  };
}
