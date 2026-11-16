import {
  newWorkspace,
  newRequest,
  pair,
  uid,
  type Workspace,
  type RequestDefinition,
  type ImportReport,
  type Pair,
} from "../core/model";
const template = (s: unknown) =>
  String(s ?? "").replace(
    /\{\{([^}]+)\}\}/g,
    (_, name) => "${" + JSON.stringify(name) + "}",
  );
const pairs = (items: any[]): Pair[] =>
  (items ?? []).map((p) => ({
    ...pair(template(p.key ?? p.name), template(p.value)),
    enabled: !p.disabled,
  }));
function root(name: string): Workspace {
  const w = newWorkspace();
  w.nodes.push({ id: uid(), kind: "project", name, order: 0 });
  return w;
}
function auth(a: any, r: RequestDefinition) {
  if (!a || a.type === "noauth") return;
  const fields = Object.fromEntries(
    (a[a.type] ?? []).map((x: any) => [x.key, template(x.value)]),
  );
  switch (a.type) {
    case "basic":
      r.auth = {
        type: "basic",
        username: fields.username ?? "",
        password: fields.password ?? "",
      };
      break;
    case "bearer":
      r.auth = { type: "bearer", token: fields.token ?? "" };
      break;
    case "apikey":
      r.auth = {
        type: "apikey",
        name: fields.key ?? "",
        value: fields.value ?? "",
        location: fields.in === "query" ? "query" : "header",
      };
      break;
    default:
      r.unsupported.push("Unsupported authentication: " + a.type);
  }
}
export function importPostman(d: any): ImportReport {
  const w = root(d.info?.name ?? "Postman");
  const warnings: string[] = [];
  const variables = new Map<string, any>();
  for (const v of d.variable ?? [])
    variables.set(v.key, {
      ...pair(v.key, template(v.value)),
      private: v.type === "secret",
      enabled: !v.disabled,
    });
  function visit(
    items: any[],
    parentId: string,
    inheritedAuth: any,
    inheritedEvents: any[],
  ) {
    for (const item of items) {
      const events = [...inheritedEvents, ...(item.event ?? [])];
      if (item.item) {
        const id = uid();
        w.nodes.push({
          id,
          parentId,
          kind: "service",
          name: item.name ?? "Folder",
          order: w.nodes.length,
        });
        visit(item.item, id, item.auth ?? inheritedAuth, events);
        continue;
      }
      const source =
        typeof item.request === "string" ? { url: item.request } : item.request;
      if (!source) continue;
      const r = newRequest(item.name ?? "Request", parentId);
      r.method = source.method ?? "GET";
      r.source = item;
      const u = source.url;
      r.url = template(
        typeof u === "string"
          ? u
          : (u?.raw ??
              `${u?.protocol ?? "https"}://${(u?.host ?? []).join(".")}/${(u?.path ?? []).join("/")}`),
      );
      if (u && typeof u === "object" && u.query) {
        r.url = r.url.split("?")[0]!;
        r.query = pairs(u.query);
      }
      for (const v of u?.variable ?? []) {
        variables.set(v.key, {
          ...pair(v.key, template(v.value)),
          private: false,
        });
        r.url = r.url.replace(":" + v.key, "${" + JSON.stringify(v.key) + "}");
      }
      r.headers = pairs(source.header);
      r.description =
        typeof source.description === "string"
          ? source.description
          : (source.description?.content ?? "");
      auth(source.auth ?? inheritedAuth, r);
      const b = source.body;
      if (b) {
        if (b.mode === "raw") {
          r.body.type =
            b.options?.raw?.language === "json"
              ? "json"
              : b.options?.raw?.language === "xml"
                ? "xml"
                : "text";
          r.body.text = template(b.raw);
        } else if (b.mode === "urlencoded") {
          r.body.type = "urlencoded";
          r.body.fields = pairs(b.urlencoded);
        } else if (b.mode === "formdata") {
          r.body.type = "multipart";
          r.body.fields = pairs(b.formdata);
          for (const [i, f] of (b.formdata ?? []).entries())
            if (f.type === "file") {
              r.body.fields[i]!.fileId = uid();
              r.body.fields[i]!.fileName = String(f.src ?? "file");
            }
        } else if (b.mode === "file") {
          r.body.type = "binary";
          r.body.fileId = uid();
          r.body.fileName = String(b.file?.src ?? "file");
        } else if (b.mode) r.unsupported.push("Unsupported body: " + b.mode);
      }
      if (events.length)
        r.unsupported.push(
          "Postman scripts are preserved but are not executed",
        );
      warnings.push(...r.unsupported.map((x) => `${r.name}: ${x}`));
      w.requests.push(r);
    }
  }
  visit(d.item, w.nodes[0]!.id, d.auth, d.event ?? []);
  if (variables.size) {
    const id = uid();
    w.environments.push({
      id,
      name: "Imported variables",
      variables: [...variables.values()],
    });
    w.activeEnvironmentId = id;
  }
  return { format: "Postman", workspace: w, warnings, errors: [] };
}
export function importHar(d: any): ImportReport {
  const w = root("HAR import");
  for (const e of d.log.entries) {
    const q = e.request;
    if (!q) continue;
    const r = newRequest(q.url, w.nodes[0]!.id);
    r.url = q.url;
    r.method = q.method ?? "GET";
    r.headers = pairs(q.headers);
    r.headers = r.headers.filter(
      (p) =>
        ![
          "host",
          "content-length",
          "connection",
          "accept-encoding",
          "cookie",
          "user-agent",
        ].includes(p.name.toLowerCase()),
    );
    if (q.postData) {
      r.body.type = q.postData.mimeType?.includes("json") ? "json" : "text";
      r.body.text = q.postData.text ?? "";
      if (q.postData.params) {
        r.body.type = q.postData.mimeType?.includes("multipart")
          ? "multipart"
          : "urlencoded";
        r.body.fields = pairs(q.postData.params);
      }
    }
    w.requests.push(r);
  }
  return {
    format: "HAR 1.2",
    workspace: w,
    warnings: [
      "Browser-managed headers from HAR are omitted; cookies use the current browser session.",
    ],
    errors: [],
  };
}
export function importOpenApi(d: any): ImportReport {
  const w = root(d.info?.title ?? "OpenAPI");
  const warnings: string[] = [];
  const vars: Pair[] = [];
  const server = d.servers?.[0];
  let base =
    server?.url ??
    `${d.schemes?.[0] ?? "https"}://${d.host ?? "example.test"}${d.basePath ?? ""}`;
  for (const [key, v] of Object.entries(server?.variables ?? {})) {
    base = base.replaceAll("{" + key + "}", "${" + JSON.stringify(key) + "}");
    vars.push(pair(key, String((v as any).default ?? "")));
  }
  function deref(obj: any, seen = new Set<string>()): any {
    if (!obj?.$ref) return obj;
    const ref = obj.$ref;
    if (!ref.startsWith("#/"))
      throw new Error("External $ref requires a bundled OpenAPI document");
    if (seen.has(ref)) throw new Error("Cyclic OpenAPI reference");
    const resolved = ref
      .slice(2)
      .split("/")
      .reduce(
        (v: any, k: string) =>
          v?.[k.replaceAll("~1", "/").replaceAll("~0", "~")],
        d,
      );
    if (!resolved) throw new Error("Unresolved OpenAPI reference: " + ref);
    return deref(resolved, new Set([...seen, ref]));
  }
  for (const [path, raw] of Object.entries(d.paths ?? {})) {
    const item = deref(raw);
    const serviceId = uid();
    w.nodes.push({
      id: serviceId,
      parentId: w.nodes[0]!.id,
      kind: "service",
      name: path,
      order: w.nodes.length,
    });
    for (const method of [
      "get",
      "post",
      "put",
      "patch",
      "delete",
      "head",
      "options",
    ]) {
      const op = item[method];
      if (!op) continue;
      const r = newRequest(
        op.summary ?? op.operationId ?? `${method.toUpperCase()} ${path}`,
        serviceId,
      );
      r.method = method.toUpperCase();
      r.description = op.description ?? "";
      r.url =
        base.replace(/\/$/, "") +
        path.replace(
          /\{([^}]+)\}/g,
          (_, name) => "${" + JSON.stringify(name) + "}",
        );
      for (const p0 of [...(item.parameters ?? []), ...(op.parameters ?? [])]) {
        const p = deref(p0);
        const value = String(p.example ?? p.schema?.default ?? p.default ?? "");
        if (p.in === "path") {
          if (!vars.some((v) => v.name === p.name))
            vars.push(pair(p.name, value));
        } else if (p.in === "header") r.headers.push(pair(p.name, value));
        else if (p.in === "query")
          r.query.push({ ...pair(p.name, value), enabled: !!p.required });
        else if (p.in === "body") {
          r.body.type = "json";
          r.body.text = JSON.stringify(p.schema?.example ?? {}, null, 2);
        }
      }
      const rb = deref(op.requestBody);
      const content = rb?.content;
      const media = content ? Object.keys(content)[0] : undefined;
      if (media) {
        const sample =
          content[media].example ?? content[media].schema?.example ?? {};
        r.body.type = media.includes("json")
          ? "json"
          : media.includes("xml")
            ? "xml"
            : "text";
        r.body.text =
          typeof sample === "string" ? sample : JSON.stringify(sample, null, 2);
        r.headers.push(pair("Content-Type", media));
      }
      const security = op.security ?? d.security;
      if (security?.length) {
        const choice = security[0];
        const names = Object.keys(choice);
        if (names.length > 1)
          r.unsupported.push(
            "Combined OpenAPI authentication requires manual configuration",
          );
        for (const name of names) {
          const s =
            d.components?.securitySchemes?.[name] ??
            d.securityDefinitions?.[name];
          if (s?.type === "http" && s.scheme === "bearer")
            r.auth = { type: "bearer", token: "" };
          else if (s?.type === "basic" || s?.scheme === "basic")
            r.auth = { type: "basic", username: "", password: "" };
          else if (s?.type === "apiKey" && ["query", "header"].includes(s.in))
            r.auth = {
              type: "apikey",
              name: s.name,
              value: "",
              location: s.in,
            };
          else r.unsupported.push("Configure authentication for " + name);
        }
      }
      warnings.push(...r.unsupported.map((x) => r.name + ": " + x));
      w.requests.push(r);
    }
  }
  if (vars.length) {
    const id = uid();
    w.environments.push({
      id,
      name: "API variables",
      variables: vars.map((v) => ({ ...v, private: false })),
    });
    w.activeEnvironmentId = id;
  }
  warnings.push(
    "Examples are imported as request drafts; schema-based payload generation and non-default parameter serialization need manual review.",
  );
  return { format: "OpenAPI", workspace: w, warnings, errors: [] };
}
function shellTokens(text: string): string[] {
  const tokens: string[] = [];
  let value = "",
    quote = "",
    active = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "\\" && quote !== "'") {
      const n = text[++i];
      if (n === "\n") continue;
      if (n) value += n;
      active = true;
      continue;
    }
    if (quote) {
      if (c === quote) quote = "";
      else value += c;
      active = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      active = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (active) {
        tokens.push(value);
        value = "";
        active = false;
      }
      continue;
    }
    if (";&|<>`".includes(c) || (c === "$" && text[i + 1] === "("))
      throw new Error("Shell execution syntax is not supported");
    value += c;
    active = true;
  }
  if (quote) throw new Error("Unclosed curl quote");
  if (active) tokens.push(value);
  return tokens;
}
export function importCurl(text: string): ImportReport {
  const tokens = shellTokens(text);
  if (tokens.shift() !== "curl") throw new Error("Expected curl command");
  const w = root("cURL import");
  const r = newRequest("Imported request", w.nodes[0]!.id);
  let explicit = false;
  const unsupported: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const arg = () => {
      const v = tokens[++i];
      if (v === undefined) throw new Error("Missing curl argument: " + t);
      return v;
    };
    if (["-X", "--request"].includes(t)) {
      r.method = arg().toUpperCase();
      explicit = true;
    } else if (["-H", "--header"].includes(t)) {
      const h = arg();
      const colon = h.indexOf(":");
      if (colon < 0) throw new Error("Invalid curl header");
      r.headers.push(pair(h.slice(0, colon), h.slice(colon + 1).trim()));
    } else if (
      [
        "-d",
        "--data",
        "--data-raw",
        "--data-binary",
        "--data-urlencode",
      ].includes(t)
    ) {
      const value = arg();
      if (value.startsWith("@") && t !== "--data-raw") {
        r.unsupported.push("Select the local file referenced by curl");
        r.body.type = "binary";
        r.body.fileId = uid();
        r.body.fileName = value.slice(1);
      } else {
        r.body.type = "text";
        r.body.text +=
          (r.body.text ? "&" : "") +
          (t === "--data-urlencode"
            ? value.split("=").map(encodeURIComponent).join("=")
            : value);
      }
      if (!explicit) r.method = "POST";
    } else if (["-F", "--form"].includes(t)) {
      const value = arg();
      const [name, ...rest] = value.split("=");
      const v = rest.join("=");
      r.body.type = "multipart";
      r.body.fields.push({
        ...pair(name, v),
        ...(v.startsWith("@") ? { fileId: uid(), fileName: v.slice(1) } : {}),
      });
      if (!explicit) r.method = "POST";
    } else if (["-u", "--user"].includes(t)) {
      const value = arg();
      const colon = value.indexOf(":");
      r.auth = {
        type: "basic",
        username: colon < 0 ? value : value.slice(0, colon),
        password: colon < 0 ? "" : value.slice(colon + 1),
      };
    } else if (t === "--url") r.url = arg();
    else if (t === "-I" || t === "--head") {
      r.method = "HEAD";
      explicit = true;
    } else if (
      [
        "-s",
        "--silent",
        "-S",
        "--show-error",
        "-L",
        "--location",
        "--compressed",
        "-i",
        "--include",
        "-v",
        "--verbose",
      ].includes(t)
    ) {
      /* presentation or browser default */
    } else if (t === "--max-time") {
      r.timeoutMs = Number(arg()) * 1000;
    } else if (t.startsWith("-")) unsupported.push(t);
    else if (!r.url) r.url = t;
    else unsupported.push(t);
  }
  if (!r.url) throw new Error("curl URL missing");
  if (unsupported.length)
    r.unsupported.push("Unsupported curl options: " + unsupported.join(" "));
  w.requests.push(r);
  return { format: "cURL", workspace: w, warnings: r.unsupported, errors: [] };
}
export function exportCurl(r: RequestDefinition): string {
  const q = (v: string) => "'" + v.replaceAll("'", "'\\''") + "'";
  let url = r.url;
  const queryRows = [...r.query];
  if (r.auth.type === "apikey" && r.auth.location === "query")
    queryRows.push(pair(r.auth.name ?? "", r.auth.value ?? ""));
  const query = queryRows
    .filter((p) => p.enabled && p.name)
    .map((p) => encodeURIComponent(p.name) + "=" + encodeURIComponent(p.value))
    .join("&");
  if (query) url += (url.includes("?") ? "&" : "?") + query;
  const args = ["curl", "--request", r.method, q(url)];
  if (r.auth.type === "apikey" && r.auth.location !== "query")
    args.push("--header", q((r.auth.name ?? "") + ": " + (r.auth.value ?? "")));
  if (
    !r.headers.some(
      (h) => h.enabled && h.name.toLowerCase() === "content-type",
    ) &&
    ["json", "xml", "text", "urlencoded"].includes(r.body.type)
  ) {
    const types: Record<string, string> = {
      json: "application/json",
      xml: "application/xml",
      text: "text/plain;charset=UTF-8",
      urlencoded: "application/x-www-form-urlencoded;charset=UTF-8",
    };
    args.push("--header", q("Content-Type: " + types[r.body.type]));
  }
  for (const h of r.headers.filter((p) => p.enabled && p.name))
    args.push("--header", q(h.name + ": " + h.value));
  if (r.auth.type === "basic")
    args.push(
      "--user",
      q((r.auth.username ?? "") + ":" + (r.auth.password ?? "")),
    );
  if (r.auth.type === "bearer")
    args.push("--header", q("Authorization: Bearer " + (r.auth.token ?? "")));
  if (["text", "json", "xml"].includes(r.body.type))
    args.push("--data-raw", q(r.body.text));
  if (r.body.type === "urlencoded")
    for (const p of r.body.fields.filter((x) => x.enabled && x.name))
      args.push("--data-urlencode", q(p.name + "=" + p.value));
  if (r.body.type === "multipart")
    for (const p of r.body.fields.filter((x) => x.enabled && x.name))
      args.push(
        "--form",
        q(p.name + "=" + (p.fileId ? "@" + p.fileName : p.value)),
      );
  if (r.body.type === "binary")
    args.push("--data-binary", q("@" + (r.body.fileName ?? "file")));
  return args.join(" ");
}
