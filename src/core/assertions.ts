import safeRegex from "safe-regex2";
import { interpolate, jsonSelect, xmlSelect } from "./expressions";
import type {
  Assertion,
  AssertionResult,
  EvalContext,
  ExecutionResult,
} from "./model";
const parse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
};
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ak = Object.keys(a),
    bk = Object.keys(b);
  return (
    ak.length === bk.length &&
    ak.every(
      (k) =>
        Object.hasOwn(b, k) &&
        deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  );
}
function length(v: unknown): number {
  if (typeof v === "string" || Array.isArray(v)) return v.length;
  if (v && typeof v === "object") return Object.keys(v).length;
  throw new Error("Value has no length");
}
function contains(a: unknown, b: unknown): boolean {
  if (typeof a === "string") return a.includes(String(b));
  if (Array.isArray(a))
    return (Array.isArray(b) ? b : [b]).every((v) =>
      a.some((x) => deepEqual(x, v)),
    );
  if (a && typeof a === "object")
    return (Array.isArray(b) ? b : [b]).every((k) =>
      Object.hasOwn(a, String(k)),
    );
  throw new Error("Value cannot contain items");
}
export function evaluateAssertions(
  assertions: Assertion[],
  r: ExecutionResult,
  ctx: EvalContext,
  deferRegex = false,
): AssertionResult[] {
  return assertions
    .filter((a) => a.enabled)
    .map((a) => {
      let actual: unknown, expected: unknown;
      try {
        if (!r.completed || r.truncated)
          throw new Error("A complete response is required");
        const selector = interpolate(a.selector, ctx);
        switch (a.target) {
          case "status":
            actual = r.status;
            break;
          case "statusText":
            actual = r.statusText;
            break;
          case "header":
            actual = r.headers.find(
              ([k]) => k?.toLowerCase() === selector.toLowerCase(),
            )?.[1];
            break;
          case "size":
            actual = r.size;
            break;
          case "duration":
            actual = r.durationMs;
            break;
          case "body":
            actual = r.body;
            break;
          case "json":
            actual = jsonSelect(r.body, selector);
            break;
          case "xml":
            actual = xmlSelect(r.body, selector);
            break;
        }
        const raw = interpolate(a.expected, ctx);
        expected =
          ["status", "size", "duration", "json"].includes(a.target) ||
          a.operator.startsWith("length")
            ? parse(raw)
            : raw;
        let passed = false;
        const comparable = (v: unknown) =>
          typeof v === "number"
            ? v
            : typeof v === "string"
              ? v.length
              : v == null
                ? NaN
                : JSON.stringify(v);
        switch (a.operator) {
          case "equals":
            passed = deepEqual(actual, expected);
            break;
          case "notEquals":
            passed = !deepEqual(actual, expected);
            break;
          case "exists":
            passed = actual !== undefined && actual !== null;
            break;
          case "notExists":
            passed = actual === undefined || actual === null;
            break;
          case "greater":
            passed = comparable(actual) > comparable(expected);
            break;
          case "greaterOrEqual":
            passed = comparable(actual) >= comparable(expected);
            break;
          case "less":
            passed = comparable(actual) < comparable(expected);
            break;
          case "lessOrEqual":
            passed = comparable(actual) <= comparable(expected);
            break;
          case "contains":
            passed = contains(actual, expected);
            break;
          case "notContains":
            passed = !contains(actual, expected);
            break;
          case "lengthEquals":
            passed = length(actual) === Number(expected);
            break;
          case "lengthGreaterOrEqual":
            passed = length(actual) >= Number(expected);
            break;
          case "lengthLessOrEqual":
            passed = length(actual) <= Number(expected);
            break;
          case "matches": {
            if (deferRegex) throw new Error("Regex pending");
            if (raw.length > 1000 || String(actual).length > 100000)
              throw new Error("Regex input exceeds evaluation limit");
            const m = raw.match(/^\/(.*)\/([dgimsuvy]*)$/);
            const regex = new RegExp(m?.[1] ?? raw, m?.[2] ?? "");
            if (!safeRegex(regex))
              throw new Error(
                "Regex is too complex for synchronous evaluation",
              );
            passed = regex.test(String(actual));
            break;
          }
          default:
            throw new Error("Unsupported assertion operator");
        }
        return { id: a.id, actual, expected, passed };
      } catch (e) {
        return {
          id: a.id,
          actual,
          expected,
          passed: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    });
}

/** In the extension, regexes run in disposable workers so imported patterns cannot freeze the UI. */
export async function evaluateAssertionsAsync(
  assertions: Assertion[],
  r: ExecutionResult,
  ctx: EvalContext,
): Promise<AssertionResult[]> {
  if (typeof Worker === "undefined")
    return evaluateAssertions(assertions, r, ctx);
  const rows = evaluateAssertions(assertions, r, ctx, true);
  return Promise.all(
    rows.map(async (row) => {
      if (row.error !== "Regex pending") return row;
      const a = assertions.find((a) => a.id === row.id)!;
      try {
        const pattern = interpolate(a.expected, ctx),
          value = String(row.actual);
        if (pattern.length > 1000 || value.length > 100000)
          throw new Error("Regex input exceeds evaluation limit");
        const passed = await new Promise<boolean>((resolve, reject) => {
          const worker = new Worker(
            new URL("./regex-worker.ts", import.meta.url),
            { type: "module" },
          );
          const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error("Regex evaluation exceeded 500 ms"));
          }, 500);
          worker.onmessage = (
            event: MessageEvent<{ passed?: boolean; error?: string }>,
          ) => {
            clearTimeout(timer);
            worker.terminate();
            if (event.data.error) reject(new Error(event.data.error));
            else resolve(!!event.data.passed);
          };
          worker.onerror = () => {
            clearTimeout(timer);
            worker.terminate();
            reject(new Error("Regex worker failed"));
          };
          worker.postMessage({ pattern, value });
        });
        return { ...row, passed, error: undefined };
      } catch (e) {
        return {
          ...row,
          passed: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
}
