import { sha1, md5 } from "@noble/hashes/legacy.js";
import { sha224, sha256, sha384, sha512 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
const utf8 = (s: string) => new TextEncoder().encode(s);
const base64 = (a: Uint8Array) =>
  btoa(Array.from(a, (b) => String.fromCharCode(b)).join(""));
const hex = (a: Uint8Array) =>
  Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
import { query, type JsonValue } from "jsonpath-rfc9535";
import type { EvalContext, RequestDefinition } from "./model";

const blocked = new Set(["__proto__", "prototype", "constructor"]);
export function jsonSelect(value: unknown, path: string): unknown {
  const json = typeof value === "string" ? JSON.parse(value) : value;
  const result = query(json as JsonValue, path);
  return result.length === 1
    ? result[0]
    : result.length === 0
      ? undefined
      : result;
}
export function xmlSelect(value: unknown, path: string): unknown {
  const doc = new DOMParser().parseFromString(String(value), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid XML response");
  const result = doc.evaluate(path, doc, null, XPathResult.ANY_TYPE, null);
  if (result.resultType === XPathResult.STRING_TYPE) return result.stringValue;
  if (result.resultType === XPathResult.NUMBER_TYPE) return result.numberValue;
  if (result.resultType === XPathResult.BOOLEAN_TYPE)
    return result.booleanValue;
  const values: string[] = [];
  let node = result.iterateNext();
  while (node) {
    values.push(node.nodeValue ?? node.textContent ?? "");
    node = result.iterateNext();
  }
  return values.length === 1
    ? values[0]
    : values.length === 0
      ? undefined
      : values;
}
export const stringify = (value: unknown): string =>
  value == null
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
export function interpolate(
  input: string,
  ctx: EvalContext,
  stack: string[] = [],
): string {
  if (stack.length > 32) throw new Error("Expression nesting limit exceeded");
  let output = "",
    cursor = 0;
  while (cursor < input.length) {
    const start = input.indexOf("${", cursor);
    if (start < 0) return output + input.slice(cursor);
    output += input.slice(cursor, start);
    let end = start + 2,
      quote = "",
      escape = false;
    for (; end < input.length; end++) {
      const ch = input[end]!;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\" && quote) {
        escape = true;
        continue;
      }
      if (quote) {
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "}") break;
    }
    if (end === input.length) throw new Error("Unclosed expression");
    output += stringify(evaluate(input.slice(start + 2, end), ctx, stack));
    cursor = end + 1;
  }
  return output;
}
type Token = { type: "string" | "number" | "name" | "symbol"; value: string };
function tokenize(input: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let value = "";
      let closed = false;
      i++;
      while (i < input.length) {
        const ch = input[i++]!;
        if (ch === quote) {
          closed = true;
          break;
        }
        if (ch === "\\") {
          const e = input[i++]!;
          const map: Record<string, string> = { n: "\n", r: "\r", t: "\t" };
          if (e === "u") {
            const hex = input.slice(i, i + 4);
            if (!/^[\da-f]{4}$/i.test(hex))
              throw new Error("Invalid unicode escape");
            value += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else value += map[e] ?? e;
        } else value += ch;
      }
      if (!closed) throw new Error("Unclosed expression string");
      out.push({ type: "string", value });
      continue;
    }
    const num = input.slice(i).match(/^-?\d+(?:\.\d+)?/);
    if (num) {
      out.push({ type: "number", value: num[0] });
      i += num[0].length;
      continue;
    }
    const name = input.slice(i).match(/^[A-Za-z_][A-Za-z_0-9]*/);
    if (name) {
      out.push({ type: "name", value: name[0] });
      i += name[0].length;
      continue;
    }
    if ("().,".includes(c)) {
      out.push({ type: "symbol", value: c });
      i++;
      continue;
    }
    throw new Error(`Unsupported expression character: ${c}`);
  }
  return out;
}
type Ref = { refId: string; refType: "request" | "node" };
function isRef(v: unknown): v is Ref {
  return !!v && typeof v === "object" && "refId" in v && "refType" in v;
}
export function evaluate(
  input: string,
  ctx: EvalContext,
  stack: string[] = [],
): unknown {
  const tokens = tokenize(input);
  let pos = 0;
  const ref = referencePrefix(tokens, ctx);
  if (ref && ctx.referenceIds?.[ref.key])
    tokens.splice(0, ref.length, {
      type: "string",
      value: "@" + ctx.referenceIds[ref.key],
    });
  const peek = () => tokens[pos]?.value;
  const take = () => {
    const t = tokens[pos++];
    if (!t) throw new Error("Unexpected end of expression");
    return t;
  };
  function resolve(name: string): unknown {
    if (
      name.startsWith("@") &&
      ctx.requests.some((r) => r.id === name.slice(1))
    )
      return { refId: name.slice(1), refType: "request" };
    if (Object.hasOwn(ctx.variables, name)) {
      if (stack.includes(name))
        throw new Error(
          `Cyclic environment reference: ${[...stack, name].join(" → ")}`,
        );
      return interpolate(ctx.variables[name]!, ctx, [...stack, name]);
    }
    const requests = ctx.requests.filter((r) => r.name === name);
    const nodes = (ctx.nodes ?? []).filter((n) => n.name === name);
    if (requests.length + nodes.length > 1)
      throw new Error(
        `Ambiguous reference: ${name}. Use its full project path.`,
      );
    if (requests[0]) return { refId: requests[0].id, refType: "request" };
    if (nodes[0]) return { refId: nodes[0].id, refType: "node" };
    return name;
  }
  function property(value: unknown, key: string): unknown {
    if (blocked.has(key)) throw new Error("Unsafe expression property");
    if (isRef(value)) {
      if (value.refType === "node") {
        const candidates = [
          ...ctx.requests
            .filter((r) => r.parentId === value.refId && r.name === key)
            .map((r) => ({ refId: r.id, refType: "request" as const })),
          ...(ctx.nodes ?? [])
            .filter((n) => n.parentId === value.refId && n.name === key)
            .map((n) => ({ refId: n.id, refType: "node" as const })),
        ];
        if (candidates.length !== 1)
          throw new Error(`Missing or ambiguous request: ${key}`);
        return candidates[0];
      }
      const r = ctx.requests.find((r) => r.id === value.refId)!;
      if (key === "response") {
        const result = ctx.responses[r.id];
        if (!result?.completed)
          throw new Error(`No current response for ${r.name}. Run it first.`);
        return {
          body: result.body,
          headers: Object.fromEntries(result.headers),
          status: result.status,
          statusCode: result.status,
          statusText: result.statusText,
          duration: result.durationMs,
        };
      }
      if (key === "request") {
        const sent = ctx.responses[r.id];
        const compiled =
          ctx.compiled?.[r.id] ??
          (sent
            ? {
                url: sent.url,
                body: sent.requestBody ?? "",
                headers: sent.requestHeaders ?? [],
              }
            : undefined);
        return {
          url: compiled?.url ?? r.url,
          uri: compiled?.url ?? r.url,
          method: r.method,
          body: compiled?.body ?? r.body.text,
          headers: Object.fromEntries(
            compiled?.headers ??
              r.headers.filter((h) => h.enabled).map((h) => [h.name, h.value]),
          ),
        };
      }
      throw new Error(`Expected request or response after ${r.name}`);
    }
    let object = value;
    if (typeof object === "string") {
      try {
        object = JSON.parse(object);
      } catch {
        /* Plain string properties are intentionally unavailable. */
      }
    }
    if (object != null && typeof object === "object") {
      if (Object.hasOwn(object, key))
        return (object as Record<string, unknown>)[key];
      const match = Object.keys(object).find(
        (k) => k.toLowerCase() === key.toLowerCase(),
      );
      if (match) return (object as Record<string, unknown>)[match];
    }
    throw new Error(`Missing expression property: ${key}`);
  }
  function args(): unknown[] {
    take();
    const result: unknown[] = [];
    while (peek() !== ")") {
      result.push(expr(false));
      if (peek() === ",") {
        take();
        continue;
      }
      if (peek() !== ")")
        throw new Error("Expected comma or closing parenthesis");
    }
    take();
    return result;
  }
  function expr(root: boolean): unknown {
    const token = take();
    let value: unknown;
    if (token.type === "name" && peek() === "(")
      value = call(token.value, undefined, args());
    else if (token.type === "string")
      value = root ? resolve(token.value) : token.value;
    else if (token.type === "number") value = Number(token.value);
    else if (token.value === "true" || token.value === "false")
      value = token.value === "true";
    else throw new Error(`Unsupported expression: ${token.value}`);
    while (peek() === ".") {
      take();
      const key = take();
      if (blocked.has(key.value)) throw new Error("Unsafe expression property");
      value =
        peek() === "("
          ? call(key.value, value, args())
          : property(value, key.value);
    }
    return value;
  }
  const result = expr(true);
  if (pos !== tokens.length) throw new Error("Unexpected expression tokens");
  if (isRef(result)) throw new Error("Select a request or response field");
  return result;
}
function call(name: string, value: unknown, a: unknown[]): unknown {
  const text = stringify(value);
  const arg = (i: number) => stringify(a[i]);
  switch (name) {
    case "timestamp":
      return Date.now();
    case "uuid":
      return crypto.randomUUID();
    case "random": {
      const max = Number(a[0] ?? 1000000000);
      if (!(max > 0)) throw new Error("random max must be positive");
      return Math.floor(Math.random() * max);
    }
    case "randomString": {
      const length = Number(a[0] ?? 10);
      if (!Number.isInteger(length) || length < 0 || length > 10000)
        throw new Error("Invalid randomString length");
      const alphabet =
        (a[1] !== false ? "abcdefghijklmnopqrstuvwxyz" : "") +
        (a[2] !== false ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ" : "") +
        (a[3] !== false ? "0123456789" : "");
      if (!alphabet) throw new Error("Select a character set");
      return Array.from(
        crypto.getRandomValues(new Uint32Array(length)),
        (n) => alphabet[n % alphabet.length],
      ).join("");
    }
    case "base64":
      return base64(utf8(text));
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "length": {
      let parsed = value;
      if (typeof value === "string") {
        try {
          parsed = JSON.parse(value);
        } catch {
          /* plain text */
        }
      }
      return parsed && typeof parsed === "object"
        ? Object.keys(parsed).length
        : text.length;
    }
    case "substring":
      return text.substring(
        Number(a[0] ?? 0),
        a[1] === undefined ? undefined : Number(a[1]),
      );
    case "jsonPath":
      return jsonSelect(value, arg(0));
    case "xPath":
      return xmlSelect(value, arg(0));
    case "md5":
      return hex(md5(utf8(text)));
    case "sha":
    case "hmac": {
      const algorithm = arg(0).replace(/-/g, "").toUpperCase();
      const allowed = ["SHA1", "SHA224", "SHA256", "SHA384", "SHA512"];
      if (!allowed.includes(algorithm))
        throw new Error("Unsupported hash algorithm");
      const hashes = {
        SHA1: sha1,
        SHA224: sha224,
        SHA256: sha256,
        SHA384: sha384,
        SHA512: sha512,
      };
      const fn = hashes[algorithm as keyof typeof hashes];
      const hash =
        name === "hmac" ? hmac(fn, utf8(arg(1)), utf8(text)) : fn(utf8(text));
      return (name === "hmac" ? arg(2) : arg(1)).toLowerCase() === "base64"
        ? base64(hash)
        : hex(hash);
    }
    case "string": {
      const quote = arg(0) || '"';
      return (
        quote +
        text.replaceAll("\\", "\\\\").replaceAll(quote, "\\" + quote) +
        quote
      );
    }
    case "math": {
      const l = Number(value),
        r = Number(a[1]);
      if (!Number.isFinite(l) || !Number.isFinite(r))
        throw new Error("math requires numbers");
      switch (arg(0).toUpperCase()) {
        case "ADD":
          return l + r;
        case "SUBTRACT":
          return l - r;
        case "MULTIPLY":
          return l * r;
        case "DIVIDE":
          if (!r) throw new Error("Division by zero");
          return l / r;
      }
      throw new Error("Unsupported math operation");
    }
    case "addTime": {
      const d = new Date(Number(value));
      const count = Number(a[1]);
      if (arg(0) === "YEAR") d.setUTCFullYear(d.getUTCFullYear() + count);
      else if (arg(0) === "MONTH") d.setUTCMonth(d.getUTCMonth() + count);
      else {
        const unit: Record<string, number> = {
          WEEK: 604800000,
          DAY: 86400000,
          HOUR: 3600000,
          MINUTE: 60000,
          SECOND: 1000,
        };
        if (!unit[arg(0)]) throw new Error("Unsupported time unit");
        d.setTime(d.getTime() + count * unit[arg(0)]!);
      }
      return d.getTime();
    }
    case "formatDate": {
      const d = new Date(arg(0) === "TIMESTAMP" ? Number(value) : text);
      if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
      return arg(1) === "TIMESTAMP" ? d.getTime() : d.toISOString();
    }
    default:
      throw new Error(`Unsupported function: ${name}`);
  }
}
export function requestPath(r: RequestDefinition, ctx: EvalContext): string {
  const path = [r.name];
  let parent = r.parentId;
  const seen = new Set<string>();
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    const n = ctx.nodes?.find((x) => x.id === parent);
    if (!n) break;
    path.unshift(n.name);
    parent = n.parentId;
  }
  return path.map((s) => JSON.stringify(s)).join(".");
}

function referencePrefix(
  tokens: Token[],
  ctx: EvalContext,
): { key: string; length: number; id?: string } | undefined {
  const names: string[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const t = tokens[i];
    if (t?.type !== "string") break;
    if (i > 0 && ["request", "response"].includes(t.value)) {
      const key = names.map((s) => JSON.stringify(s)).join(".");
      const candidates = ctx.requests.filter(
        (r) =>
          requestPath(r, ctx) === key ||
          (names.length === 1 && r.name === names[0]),
      );
      if (ctx.referenceIds?.[key] || candidates.length === 1)
        return { key, length: i - 1, id: candidates[0]?.id };
    }
    names.push(t.value);
    if (tokens[i + 1]?.value !== ".") break;
  }
}
export function bindRequestReferences(
  request: RequestDefinition,
  ctx: EvalContext,
): RequestDefinition {
  const referenceIds = { ...request.referenceIds };
  const strings: string[] = [];
  function visit(value: unknown) {
    if (typeof value === "string") strings.push(value);
    else if (value && typeof value === "object")
      for (const [k, v] of Object.entries(value))
        if (!["source", "referenceIds"].includes(k)) visit(v);
  }
  visit(request);
  for (const s of strings)
    for (const match of s.matchAll(/\$\{([\s\S]*?)\}/g)) {
      try {
        const ref = referencePrefix(tokenize(match[1]!), {
          ...ctx,
          referenceIds,
        });
        if (ref?.id && !referenceIds[ref.key]) referenceIds[ref.key] = ref.id;
      } catch {
        /* The evaluator reports malformed expressions at execution time. */
      }
    }
  return { ...request, referenceIds };
}
