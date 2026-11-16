import { useState } from "react";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Download,
  Upload,
  LockKeyhole,
} from "lucide-react";
import { Button, Modal, CodeEditor, download, errorText } from "./components";
import {
  newRequest,
  pair,
  uid,
  environmentContext,
  type Workspace,
  type ExecutionResult,
  type ImportReport,
  type Scenario,
} from "../core/model";
import { importDocument, exportWorkspace, exportScope } from "../importers";
import { interpolate, requestPath } from "../core/expressions";
import { store } from "../storage/store";
export function EnvironmentsDialog({
  workspace: w,
  onChange,
  onClose,
}: {
  workspace: Workspace;
  onChange: (w: Workspace) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(
    w.activeEnvironmentId ?? w.environments[0]?.id,
  );
  const [show, setShow] = useState(false);
  const current = w.environments.find((e) => e.id === selected);
  const update = (patch: Partial<NonNullable<typeof current>>) =>
    onChange({
      ...w,
      environments: w.environments.map((e) =>
        e.id === selected ? { ...e, ...patch } : e,
      ),
    });
  return (
    <Modal title="Environments" onClose={onClose} wide>
      <div className="environment-layout">
        <div className="environment-list">
          {w.environments.map((e) => (
            <button
              className={e.id === selected ? "active" : ""}
              key={e.id}
              onClick={() => setSelected(e.id)}
            >
              {e.name}
            </button>
          ))}
          <Button
            onClick={() => {
              const id = uid();
              onChange({
                ...w,
                environments: [
                  ...w.environments,
                  { id, name: "New environment", variables: [] },
                ],
                activeEnvironmentId: w.activeEnvironmentId ?? id,
              });
              setSelected(id);
            }}
          >
            <Plus size={16} /> Add environment
          </Button>
        </div>
        <div className="environment-details">
          {current ? (
            <>
              <div className="inline">
                <input
                  aria-label="Environment name"
                  value={current.name}
                  onChange={(e) => update({ name: e.target.value })}
                />
                <Button
                  title="Delete environment"
                  onClick={() => {
                    if (!confirm("Delete this environment?")) return;
                    onChange({
                      ...w,
                      environments: w.environments.filter(
                        (e) => e.id !== selected,
                      ),
                      activeEnvironmentId:
                        w.activeEnvironmentId === selected
                          ? undefined
                          : w.activeEnvironmentId,
                    });
                    setSelected(undefined);
                  }}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
              <div className="section-note">
                Switch environments to reuse the same requests. Private values
                stay on this device and are excluded from default exports.
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={show}
                  onChange={(e) => setShow(e.target.checked)}
                />{" "}
                Show private values
              </label>
              <div className="env-head">
                <span>ON</span>
                <span>NAME</span>
                <span>VALUE</span>
                <span>PRIVATE</span>
                <span />
              </div>
              {current.variables.map((v) => (
                <div className="env-row" key={v.id}>
                  <input
                    type="checkbox"
                    checked={v.enabled}
                    aria-label="Variable enabled"
                    onChange={(e) =>
                      update({
                        variables: current.variables.map((x) =>
                          x.id === v.id
                            ? { ...x, enabled: e.target.checked }
                            : x,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label="Variable name"
                    value={v.name}
                    onChange={(e) =>
                      update({
                        variables: current.variables.map((x) =>
                          x.id === v.id ? { ...x, name: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label="Variable value"
                    type={v.private && !show ? "password" : "text"}
                    value={v.value}
                    onChange={(e) =>
                      update({
                        variables: current.variables.map((x) =>
                          x.id === v.id ? { ...x, value: e.target.value } : x,
                        ),
                      })
                    }
                  />
                  <input
                    type="checkbox"
                    aria-label="Private variable"
                    checked={v.private}
                    onChange={(e) =>
                      update({
                        variables: current.variables.map((x) =>
                          x.id === v.id
                            ? { ...x, private: e.target.checked }
                            : x,
                        ),
                      })
                    }
                  />
                  <Button
                    title="Remove variable"
                    onClick={() =>
                      update({
                        variables: current.variables.filter(
                          (x) => x.id !== v.id,
                        ),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              <Button
                className="text-button"
                onClick={() =>
                  update({
                    variables: [
                      ...current.variables,
                      { ...pair(), private: false },
                    ],
                  })
                }
              >
                <Plus size={15} /> Add variable
              </Button>
            </>
          ) : (
            <p>Select or create an environment.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
export function ImportDialog({
  onImport,
  onClose,
}: {
  onImport: (r: ImportReport) => Promise<void>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [report, setReport] = useState<ImportReport>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Import repository" wide onClose={onClose}>
      <p className="section-note">
        Repository JSON v6 · apiman · Postman v2 · OpenAPI / Swagger · HAR 1.2 ·
        cURL
      </p>
      <label className="button file-button">
        <Upload size={16} /> Choose file
        <input
          type="file"
          accept=".json,.yaml,.yml,.har,.txt"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              if (f.size > 50 * 1024 * 1024) {
                setError("Import exceeds 50 MiB");
                return;
              }
              setText(await f.text());
              setReport(undefined);
            }
          }}
        />
      </label>
      <textarea
        className="import-text"
        aria-label="Import text"
        value={text}
        placeholder="Paste your exported repository or a curl command…"
        onChange={(e) => {
          setText(e.target.value);
          setReport(undefined);
        }}
      />
      {error && <p className="error-banner">{error}</p>}
      {report && (
        <div className="import-preview">
          <strong>{report.format}</strong>
          <p>
            {report.workspace.requests.length} requests ·{" "}
            {report.workspace.nodes.length} folders/scenarios ·{" "}
            {report.workspace.environments.length} environments
          </p>
          {report.warnings.length > 0 && (
            <details open>
              <summary>{report.warnings.length} compatibility notes</summary>
              <ul>
                {report.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
          <p>
            Imported items are added as new entries. Existing data is not
            replaced.
          </p>
        </div>
      )}
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          disabled={!text || busy}
          onClick={() => {
            try {
              setReport(importDocument(text));
              setError("");
            } catch (e) {
              setError(errorText(e));
              setReport(undefined);
            }
          }}
        >
          Preview import
        </Button>
        <Button
          className="primary"
          disabled={!report || busy}
          onClick={async () => {
            if (!report) return;
            setBusy(true);
            try {
              await onImport(report);
              onClose();
            } catch (e) {
              setError(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Import data
        </Button>
      </div>
    </Modal>
  );
}
export function ExportDialog({
  workspace: w,
  onClose,
}: {
  workspace: Workspace;
  onClose: () => void;
}) {
  const [secrets, setSecrets] = useState(false);
  const [files, setFiles] = useState(false);
  const [scope, setScope] = useState("all");
  const [error, setError] = useState("");
  return (
    <Modal title="Export repository" onClose={onClose}>
      <p>
        Download a portable apiman backup. It can be imported in either browser.
      </p>
      <label className="field">
        Items
        <select value={scope} onChange={(e) => setScope(e.target.value)}>
          <option value="all">Entire repository</option>
          {w.nodes
            .filter((n) => !n.parentId)
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={secrets}
          onChange={(e) => setSecrets(e.target.checked)}
        />
        <LockKeyhole size={15} /> Include private variables and credentials
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={files}
          onChange={(e) => setFiles(e.target.checked)}
        />{" "}
        Include uploaded files
      </label>
      <p className="section-note">
        Without private values, authentication must be configured again after
        import. Excluded files must be selected again.
      </p>
      {error && <p className="error-banner">{error}</p>}
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          className="primary"
          onClick={async () => {
            try {
              const selected = scope === "all" ? w : exportScope(w, scope);
              download(
                "apiman-backup.json",
                exportWorkspace(await store.backup(selected, files), {
                  includeSecrets: secrets,
                  includeAttachments: files,
                }),
              );
              onClose();
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          <Download size={16} /> Export
        </Button>
      </div>
    </Modal>
  );
}
export function ExpressionDialog({
  workspace: w,
  responses,
  onClose,
}: {
  workspace: Workspace;
  responses: Record<string, ExecutionResult>;
  onClose: () => void;
}) {
  const [input, setInput] = useState('${"variable"}');
  let preview: string;
  try {
    preview = interpolate(input, { ...environmentContext(w), responses });
  } catch (e) {
    preview = errorText(e);
  }
  return (
    <Modal title="Expression builder" wide onClose={onClose}>
      <p className="section-note">
        Insert an environment variable or reference a previous response. Use the
        generated expression in URLs, headers, bodies and assertions.
      </p>
      <div className="expression-options">
        <select
          aria-label="Insert variable"
          defaultValue=""
          onChange={(e) =>
            setInput("${" + JSON.stringify(e.target.value) + "}")
          }
        >
          <option value="" disabled>
            Environment variable…
          </option>
          {w.environments
            .find((e) => e.id === w.activeEnvironmentId)
            ?.variables.map((v) => (
              <option key={v.id}>{v.name}</option>
            ))}
        </select>
        <select
          aria-label="Insert response reference"
          defaultValue=""
          onChange={(e) => {
            const r = w.requests.find((r) => r.id === e.target.value);
            if (r)
              setInput(
                "${" +
                  requestPath(r, environmentContext(w)) +
                  '."response"."body".jsonPath("$.id")}',
              );
          }}
        >
          <option value="" disabled>
            Request response…
          </option>
          {w.requests.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Insert function"
          defaultValue=""
          onChange={(e) => setInput("${" + e.target.value + "}")}
        >
          <option value="" disabled>
            Function…
          </option>
          {[
            "timestamp()",
            "uuid()",
            "random(100)",
            "randomString(16, true, true, true)",
            '"text".base64()',
            '"text".upper()',
            '"7".math("MULTIPLY", "6")',
            'timestamp().formatDate("TIMESTAMP", "ISO_8601")',
          ].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </div>
      <CodeEditor value={input} onChange={setInput} />
      <div className="preview-box">
        <small>PREVIEW (private values may be visible)</small>
        <pre>{preview}</pre>
      </div>
      <div className="modal-actions">
        <Button onClick={() => navigator.clipboard.writeText(input)}>
          Copy expression
        </Button>
        <Button className="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}
export function ScenarioSettings({
  scenario: s,
  workspace: w,
  onChange,
}: {
  scenario: Scenario;
  workspace: Workspace;
  onChange: (s: Scenario) => void;
}) {
  const move = (index: number, delta: number) => {
    const ids = [...s.requestIds];
    const other = index + delta;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other]!, ids[index]!];
    onChange({ ...s, requestIds: ids });
  };
  return (
    <>
      <div className="run-settings">
        <label>
          Repeat
          <input
            type="number"
            min="1"
            max="10000"
            value={s.repeat}
            onChange={(e) => onChange({ ...s, repeat: Number(e.target.value) })}
          />
        </label>
        <label>
          Delay (ms)
          <input
            type="number"
            min="0"
            value={s.delayMs}
            onChange={(e) =>
              onChange({ ...s, delayMs: Number(e.target.value) })
            }
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.stopOnFailure}
            onChange={(e) =>
              onChange({ ...s, stopOnFailure: e.target.checked })
            }
          />{" "}
          Stop on failure
        </label>
      </div>
      <div className="scenario-steps">
        {s.requestIds.map((id, i) => {
          const r = w.requests.find((r) => r.id === id);
          return (
            <div className="scenario-step" key={i}>
              <span className="step-number">{i + 1}</span>
              <span className={"method " + r?.method.toLowerCase()}>
                {r?.method}
              </span>
              <span className="grow">{r?.name ?? "Missing request"}</span>
              <Button title="Move step up" onClick={() => move(i, -1)}>
                <ArrowUp size={15} />
              </Button>
              <Button title="Move step down" onClick={() => move(i, 1)}>
                <ArrowDown size={15} />
              </Button>
              <Button
                title="Remove step"
                onClick={() =>
                  onChange({
                    ...s,
                    requestIds: s.requestIds.filter((_, j) => i !== j),
                  })
                }
              >
                <Trash2 size={15} />
              </Button>
            </div>
          );
        })}
      </div>
      <select
        aria-label="Add scenario request"
        value=""
        onChange={(e) => {
          if (e.target.value)
            onChange({ ...s, requestIds: [...s.requestIds, e.target.value] });
        }}
      >
        <option value="">+ Add a request to this scenario…</option>
        {w.requests.map((r) => (
          <option key={r.id} value={r.id}>
            {r.method} · {r.name}
          </option>
        ))}
      </select>
    </>
  );
}
export function createDraft(parentId?: string) {
  return newRequest("Untitled request", parentId);
}
