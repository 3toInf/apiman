import { interpolate, bindRequestReferences } from "./expressions";
import {
  uid,
  type EvalContext,
  type ExecutionResult,
  type RequestDefinition,
} from "./model";
export type CompiledRequest = {
  requestId: string;
  url: string;
  method: string;
  headers: Headers;
  body?: BodyInit;
  bodyText: string;
  timeoutMs: number;
  maxResponseBytes: number;
  cookies: boolean;
};
const forbidden =
  /^(accept-charset|accept-encoding|access-control-request-headers|access-control-request-method|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|permissions-policy|referer|te|trailer|transfer-encoding|upgrade|user-agent|via|proxy-.*|sec-.*)$/i;
export function parseHttpUrl(renderedUrl: string): URL {
  let url: URL;
  try {
    url = new URL(renderedUrl);
  } catch {
    throw new Error(
      "Enter a complete HTTP(S) URL starting with http:// or https:// after expanding environment variables",
    );
  }
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("Only HTTP and HTTPS URLs are supported");
  if (url.username || url.password)
    throw new Error("Use the Authentication editor instead of URL credentials");
  return url;
}
export async function compileRequest(
  r: RequestDefinition,
  ctx: EvalContext,
  getFile?: (id: string) => Promise<Blob | undefined>,
): Promise<CompiledRequest> {
  if (r.unsupported.length)
    throw new Error(
      `Unsupported imported configuration: ${r.unsupported.join("; ")}`,
    );
  const bound = bindRequestReferences(r, ctx);
  const render = (s: string) =>
    interpolate(s, { ...ctx, referenceIds: bound.referenceIds });
  const url = parseHttpUrl(render(r.url));
  for (const p of r.query.filter((p) => p.enabled && p.name))
    url.searchParams.append(render(p.name), render(p.value));
  const headers = new Headers();
  for (const p of r.headers.filter((p) => p.enabled && p.name)) {
    const name = render(p.name);
    if (forbidden.test(name))
      throw new Error(
        `${name} is managed by the browser and cannot be overridden`,
      );
    headers.append(name, render(p.value));
  }
  const auth = r.auth;
  if (
    auth.type !== "none" &&
    headers.has("Authorization") &&
    auth.type !== "apikey"
  )
    throw new Error(
      "Choose either an Authorization header or Authentication, not both",
    );
  if (auth.type === "basic") {
    const bytes = new TextEncoder().encode(
      render(auth.username ?? "") + ":" + render(auth.password ?? ""),
    );
    headers.set(
      "Authorization",
      "Basic " +
        btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join("")),
    );
  }
  if (auth.type === "bearer")
    headers.set("Authorization", "Bearer " + render(auth.token ?? ""));
  if (auth.type === "apikey") {
    const name = render(auth.name ?? "");
    if (!name) throw new Error("API key name is required");
    if (auth.location === "query")
      url.searchParams.append(name, render(auth.value ?? ""));
    else {
      if (forbidden.test(name))
        throw new Error("API key header is managed by the browser");
      headers.set(name, render(auth.value ?? ""));
    }
  }
  const method = r.method.trim().toUpperCase();
  if (
    !/^[A-Z]+$/.test(method) ||
    ["CONNECT", "TRACE", "TRACK"].includes(method)
  )
    throw new Error("Unsupported HTTP method");
  let body: BodyInit | undefined;
  let bodyText = "";
  if (r.body.type !== "none") {
    if (["GET", "HEAD"].includes(method))
      throw new Error(`${method} cannot have a request body in this browser`);
    if (["text", "json", "xml"].includes(r.body.type)) {
      body = bodyText = render(r.body.text);
      if (!headers.has("Content-Type"))
        headers.set(
          "Content-Type",
          r.body.type === "json"
            ? "application/json"
            : r.body.type === "xml"
              ? "application/xml"
              : "text/plain;charset=UTF-8",
        );
    }
    if (r.body.type === "urlencoded") {
      const form = new URLSearchParams();
      for (const p of r.body.fields.filter((p) => p.enabled && p.name))
        form.append(render(p.name), render(p.value));
      body = bodyText = form.toString();
      if (!headers.has("Content-Type"))
        headers.set(
          "Content-Type",
          "application/x-www-form-urlencoded;charset=UTF-8",
        );
    }
    if (r.body.type === "multipart") {
      const form = new FormData();
      for (const p of r.body.fields.filter((p) => p.enabled && p.name)) {
        if (p.fileId) {
          const file = await getFile?.(p.fileId);
          if (!file)
            throw new Error(`Select the missing file: ${p.fileName ?? p.name}`);
          form.append(render(p.name), file, p.fileName ?? "file");
        } else form.append(render(p.name), render(p.value));
      }
      headers.delete("Content-Type");
      body = form;
      bodyText = "[multipart form data]";
    }
    if (r.body.type === "binary") {
      body = await getFile?.(r.body.fileId ?? "");
      if (!body) throw new Error("Select a binary file");
      bodyText = "[binary file]";
    }
  }
  if (!Number.isFinite(r.timeoutMs) || r.timeoutMs <= 0)
    throw new Error("Timeout must be positive");
  if (!Number.isFinite(r.maxResponseBytes) || r.maxResponseBytes <= 0)
    throw new Error("Response size limit must be positive");
  return {
    requestId: r.id,
    url: url.href,
    method,
    headers,
    body,
    bodyText,
    timeoutMs: r.timeoutMs,
    maxResponseBytes: r.maxResponseBytes,
    cookies: r.cookies,
  };
}
export async function executeRequest(
  c: CompiledRequest,
  signal?: AbortSignal,
): Promise<ExecutionResult> {
  const startedAt = Date.now(),
    start = performance.now(),
    abort = new AbortController();
  let timedOut = false;
  const result: ExecutionResult = {
    id: uid(),
    requestId: c.requestId,
    url: c.url,
    method: c.method,
    status: 0,
    statusText: "",
    headers: [],
    body: "",
    durationMs: 0,
    size: 0,
    startedAt,
    completed: false,
    requestHeaders: [...c.headers.entries()],
    requestBody: c.bodyText,
  };
  const cancel = () => abort.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, c.timeoutMs);
  try {
    const response = await fetch(c.url, {
      method: c.method,
      headers: c.headers,
      body: c.body,
      credentials: c.cookies ? "include" : "omit",
      signal: abort.signal,
      redirect: "follow",
      cache: "no-store",
    });
    result.status = response.status;
    result.statusText = response.statusText;
    result.headers = [...response.headers.entries()];
    result.url = response.url || c.url;
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result.size += value.byteLength;
        if (result.size > c.maxResponseBytes) {
          await reader.cancel();
          result.error = {
            kind: "size",
            message: `Response exceeds ${c.maxResponseBytes} bytes. Increase the limit to inspect it.`,
          };
          result.truncated = true;
          return result;
        }
        chunks.push(new Uint8Array(value));
      }
    }
    const blob = new Blob(chunks, {
      type: response.headers.get("content-type") ?? "application/octet-stream",
    });
    result.blob = blob;
    result.body = await blob.text();
    result.completed = true;
  } catch (e) {
    result.error = {
      kind: timedOut
        ? "timeout"
        : abort.signal.aborted
          ? "cancelled"
          : "network",
      message: timedOut
        ? `Request timed out after ${c.timeoutMs} ms`
        : abort.signal.aborted
          ? "Request cancelled"
          : `Network request failed. Check site permission, connection and browser certificate trust. ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    result.durationMs = Math.round((performance.now() - start) * 10) / 10;
  }
  return result;
}
