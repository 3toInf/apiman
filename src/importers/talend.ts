import {
  newWorkspace,
  newRequest,
  pair,
  uid,
  type ImportReport,
  type Pair,
  type Assertion,
  type AssertionTarget,
  type Operator,
} from "../core/model";
import { talendUrl } from "./talend-url";
export function importTalend(data: any): ImportReport {
  if (data.version !== 6)
    throw new Error(
      `Unsupported Talend export version: ${data.version}. Version 6 is supported.`,
    );
  if (!Array.isArray(data.entities))
    throw new Error("Talend entities must be an array");
  const workspace = newWorkspace();
  const warnings: string[] = [];
  function pairs(items: any): Pair[] {
    if (items == null) return [];
    if (!Array.isArray(items)) throw new Error("Invalid Talend key/value list");
    return items.map((p: any) => ({
      ...pair(String(p.name ?? ""), String(p.value ?? "")),
      enabled: p.enabled !== false,
      ...(p.file
        ? { fileId: uid(), fileName: String(p.file.name ?? p.file) }
        : {}),
    }));
  }
  function walk(items: any[], parentId?: string) {
    for (const [order, item] of items.entries()) {
      const e = item.entity;
      if (!e || typeof e.type !== "string")
        throw new Error("Malformed Talend entity");
      const name = String(e.name ?? "Untitled");
      const id = String(e.id ?? uid());
      if (["Project", "Service", "Scenario"].includes(e.type)) {
        const kind = e.type.toLowerCase() as "project" | "service" | "scenario";
        workspace.nodes.push({ id, parentId, kind, name, order });
        if (!Array.isArray(item.children ?? []))
          throw new Error("Invalid Talend children");
        walk(item.children ?? [], id);
        if (kind === "scenario")
          workspace.scenarios.push({
            id,
            name,
            requestIds: workspace.requests
              .filter((r) => r.parentId === id)
              .sort((a, b) => a.order - b.order)
              .map((r) => r.id),
            stopOnFailure: true,
            repeat: 1,
            delayMs: 0,
          });
      } else if (e.type === "Request") {
        const r = newRequest(name, parentId);
        r.id = id;
        r.order = order;
        r.source = e;
        r.method = String(e.method?.name ?? e.method ?? "GET").toUpperCase();
        r.description = String(e.description ?? "");
        const u = e.uri;
        if (typeof u === "string") r.url = u;
        else if (u && typeof u === "object") {
          r.url = talendUrl(u);
          r.query = pairs(u.query?.items);
          if (u.query?.delimiter && u.query.delimiter !== "&")
            r.unsupported.push("Nonstandard query delimiter");
        } else throw new Error(`Missing URL in ${name}`);
        r.headers = pairs(e.headers);
        const b = e.body;
        if (b) {
          const type = String(b.bodyType ?? "None").toLowerCase();
          r.body.text = String(b.textBody ?? "");
          if (type === "text") {
            const ct =
              r.headers.find((h) => h.name.toLowerCase() === "content-type")
                ?.value ?? "";
            r.body.type = /json/i.test(ct)
              ? "json"
              : /xml/i.test(ct)
                ? "xml"
                : "text";
          } else if (type === "form") {
            r.body.type = /multipart/i.test(b.formBody?.encoding ?? "")
              ? "multipart"
              : "urlencoded";
            r.body.fields = pairs(b.formBody?.items);
          } else if (!["none", ""].includes(type)) {
            r.unsupported.push(`Body type ${b.bodyType} requires re-selection`);
          }
          if (["GET", "HEAD"].includes(r.method)) r.body.type = "none";
        }
        if (e.assertions) {
          if (!Array.isArray(e.assertions))
            r.unsupported.push("Unrecognized assertions structure");
          else
            for (const a of e.assertions) {
              const assertion = talendAssertion(a);
              if (assertion) r.assertions.push(assertion);
              else
                r.unsupported.push(
                  "Unrecognized assertion: " + JSON.stringify(a).slice(0, 150),
                );
            }
        }
        const understood = new Set([
          "id",
          "name",
          "type",
          "method",
          "uri",
          "headers",
          "body",
          "description",
          "assertions",
          "createdAt",
          "updatedAt",
        ]);
        for (const key of Object.keys(e))
          if (!understood.has(key)) {
            warnings.push(`${name}: preserved field ${key}`);
            if (
              /auth|script|test|expression|setting|timeout|redirect/i.test(key)
            )
              r.unsupported.push(`Unmapped execution field: ${key}`);
          }
        if (r.body.fields.some((p) => p.fileId))
          r.unsupported.push("Imported files must be selected again");
        for (const issue of r.unsupported) warnings.push(`${name}: ${issue}`);
        workspace.requests.push(r);
      } else warnings.push(`Unknown entity ${e.type}: not imported`);
    }
  }
  walk(data.entities);
  if (data.environments != null && !Array.isArray(data.environments))
    throw new Error("Invalid Talend environments");
  workspace.environments = (data.environments ?? []).map((e: any) => ({
    id: String(e.id ?? uid()),
    name: String(e.name ?? "Environment"),
    variables: Object.values(e.variables ?? {}).map((v: any) => ({
      ...pair(String(v.name ?? ""), String(v.value ?? "")),
      private: !!v.private,
      enabled: v.enabled !== false,
    })),
  }));
  workspace.activeEnvironmentId = workspace.environments[0]?.id;
  return { format: "Talend v6", workspace, warnings, errors: [] };
}
function talendAssertion(a: any): Assertion | undefined {
  const targets: Record<string, AssertionTarget> = {
    ResponseHeader: "header",
    ResponseJsonBody: "json",
    ResponseXmlBody: "xml",
    Request: "duration",
  };
  const operators: Record<string, Operator> = {
    Equals: "equals",
    DoesNotEqual: "notEquals",
    Exists: "exists",
    DoesNotExist: "notExists",
    Contains: "contains",
    DoesNotContain: "notContains",
    Matches: "matches",
    Less: "less",
    LessOrEqual: "lessOrEqual",
    Greater: "greater",
    GreateOrEqual: "greaterOrEqual",
    GreaterOrEqual: "greaterOrEqual",
    LengthEquals: "lengthEquals",
    LengthLessOrEqual: "lengthLessOrEqual",
    LengthGreaterOrEqual: "lengthGreaterOrEqual",
  };
  let target = targets[a.subject];
  if (a.subject === "ResponseStatus")
    target =
      a.path === "code"
        ? "status"
        : a.path === "message"
          ? "statusText"
          : (undefined as unknown as AssertionTarget);
  if (a.subject === "ResponseBody")
    target =
      a.path === "content"
        ? "body"
        : a.path === "length"
          ? "size"
          : (undefined as unknown as AssertionTarget);
  const operator = operators[a.comparison];
  if (!target || !operator) return;
  return {
    id: uid(),
    target,
    operator,
    selector: ["header", "json", "xml"].includes(target)
      ? String(a.path ?? "")
      : "",
    expected: String(a.value ?? ""),
    enabled: a.enabled !== false,
  };
}
