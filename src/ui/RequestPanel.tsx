import { useState, useEffect } from "react";
import {
  Save,
  Send,
  Square,
  Copy,
  Download,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileCode2,
  Link2,
} from "lucide-react";
import {
  Button,
  CodeEditor,
  PairEditor,
  Empty,
  download,
  errorText,
} from "./components";
import {
  uid,
  type RequestDefinition,
  type ExecutionResult,
  type Assertion,
  type AssertionResult,
  type RunReport,
  type Workspace,
  environmentContext,
} from "../core/model";
import { evaluateAssertionsAsync } from "../core/assertions";
import { parseHtmlResponse } from "../core/html";
import { exportCurl, sensitiveValues } from "../importers";
import { store, redactReport } from "../storage/store";
const targets: Assertion["target"][] = [
  "status",
  "statusText",
  "header",
  "body",
  "size",
  "duration",
  "json",
  "xml",
];
const operators: Assertion["operator"][] = [
  "equals",
  "notEquals",
  "greater",
  "greaterOrEqual",
  "less",
  "lessOrEqual",
  "exists",
  "notExists",
  "contains",
  "notContains",
  "matches",
  "lengthEquals",
  "lengthGreaterOrEqual",
  "lengthLessOrEqual",
];
export function RequestPanel({
  request: r,
  onChange,
  onSave,
  onSend,
  onCancel,
  busy,
  dirty,
  workspace: w,
  result,
  responseCache,
  onExpression,
  onError,
  onNewRequest,
}: {
  request: RequestDefinition;
  onChange: (r: RequestDefinition) => void;
  onSave: () => void;
  onSend: () => void;
  onCancel: () => void;
  busy: boolean;
  dirty: boolean;
  workspace: Workspace;
  result?: ExecutionResult;
  responseCache: Record<string, ExecutionResult>;
  onExpression: () => void;
  onError: (s: string) => void;
  onNewRequest: (request: RequestDefinition) => void;
}) {
  const [tab, setTab] = useState("headers");
  const update = (patch: Partial<RequestDefinition>) =>
    onChange({ ...r, ...patch });
  const [results, setResults] = useState<AssertionResult[]>([]);
  useEffect(() => {
    let active = true;
    if (!result) {
      setResults([]);
      return;
    }
    void evaluateAssertionsAsync(r.assertions, result, {
      ...environmentContext(w),
      referenceIds: r.referenceIds,
      requests: [...w.requests.filter((request) => request.id !== r.id), r],
      responses: { ...responseCache, [r.id]: result },
    }).then((rows) => {
      if (active) setResults(rows);
    });
    return () => {
      active = false;
    };
  }, [r, result, w, responseCache]);
  const bodyEditor = (
    <>
      <div className="body-toolbar">
        <label>
          Body type{" "}
          <select
            aria-label="Body type"
            value={r.body.type}
            onChange={(e) =>
              update({
                body: {
                  ...r.body,
                  type: e.target.value as RequestDefinition["body"]["type"],
                },
              })
            }
          >
            {[
              "none",
              "json",
              "xml",
              "text",
              "urlencoded",
              "multipart",
              "binary",
            ].map((t) => (
              <option value={t} key={t}>
                {t === "urlencoded"
                  ? "Form URL encoded"
                  : t === "multipart"
                    ? "Multipart form data"
                    : t === "none"
                      ? "No body"
                      : t.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        {r.body.type === "json" && (
          <Button
            className="text-button"
            onClick={() => {
              try {
                update({
                  body: {
                    ...r.body,
                    text: JSON.stringify(JSON.parse(r.body.text), null, 2),
                  },
                });
              } catch (e) {
                onError(errorText(e));
              }
            }}
          >
            Format JSON
          </Button>
        )}
      </div>
      {r.body.type === "none" ? (
        <p className="section-note">This request has no body.</p>
      ) : ["json", "xml", "text"].includes(r.body.type) ? (
        <CodeEditor
          value={r.body.text}
          onChange={(text) => update({ body: { ...r.body, text } })}
          language={r.body.type}
          label="Request body"
        />
      ) : ["urlencoded", "multipart"].includes(r.body.type) ? (
        <PairEditor
          rows={r.body.fields}
          onChange={(fields) => update({ body: { ...r.body, fields } })}
          label="Field"
          files={r.body.type === "multipart"}
          onError={onError}
        />
      ) : (
        <label className="file-upload">
          {r.body.fileName ?? "Choose a binary file"}
          <input
            type="file"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f)
                try {
                  update({
                    body: {
                      ...r.body,
                      fileId: await store.addFile(f),
                      fileName: f.name,
                    },
                  });
                } catch (err) {
                  onError(errorText(err));
                }
            }}
          />
        </label>
      )}
    </>
  );
  const assertionEditor = (
    <>
      <p className="section-note">
        Assertions are re-evaluated when you send the request or edit a
        condition. JSON expected values are typed.
      </p>
      {r.assertions.map((a, i) => {
        const row = results.find((x) => x.id === a.id);
        const edit = (patch: Partial<Assertion>) =>
          update({
            assertions: r.assertions.map((x) =>
              x.id === a.id ? { ...x, ...patch } : x,
            ),
          });
        return (
          <div className="assertion" key={a.id}>
            <div className="assertion-fields">
              <input
                type="checkbox"
                aria-label={`Enable assertion ${i + 1}`}
                checked={a.enabled}
                onChange={(e) => edit({ enabled: e.target.checked })}
              />
              <select
                aria-label="Assertion target"
                value={a.target}
                onChange={(e) =>
                  edit({ target: e.target.value as Assertion["target"] })
                }
              >
                {targets.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              {["header", "json", "xml"].includes(a.target) && (
                <input
                  aria-label="Assertion selector"
                  placeholder={
                    a.target === "json"
                      ? "$.id"
                      : a.target === "xml"
                        ? "//id"
                        : "Content-Type"
                  }
                  value={a.selector}
                  onChange={(e) => edit({ selector: e.target.value })}
                />
              )}
              <select
                aria-label="Assertion operator"
                value={a.operator}
                onChange={(e) =>
                  edit({ operator: e.target.value as Assertion["operator"] })
                }
              >
                {operators.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <input
                aria-label="Expected value"
                placeholder="Expected value"
                value={a.expected}
                disabled={["exists", "notExists"].includes(a.operator)}
                onChange={(e) => edit({ expected: e.target.value })}
              />
              <Button
                title="Remove assertion"
                onClick={() =>
                  update({
                    assertions: r.assertions.filter((x) => x.id !== a.id),
                  })
                }
              >
                <Trash2 size={15} />
              </Button>
            </div>
            {row && (
              <div
                className={
                  "assertion-result " + (row.passed ? "passed" : "failed")
                }
              >
                {row.passed ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <AlertCircle size={14} />
                )}{" "}
                {row.error ??
                  `Actual: ${JSON.stringify(row.actual)} · Expected: ${JSON.stringify(row.expected)}`}
              </div>
            )}
          </div>
        );
      })}
      <Button
        className="text-button"
        onClick={() =>
          update({
            assertions: [
              ...r.assertions,
              {
                id: uid(),
                target: "status",
                selector: "",
                operator: "equals",
                expected: "200",
                enabled: true,
              },
            ],
          })
        }
      >
        <Plus size={15} /> Add assertion
      </Button>
    </>
  );
  return (
    <>
      <div className="request-card">
        <div className="request-title">
          <input
            aria-label="Request name"
            value={r.name}
            onChange={(e) => update({ name: e.target.value })}
          />
          {dirty && <span className="unsaved">Unsaved</span>}
          <div className="grow" />
          <Button aria-label="Save request" onClick={onSave}>
            <Save size={16} /> Save
          </Button>
          <Button
            title="Copy as cURL (may include credentials)"
            onClick={() =>
              navigator.clipboard
                .writeText(exportCurl(r))
                .catch((e) => onError(errorText(e)))
            }
          >
            <Copy size={15} /> cURL
          </Button>
        </div>
        <div className="request-url">
          <select
            aria-label="HTTP method"
            value={r.method}
            onChange={(e) => update({ method: e.target.value })}
          >
            {[
              "GET",
              "POST",
              "PUT",
              "PATCH",
              "DELETE",
              "HEAD",
              "OPTIONS",
              "PROPFIND",
              "MKCOL",
              "COPY",
              "MOVE",
              "LOCK",
              "UNLOCK",
            ].map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input
            aria-label="Request URL"
            value={r.url}
            onChange={(e) => update({ url: e.target.value })}
            placeholder="https://api.example.com/resource"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) onSend();
            }}
          />
          <Button
            className={busy ? "cancel" : "send"}
            aria-label={busy ? "Cancel request" : "Send request"}
            onClick={busy ? onCancel : onSend}
          >
            {busy ? <Square size={16} /> : <Send size={16} />}{" "}
            {busy ? "Cancel" : "Send"}
          </Button>
        </div>
        {r.unsupported.length > 0 && (
          <div className="compatibility-note">
            <AlertCircle size={17} />
            <div>
              <strong>Review imported configuration</strong>
              <ul>
                {r.unsupported.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
              <Button
                onClick={() => {
                  if (
                    confirm(
                      "Discard unsupported execution settings? Review the request carefully before sending. The original source remains in the full backup.",
                    )
                  )
                    update({ unsupported: [] });
                }}
              >
                Discard unsupported settings
              </Button>
            </div>
          </div>
        )}
        <div className="editor-tabs">
          {[
            ["query", "QUERY PARAMETERS", r.query.length],
            ["headers", "HEADERS", r.headers.length],
            ["body", "BODY", r.body.type === "none" ? 0 : 1],
            ["auth", "AUTHENTICATION", r.auth.type === "none" ? 0 : 1],
            ["assertions", "ASSERTIONS", r.assertions.length],
            ["settings", "SETTINGS", 0],
          ].map(([id, label, count]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(String(id))}
            >
              {label}
              {!!count && <span className="count">{count}</span>}
            </button>
          ))}
          <button
            className="expression-trigger"
            title="Expression builder"
            onClick={onExpression}
          >
            ƒx
          </button>
        </div>
        <section className="request-editor">
          {tab === "query" && (
            <PairEditor
              rows={r.query}
              onChange={(query) => update({ query })}
              label="Parameter"
            />
          )}
          {tab === "headers" && (
            <div className="headers-body">
              <div>
                <h3>HEADERS</h3>
                <PairEditor
                  rows={r.headers}
                  onChange={(headers) => update({ headers })}
                  label="Header"
                />
              </div>
              <div>
                <h3>BODY</h3>
                {["GET", "HEAD"].includes(r.method) ? (
                  <p className="section-note">
                    {r.method} requests do not include a body.
                  </p>
                ) : (
                  bodyEditor
                )}
              </div>
            </div>
          )}
          {tab === "body" && bodyEditor}
          {tab === "auth" && (
            <div className="auth-editor">
              <label className="field">
                Authentication type
                <select
                  value={r.auth.type}
                  onChange={(e) =>
                    update({
                      auth: {
                        type: e.target
                          .value as RequestDefinition["auth"]["type"],
                      },
                    })
                  }
                >
                  {["none", "basic", "bearer", "apikey"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              {(r.auth.type === "basic"
                ? ["username", "password"]
                : r.auth.type === "bearer"
                  ? ["token"]
                  : r.auth.type === "apikey"
                    ? ["name", "value"]
                    : []
              ).map((key) => (
                <label className="field" key={key}>
                  {key}
                  <input
                    aria-label={"Auth " + key}
                    type={
                      ["password", "token", "value"].includes(key)
                        ? "password"
                        : "text"
                    }
                    value={String(r.auth[key as keyof typeof r.auth] ?? "")}
                    onChange={(e) =>
                      update({ auth: { ...r.auth, [key]: e.target.value } })
                    }
                  />
                </label>
              ))}
              {r.auth.type === "apikey" && (
                <label className="field">
                  Add to
                  <select
                    value={r.auth.location ?? "header"}
                    onChange={(e) =>
                      update({
                        auth: {
                          ...r.auth,
                          location: e.target.value as "header" | "query",
                        },
                      })
                    }
                  >
                    <option value="header">Header</option>
                    <option value="query">Query parameter</option>
                  </select>
                </label>
              )}
              <p className="section-note">
                Use an environment expression such as {'${"token"}'} to keep
                credentials reusable.
              </p>
            </div>
          )}
          {tab === "assertions" && assertionEditor}
          {tab === "settings" && (
            <div className="settings-grid">
              <label className="field">
                Timeout (ms)
                <input
                  type="number"
                  min="1"
                  value={r.timeoutMs}
                  onChange={(e) =>
                    update({ timeoutMs: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                Response size limit (MiB)
                <input
                  type="number"
                  min="1"
                  value={r.maxResponseBytes / 1024 / 1024}
                  onChange={(e) =>
                    update({
                      maxResponseBytes: Number(e.target.value) * 1024 * 1024,
                    })
                  }
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={r.cookies}
                  onChange={(e) => update({ cookies: e.target.checked })}
                />{" "}
                Use browser session cookies
              </label>
              <label className="field full">
                Description
                <textarea
                  value={r.description}
                  onChange={(e) => update({ description: e.target.value })}
                />
              </label>
              <p className="section-note full">
                Requests follow redirects and the browser's certificate trust.
                Cookie policies and browser-managed headers apply. Closing this
                workspace stops active requests.
              </p>
            </div>
          )}
        </section>
      </div>
      <ResponsePanel result={result} onNewRequest={onNewRequest} />
      {tab !== "assertions" && (
        <section className="assertion-panel">
          <h3>
            ASSERTIONS <span className="count">{r.assertions.length}</span>
          </h3>
          {assertionEditor}
        </section>
      )}
    </>
  );
}
function prettyXml(input: string) {
  let depth = 0;
  return input
    .replace(/>\s*</g, ">\n<")
    .split("\n")
    .map((line) => {
      if (/^<\//.test(line)) depth = Math.max(0, depth - 1);
      const out = "  ".repeat(depth) + line;
      if (/^<[^!?/][^>]*[^/]?>$/.test(line) && !/<\/[^>]+>$/.test(line))
        depth++;
      return out;
    })
    .join("\n");
}
export function ResponsePanel({
  result: r,
  onNewRequest,
}: {
  result?: ExecutionResult;
  onNewRequest: (request: RequestDefinition) => void;
}) {
  const [tab, setTab] = useState("pretty");
  const [search, setSearch] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!r?.blob) {
      setUrl("");
      return;
    }
    const u = URL.createObjectURL(r.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [r?.id, r?.blob]);
  if (!r)
    return (
      <div className="response-section">
        <div className="response-heading">
          <h3>RESPONSE</h3>
        </div>
        <Empty title="Ready when you are">
          Send a request to inspect its response.
        </Empty>
      </div>
    );
  const type =
    r.headers.find(([name]) => name?.toLowerCase() === "content-type")?.[1] ??
    "";
  let display = r.body.slice(0, 1024 * 1024);
  if (tab === "pretty") {
    try {
      display = JSON.stringify(JSON.parse(display), null, 2);
    } catch {
      if (type.includes("xml")) display = prettyXml(display);
    }
  }
  const { html, drafts: links } = type.includes("html")
    ? parseHtmlResponse(r.body, r.url)
    : { html: "", drafts: [] };
  const content = search
    ? display
        .split("\n")
        .filter((l) => l.toLowerCase().includes(search.toLowerCase()))
        .join("\n")
    : display;
  return (
    <div className="response-section">
      <div className="response-heading">
        <h3>RESPONSE</h3>
        <span
          data-testid="response-status"
          className={
            "status " +
            (r.error ? "failed" : r.status < 400 ? "passed" : "failed")
          }
        >
          {r.error ? r.error.kind.toUpperCase() : `${r.status} ${r.statusText}`}
        </span>
        <span>{r.durationMs} ms</span>
        <span>{(r.size / 1024).toFixed(2)} KB</span>
        <div className="grow" />
        <Button
          title="Copy response"
          onClick={() => navigator.clipboard.writeText(r.body)}
        >
          <Copy size={15} />
        </Button>
        <Button
          title="Download response"
          onClick={() =>
            download(
              "response" +
                (type.includes("json")
                  ? ".json"
                  : type.includes("xml")
                    ? ".xml"
                    : ".txt"),
              r.blob ?? r.body,
              type,
            )
          }
        >
          <Download size={15} />
        </Button>
      </div>
      {r.error && <div className="error-banner">{r.error.message}</div>}
      <div className="response-tabs">
        {["pretty", "raw", "preview", "headers", "request"].map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {t.toUpperCase()}
            {t === "headers" && (
              <span className="count">{r.headers.length}</span>
            )}
          </button>
        ))}
        <div className="grow" />
        <input
          aria-label="Search response"
          placeholder="Filter response lines…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {r.truncated && (
        <p className="warning-banner">
          This stored response is truncated. Send the request again to run
          assertions.
        </p>
      )}
      {["raw", "pretty"].includes(tab) && (
        <pre data-testid="response-body" className="response-code">
          {content || "(empty response)"}
        </pre>
      )}
      {tab === "headers" && (
        <table className="response-table">
          <tbody>
            {r.headers.map(([key, value], i) => (
              <tr key={i}>
                <th>{key}</th>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {tab === "request" && (
        <div className="request-summary">
          <p>
            <strong>{r.method}</strong> {r.url}
          </p>
          <p className="section-note">
            Configured headers; the browser may add or normalize wire headers.
          </p>
          <table className="response-table">
            <tbody>
              {r.requestHeaders?.map(([k, v], i) => (
                <tr key={i}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <pre>{r.requestBody}</pre>
        </div>
      )}
      {tab === "preview" &&
        (type.includes("html") ? (
          <>
            <iframe title="Isolated HTML preview" sandbox="" srcDoc={html} />
            {links.length > 0 && (
              <div className="response-links">
                <strong>Links and forms</strong>
                {links.map((link, i) => (
                  <Button key={i} onClick={() => onNewRequest(link)}>
                    <Link2 size={14} />
                    {link.method} {link.url}
                  </Button>
                ))}
              </div>
            )}
          </>
        ) : type.startsWith("image/") && url ? (
          <img className="image-preview" src={url} alt="API response" />
        ) : (
          <div className="binary-preview">
            <FileCode2 size={32} />
            <p>{type || "Unknown content type"}</p>
            <p>Use Pretty / Raw for text, or download the response.</p>
          </div>
        ))}
    </div>
  );
}
export function RunResults({
  report,
  workspace: w,
}: {
  report: RunReport;
  workspace: Workspace;
}) {
  return (
    <section className="run-results">
      <div className="response-heading">
        <h3>RUN RESULTS</h3>
        <span className={"status " + report.status}>
          {report.status.toUpperCase()}
        </span>
        <span>
          {report.steps.filter((s) => s.passed).length} / {report.steps.length}{" "}
          passed
        </span>
        <div className="grow" />
        <Button
          onClick={() =>
            download(
              "apiman-run.json",
              JSON.stringify(
                redactReport(report, sensitiveValues(w)),
                (_k, v) => (v instanceof Blob ? undefined : v),
                2,
              ),
            )
          }
        >
          <Download size={15} /> Report
        </Button>
      </div>
      {report.steps.map((s, i) => (
        <details
          key={i}
          className={"run-result " + (s.passed ? "passed" : "failed")}
        >
          <summary>
            <span>{s.passed ? "✓" : "✕"}</span>
            <strong>
              {w.requests.find((r) => r.id === s.requestId)?.name ??
                s.requestId}
            </strong>
            <span>
              #{s.iteration} · {s.result.status || s.result.error?.kind} ·{" "}
              {s.result.durationMs} ms
            </span>
          </summary>
          {s.result.error && <p>{s.result.error.message}</p>}
          {s.assertions.map((a) => (
            <p key={a.id}>
              {a.passed ? "✓" : "✕"}{" "}
              {a.error ??
                `Actual ${JSON.stringify(a.actual)} / expected ${JSON.stringify(a.expected)}`}
            </p>
          ))}
          <pre>{s.result.body.slice(0, 10000)}</pre>
        </details>
      ))}
    </section>
  );
}
