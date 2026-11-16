import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import {
  Plus,
  Search,
  Folder,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronsDownUp,
  History,
  Database,
  Upload,
  Download,
  Settings2,
  Play,
  Square,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  MoveRight,
  X,
  GitBranch,
  Globe,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  newRequest,
  newWorkspace,
  environmentContext,
  uid,
  type Workspace,
  type RequestDefinition,
  type ExecutionResult,
  type RepositoryNode,
  type Scenario,
  type RunReport,
} from "../core/model";
import { compileRequest, executeRequest, parseHttpUrl } from "../core/http";
import { validateWorkspace } from "../core/schema";
import { runScenario } from "../core/runner";
import { interpolate, bindRequestReferences } from "../core/expressions";
import { sensitiveValues } from "../importers";
import type { TalendUrlRepairReport } from "../importers/talend-url";
import {
  store,
  mergeWorkspace,
  redactReport,
  type HistoryEntry,
} from "../storage/store";
import { Button, Modal, Empty, errorText } from "./components";
import {
  EnvironmentsDialog,
  ImportDialog,
  ExportDialog,
  ExpressionDialog,
  ScenarioSettings,
} from "./dialogs";
import { RequestPanel, RunResults } from "./RequestPanel";

export function App() {
  const [w, setW] = useState<Workspace>(newWorkspace());
  const workspaceRef = useRef(w);
  const [loaded, setLoaded] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, RequestDefinition>>({});
  const draftsRef = useRef(drafts);
  const [selected, setSelected] = useState("");
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [responses, setResponses] = useState<Record<string, ExecutionResult>>(
    {},
  );
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [sidebar, setSidebar] = useState("repository");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [urlRepairs, setUrlRepairs] = useState<TalendUrlRepairReport>();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<RunReport>();
  const [runName, setRunName] = useState("");
  const [menu, setMenu] = useState<string>();
  const [moveId, setMoveId] = useState("");
  const [moveParent, setMoveParent] = useState("");
  const abort = useRef<AbortController | undefined>(undefined);
  const queue = useRef(Promise.resolve());
  const generation = useRef(0);
  const fail = (e: unknown) => setError(errorText(e));
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let saved: Workspace;
        try {
          saved =
            (await store.load((report) => {
              if (alive && (report.repaired.length || report.review.length))
                setUrlRepairs(report);
            })) ?? newWorkspace();
        } catch (e) {
          // A failed repair transaction must not prevent access to the original workspace.
          const row = await store.snapshots.get("main");
          if (!row) throw e;
          saved = validateWorkspace(row.workspace);
          fail(
            "Could not save automatic Talend URL repairs. Original data was preserved: " +
              errorText(e),
          );
        }
        const entries = await store.drafts.toArray();
        const restored = Object.fromEntries(
          entries.map((d) => [d.id, d.request]),
        );
        const prefs = await browser.storage.local.get([
          "activeRequestId",
          "collapsedNodeIds",
        ]);
        const id =
          typeof prefs.activeRequestId === "string" &&
          (restored[prefs.activeRequestId] ||
            saved.requests.some((r) => r.id === prefs.activeRequestId))
            ? prefs.activeRequestId
            : (entries[0]?.id ?? saved.requests[0]?.id ?? "");
        if (!alive) return;
        workspaceRef.current = saved;
        setW(saved);
        draftsRef.current = restored;
        setDrafts(restored);
        const nodeIds = new Set(saved.nodes.map((n) => n.id));
        setCollapsed(
          new Set(
            Array.isArray(prefs.collapsedNodeIds)
              ? prefs.collapsedNodeIds.filter(
                  (id): id is string =>
                    typeof id === "string" && nodeIds.has(id),
                )
              : [],
          ),
        );
        setSelected(id);
        setOpenIds(id ? [id] : []);
        setHistory(
          await store.history.orderBy("startedAt").reverse().toArray(),
        );
        const previous = await store.reports.orderBy("startedAt").last();
        if (previous) {
          if (previous.status === "running") {
            previous.status = "interrupted";
            await store.reports.put(previous);
          }
          setReport(previous);
        }
        setLoaded(true);
      } catch (e) {
        fail(e);
        setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (loaded)
      void browser.storage.local.set({ activeRequestId: selected }).catch(fail);
  }, [selected, loaded]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(t);
  }, [notice]);
  const saveWorkspace = (
    next: Workspace,
    options: { savedDraft?: RequestDefinition; removeDraftIds?: string[] } = {},
  ): Promise<boolean> => {
    try {
      validateWorkspace(next);
    } catch (e) {
      fail(e);
      return Promise.resolve(false);
    }
    const previous = workspaceRef.current;
    if (
      JSON.stringify(next.environments) !==
        JSON.stringify(workspaceRef.current.environments) ||
      next.activeEnvironmentId !== workspaceRef.current.activeEnvironmentId
    ) {
      generation.current++;
      setResponses({});
    }
    workspaceRef.current = next;
    setW(next);
    queue.current = queue.current
      .catch(() => {})
      .then(() => store.save(next, options));
    return queue.current
      .then(() => true)
      .catch((e) => {
        if (workspaceRef.current === next) {
          workspaceRef.current = previous;
          setW(previous);
        }
        fail(e);
        return false;
      });
  };
  const edit = (r: RequestDefinition) => {
    const before =
      draftsRef.current[r.id] ??
      workspaceRef.current.requests.find((item) => item.id === r.id);
    const signature = (item: RequestDefinition | undefined) =>
      item
        ? JSON.stringify({
            ...item,
            name: "",
            description: "",
            assertions: [],
            parentId: undefined,
            order: 0,
            referenceIds: undefined,
            source: undefined,
          })
        : "";
    if (signature(before) !== signature(r)) {
      generation.current++;
      setResponses((prev) => {
        const next = { ...prev };
        delete next[r.id];
        return next;
      });
    }
    const next = { ...draftsRef.current, [r.id]: r };
    draftsRef.current = next;
    setDrafts(next);
    void store.drafts.put({ id: r.id, request: r }).catch(fail);
  };
  const select = (id: string) => {
    setSelected(id);
    setOpenIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setMenu(undefined);
  };
  const create = (parentId?: string, url = "") => {
    const r = newRequest("Untitled request", parentId);
    r.url = url;
    edit(r);
    select(r.id);
  };
  const current = drafts[selected] ?? w.requests.find((r) => r.id === selected);
  const node = w.nodes.find((n) => n.id === selected);
  const dirty =
    !!current &&
    JSON.stringify(current) !==
      JSON.stringify(w.requests.find((r) => r.id === selected));
  const saveRequest = async () => {
    const candidate =
      draftsRef.current[selected] ??
      workspaceRef.current.requests.find((r) => r.id === selected);
    if (!candidate) return;
    const r = bindRequestReferences(
      candidate,
      environmentContext(workspaceRef.current),
    );
    if (!r.name.trim()) {
      setError("Give the request a name before saving.");
      return;
    }
    const old = workspaceRef.current;
    const saved = await saveWorkspace(
      {
        ...old,
        requests: old.requests.some((x) => x.id === r.id)
          ? old.requests.map((x) => (x.id === r.id ? r : x))
          : [...old.requests, r],
        scenarios: old.scenarios.map((s) =>
          s.id === r.parentId && !s.requestIds.includes(r.id)
            ? { ...s, requestIds: [...s.requestIds, r.id] }
            : s,
        ),
      },
      { savedDraft: candidate },
    );
    if (!saved) return;
    if (JSON.stringify(draftsRef.current[r.id]) !== JSON.stringify(candidate))
      return;
    const next = { ...draftsRef.current };
    delete next[r.id];
    draftsRef.current = next;
    setDrafts(next);
    setNotice("Request saved");
  };
  const refreshHistory = async () =>
    setHistory(await store.history.orderBy("startedAt").reverse().toArray());
  const requestAccess = async (origins: string[]) => {
    if (!(await browser.permissions.request({ origins })))
      throw new Error(
        "Site access was not granted. Allow access to send this request.",
      );
  };
  async function send() {
    if (!current || busy) return;
    setError("");
    setBusy(true);
    setRunName("");
    const revision = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    const r = structuredClone(current);
    try {
      const snapshot = {
        ...w,
        requests: [...w.requests.filter((x) => x.id !== r.id), r],
      };
      const context = {
        ...environmentContext(snapshot),
        responses,
        referenceIds: bindRequestReferences(r, environmentContext(snapshot))
          .referenceIds,
      };
      const permission = requestAccess([
        parseHttpUrl(interpolate(r.url, context)).origin + "/*",
      ]);
      await permission;
      const compiled = await compileRequest(r, context, (id) =>
        store.getFile(id),
      );
      const result = await executeRequest(compiled, controller.signal);
      if (generation.current === revision)
        setResponses((prev) => ({ ...prev, [r.id]: result }));
      await store.addHistory(r, result, sensitiveValues(snapshot));
      await refreshHistory();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      abort.current = undefined;
    }
  }
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "s") {
          e.preventDefault();
          saveRequest();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          void send();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  async function run(s: Scenario) {
    if (busy) return;
    setBusy(true);
    setRunName(s.name);
    setError("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      await requestAccess(["http://*/*", "https://*/*"]);
      const snapshot = structuredClone(w);
      const secrets = sensitiveValues(snapshot);
      let lastSaved = 0;
      const finished = await runScenario(
        snapshot,
        s,
        environmentContext(snapshot),
        {
          signal: controller.signal,
          getFile: (id) => store.getFile(id),
          beforeSend: async (url) => {
            if (
              !(await browser.permissions.contains({
                origins: [new URL(url).origin + "/*"],
              }))
            )
              throw new Error("Host permission is missing or was revoked");
          },
          onProgress: (r) => {
            setReport(r);
            if (r.status === "running" && Date.now() - lastSaved < 1000) return;
            lastSaved = Date.now();
            const safe = redactReport(r, secrets);
            void store.reports.put(safe).catch(fail);
          },
        },
      );
      for (const step of finished.steps) {
        const request = snapshot.requests.find((r) => r.id === step.requestId);
        if (request) await store.addHistory(request, step.result, secrets);
      }
      await refreshHistory();
      const oldReports = await store.reports
        .orderBy("startedAt")
        .reverse()
        .offset(30)
        .primaryKeys();
      if (oldReports.length) await store.reports.bulkDelete(oldReports);
      setRunName("");
      setNotice("Run finished");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
      abort.current = undefined;
    }
  }
  const descendants = (id: string) => {
    const ids = new Set([id]);
    let change = true;
    while (change) {
      change = false;
      for (const n of w.nodes)
        if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
          ids.add(n.id);
          change = true;
        }
    }
    return ids;
  };
  const createNode = (kind: RepositoryNode["kind"]) => {
    const name = prompt(`New ${kind} name`);
    if (!name?.trim()) return;
    const id = uid();
    const parentId =
      kind === "project"
        ? undefined
        : node?.kind === "project" || node?.kind === "service"
          ? node.id
          : current?.parentId;
    const next = {
      ...w,
      nodes: [
        ...w.nodes,
        { id, name: name.trim(), kind, parentId, order: Date.now() },
      ],
    };
    if (kind === "scenario")
      next.scenarios = [
        ...w.scenarios,
        {
          id,
          name: name.trim(),
          requestIds: [],
          stopOnFailure: true,
          repeat: 1,
          delayMs: 0,
        },
      ];
    saveWorkspace(next);
    select(id);
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this item and its children? This cannot be undone."))
      return;
    const ids = descendants(id);
    const removedRequests = new Set(
      [...w.requests, ...Object.values(draftsRef.current)]
        .filter((r) => r.id === id || (r.parentId && ids.has(r.parentId)))
        .map((r) => r.id),
    );
    const saved = await saveWorkspace(
      {
        ...w,
        nodes: w.nodes.filter((n) => !ids.has(n.id)),
        requests: w.requests.filter((r) => !removedRequests.has(r.id)),
        scenarios: w.scenarios
          .filter((s) => !ids.has(s.id))
          .map((s) => ({
            ...s,
            requestIds: s.requestIds.filter((r) => !removedRequests.has(r)),
          })),
      },
      { removeDraftIds: [...removedRequests] },
    );
    if (!saved) return;
    const next = { ...draftsRef.current };
    for (const rid of removedRequests) {
      delete next[rid];
    }
    draftsRef.current = next;
    setDrafts(next);
    setOpenIds(openIds.filter((x) => !ids.has(x) && !removedRequests.has(x)));
    if (ids.has(selected) || removedRequests.has(selected)) setSelected("");
    setMenu(undefined);
  };
  const duplicate = (r: RequestDefinition) => {
    const copy = {
      ...structuredClone(r),
      id: uid(),
      name: r.name + " (copy)",
      order: Date.now(),
    };
    saveWorkspace({ ...w, requests: [...w.requests, copy] });
    select(copy.id);
  };
  const reorder = (id: string, delta: number) => {
    const entity = [...w.nodes, ...w.requests].find((x) => x.id === id);
    if (!entity) return;
    const siblings = [...w.nodes, ...w.requests]
      .filter((x) => x.parentId === entity.parentId)
      .sort((a, b) => a.order - b.order);
    const i = siblings.findIndex((x) => x.id === id);
    const other = i + delta;
    if (other < 0 || other >= siblings.length) return;
    [siblings[i], siblings[other]] = [siblings[other]!, siblings[i]!];
    const order = new Map(siblings.map((x, j) => [x.id, j]));
    saveWorkspace({
      ...w,
      nodes: w.nodes.map((x) =>
        order.has(x.id) ? { ...x, order: order.get(x.id)! } : x,
      ),
      requests: w.requests.map((x) =>
        order.has(x.id) ? { ...x, order: order.get(x.id)! } : x,
      ),
    });
  };
  const matches = (r: { name: string; url?: string }) =>
    (r.name + " " + (r.url ?? "")).toLowerCase().includes(search.toLowerCase());
  const updateCollapsed = (next: Set<string>) => {
    setCollapsed(next);
    void browser.storage.local
      .set({ collapsedNodeIds: [...next] })
      .catch((e) => fail("Could not save folder state: " + errorText(e)));
  };
  function tree(parentId?: string, depth = 0): React.ReactNode {
    return [
      ...w.nodes.filter((n) => n.parentId === parentId),
      ...w.requests.filter((r) => r.parentId === parentId),
    ]
      .sort((a, b) => a.order - b.order)
      .map((item) => {
        const isNode = "kind" in item;
        const expanded = !!search || !collapsed.has(item.id);
        const childIds = isNode ? descendants(item.id) : new Set<string>();
        const visible =
          matches(item) ||
          (isNode &&
            w.requests.some(
              (r) => r.parentId && childIds.has(r.parentId) && matches(r),
            ));
        if (search && !visible) return null;
        return (
          <div key={item.id}>
            <div
              className={"tree-row " + (selected === item.id ? "selected" : "")}
              style={{ paddingLeft: 12 + depth * 15 }}
            >
              {isNode && (
                <button
                  className="tree-toggle"
                  aria-label="Toggle folder"
                  aria-expanded={expanded}
                  disabled={!!search}
                  title={
                    search
                      ? "Clear search to change folder state"
                      : `${expanded ? "Collapse" : "Expand"} ${item.name}`
                  }
                  onClick={() => {
                    const next = new Set(collapsed);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    updateCollapsed(next);
                  }}
                >
                  {expanded ? (
                    <ChevronDown size={13} />
                  ) : (
                    <ChevronRight size={13} />
                  )}
                </button>
              )}
              <button className="tree-label" onClick={() => select(item.id)}>
                {isNode ? (
                  item.kind === "scenario" ? (
                    <GitBranch size={15} />
                  ) : expanded ? (
                    <FolderOpen size={15} />
                  ) : (
                    <Folder size={15} />
                  )
                ) : (
                  <span className={"method " + item.method.toLowerCase()}>
                    {item.method}
                  </span>
                )}
                <span className="truncate">{item.name}</span>
              </button>
              <button
                className="tree-menu-button"
                title="Item actions"
                onClick={() => setMenu(menu === item.id ? undefined : item.id)}
              >
                ⋮
              </button>
            </div>
            {menu === item.id && (
              <div className="tree-menu">
                <Button
                  onClick={() => {
                    const name = prompt("Rename", item.name);
                    if (name?.trim()) {
                      if (isNode)
                        saveWorkspace({
                          ...w,
                          nodes: w.nodes.map((n) =>
                            n.id === item.id ? { ...n, name: name.trim() } : n,
                          ),
                          scenarios: w.scenarios.map((s) =>
                            s.id === item.id ? { ...s, name: name.trim() } : s,
                          ),
                        });
                      else {
                        const renamed = { ...item, name: name.trim() };
                        saveWorkspace({
                          ...w,
                          requests: w.requests.map((r) =>
                            r.id === item.id ? renamed : r,
                          ),
                        });
                        if (drafts[item.id])
                          edit({ ...drafts[item.id]!, name: name.trim() });
                      }
                    }
                    setMenu(undefined);
                  }}
                >
                  Rename
                </Button>
                {!isNode && (
                  <Button onClick={() => duplicate(item)}>
                    <Copy size={13} /> Duplicate
                  </Button>
                )}
                <Button
                  onClick={() => {
                    setMoveId(item.id);
                    setMoveParent(item.parentId ?? "");
                    setMenu(undefined);
                  }}
                >
                  <MoveRight size={13} /> Move
                </Button>
                <Button title="Move up" onClick={() => reorder(item.id, -1)}>
                  <ArrowUp size={13} />
                </Button>
                <Button title="Move down" onClick={() => reorder(item.id, 1)}>
                  <ArrowDown size={13} />
                </Button>
                <Button onClick={() => remove(item.id)}>
                  <Trash2 size={13} />
                </Button>
              </div>
            )}
            {isNode && expanded && tree(item.id, depth + 1)}
          </div>
        );
      });
  }
  const selectedScenario = w.scenarios.find((s) => s.id === selected);
  const nodeRequests = node
    ? w.requests.filter(
        (r) => r.parentId && descendants(node.id).has(r.parentId),
      )
    : [];
  if (!loaded)
    return <div className="loading">Opening your local workspace…</div>;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            a<span>›</span>
          </span>
          <strong>apiman</strong>
          <span className="edition">API TESTER</span>
        </div>
        <nav>
          <button
            className={!node || node.kind !== "scenario" ? "active" : ""}
            onClick={() => {
              if (current) select(current.id);
              else if (w.requests[0]) select(w.requests[0].id);
            }}
          >
            REQUESTS
          </button>
          <button
            className={node?.kind === "scenario" ? "active" : ""}
            onClick={() => {
              const first = w.scenarios[0];
              if (first) select(first.id);
              else createNode("scenario");
            }}
          >
            SCENARIOS
          </button>
        </nav>
        <div className="grow" />
        <span className="local-badge">
          <span /> LOCAL WORKSPACE
        </span>
        <Button
          title="Help and keyboard shortcuts"
          onClick={() => setDialog("help")}
        >
          ?
        </Button>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-tabs">
            <button
              className={sidebar === "history" ? "active" : ""}
              onClick={() => setSidebar("history")}
            >
              <History size={15} /> HISTORY
            </button>
            <button
              className={sidebar === "repository" ? "active" : ""}
              onClick={() => setSidebar("repository")}
            >
              <Database size={15} /> REPOSITORY
            </button>
          </div>
          <div className="sidebar-search">
            <Search size={15} />
            <input
              aria-label="Search repository"
              placeholder={
                sidebar === "history" ? "Search history…" : "Search repository…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="sidebar-actions">
            <Button
              className="primary"
              aria-label="New request"
              onClick={() => create(node?.id ?? current?.parentId)}
            >
              <Plus size={16} /> Request
            </Button>
            <select
              aria-label="Create item"
              value=""
              onChange={(e) => {
                if (e.target.value)
                  createNode(e.target.value as RepositoryNode["kind"]);
              }}
            >
              <option value="">Create…</option>
              <option value="project">Project</option>
              <option value="service">Service</option>
              <option value="scenario">Scenario</option>
            </select>
          </div>
          {sidebar === "repository" && (
            <div
              className="tree-controls"
              role="group"
              aria-label="Repository folders"
            >
              <Button
                aria-label="Expand all folders"
                title={
                  search
                    ? "Clear search to expand all folders"
                    : "Expand all folders"
                }
                disabled={!!search || !w.nodes.some((n) => collapsed.has(n.id))}
                onClick={() => updateCollapsed(new Set())}
              >
                <ChevronsUpDown size={14} /> Expand all
              </Button>
              <Button
                aria-label="Collapse all folders"
                title={
                  search
                    ? "Clear search to collapse all folders"
                    : "Collapse all folders"
                }
                disabled={
                  !!search || !w.nodes.some((n) => !collapsed.has(n.id))
                }
                onClick={() =>
                  updateCollapsed(new Set(w.nodes.map((n) => n.id)))
                }
              >
                <ChevronsDownUp size={14} /> Collapse all
              </Button>
            </div>
          )}
          <div className="tree">
            {sidebar === "repository" ? (
              w.requests.length || w.nodes.length ? (
                tree()
              ) : (
                <div className="sidebar-empty">
                  <FolderOpen size={30} />
                  <p>Your repository is empty</p>
                  <small>
                    Create a request or import your Talend repository to get
                    started.
                  </small>
                  <Button
                    className="text-button"
                    onClick={() => setDialog("import")}
                  >
                    <Upload size={14} /> Import repository
                  </Button>
                </div>
              )
            ) : (
              <>
                {history
                  .filter((h) =>
                    matches({ name: h.request.name, url: h.result.url }),
                  )
                  .map((h) => (
                    <button
                      className="history-row"
                      key={h.id}
                      onClick={() => {
                        const r = {
                          ...h.request,
                          id: uid(),
                          name: h.request.name + " (history)",
                        };
                        edit(r);
                        select(r.id);
                        setResponses((prev) => ({
                          ...prev,
                          [r.id]: { ...h.result, requestId: r.id },
                        }));
                        setNotice(
                          "History replay omits stored credentials. Configure authentication before sending.",
                        );
                      }}
                    >
                      <div>
                        <span
                          className={"method " + h.result.method.toLowerCase()}
                        >
                          {h.result.method}
                        </span>
                        <span className="truncate">{h.request.name}</span>
                        <span
                          className={
                            h.result.status < 400 ? "passed" : "failed"
                          }
                        >
                          {h.result.status || "ERR"}
                        </span>
                      </div>
                      <small className="truncate">{h.result.url}</small>
                      <small>{new Date(h.startedAt).toLocaleString()}</small>
                    </button>
                  ))}
                {history.length > 0 && (
                  <Button
                    className="text-button"
                    onClick={async () => {
                      if (confirm("Clear all request history?")) {
                        await store.history.clear();
                        await refreshHistory();
                      }
                    }}
                  >
                    <Trash2 size={14} /> Clear history
                  </Button>
                )}
                {!history.length && (
                  <p className="sidebar-empty">Sent requests appear here.</p>
                )}
              </>
            )}
          </div>
          <footer className="sidebar-footer">
            <Button aria-label="Import" onClick={() => setDialog("import")}>
              <Upload size={15} /> Import
            </Button>
            <Button aria-label="Export" onClick={() => setDialog("export")}>
              <Download size={15} /> Export
            </Button>
          </footer>
        </aside>
        <main>
          <div className="workspace-toolbar">
            <div className="document-tabs">
              {openIds.map((id) => {
                const item =
                  drafts[id] ??
                  w.requests.find((r) => r.id === id) ??
                  w.nodes.find((n) => n.id === id);
                if (!item) return null;
                return (
                  <div
                    key={id}
                    className={
                      "document-tab " + (id === selected ? "active" : "")
                    }
                  >
                    <button onClick={() => select(id)}>
                      {"method" in item && (
                        <span className={"method " + item.method.toLowerCase()}>
                          {item.method}
                        </span>
                      )}
                      <span className="truncate">{item.name}</span>
                      {drafts[id] && <span className="draft-dot" />}
                    </button>
                    <button
                      title="Close tab"
                      onClick={() => {
                        setOpenIds((ids) => ids.filter((x) => x !== id));
                        if (selected === id)
                          setSelected(openIds.find((x) => x !== id) ?? "");
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
              <Button title="New request tab" onClick={() => create()}>
                <Plus size={17} />
              </Button>
            </div>
            <div className="environment-selector">
              <Globe size={15} />
              <select
                aria-label="Active environment"
                disabled={busy}
                value={w.activeEnvironmentId ?? ""}
                onChange={(e) =>
                  saveWorkspace({
                    ...w,
                    activeEnvironmentId: e.target.value || undefined,
                  })
                }
              >
                <option value="">No environment</option>
                {w.environments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <Button
                title="Manage environments"
                onClick={() => setDialog("environments")}
              >
                <Settings2 size={17} />
              </Button>
            </div>
          </div>
          {urlRepairs && (
            <div
              className="warning-banner"
              data-testid="url-repair-notice"
              role="status"
            >
              <div className="inline">
                <span className="grow">
                  Repaired {urlRepairs.repaired.length} previously imported
                  Talend URL(s). {urlRepairs.review.length} request(s) need
                  manual review.
                </span>
                <Button
                  title="Dismiss URL repair notice"
                  onClick={() => setUrlRepairs(undefined)}
                >
                  <X size={15} />
                </Button>
              </div>
              {urlRepairs.review.length > 0 && (
                <details>
                  <summary>Review preserved requests and drafts</summary>
                  <p>
                    Only unchanged URLs confirmed by their original Talend data
                    were repaired. Review these items before sending or saving.
                    Re-importing the repository would create duplicates.
                  </p>
                  <ul>
                    {urlRepairs.review.map((item) => (
                      <li key={item.id}>
                        <Button
                          className="text-button"
                          onClick={() => select(item.id)}
                        >
                          {item.name}
                        </Button>
                        {" — "}
                        {item.reason === "draft"
                          ? "Unsaved draft preserved"
                          : item.reason === "modified"
                            ? "Modified URL preserved"
                            : "Original Talend URL could not be verified"}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {error && (
            <div className="global-error">
              <AlertCircle size={17} />
              <span>{error}</span>
              <Button title="Dismiss error" onClick={() => setError("")}>
                <X size={15} />
              </Button>
            </div>
          )}
          <div className="main-content">
            {current ? (
              <RequestPanel
                key={current.id}
                request={current}
                onChange={edit}
                onSave={saveRequest}
                onSend={() => void send()}
                onCancel={() => abort.current?.abort()}
                busy={busy}
                dirty={dirty}
                workspace={w}
                result={responses[current.id]}
                responseCache={responses}
                onExpression={() => setDialog("expression")}
                onError={setError}
                onNewRequest={(request) => {
                  edit(request);
                  select(request.id);
                }}
              />
            ) : node ? (
              <>
                <div className="container-heading">
                  <div>
                    <span className="eyebrow">{node.kind.toUpperCase()}</span>
                    <h1>{node.name}</h1>
                  </div>
                  <div className="grow" />
                  <Button onClick={() => create(node.id)}>
                    <Plus size={16} /> Add request
                  </Button>
                  <Button
                    className="send"
                    disabled={!selectedScenario && !nodeRequests.length}
                    onClick={() =>
                      busy
                        ? abort.current?.abort()
                        : void run(
                            selectedScenario ?? {
                              id: uid(),
                              name: node.name,
                              requestIds: [...nodeRequests]
                                .sort((a, b) => a.name.localeCompare(b.name))
                                .map((r) => r.id),
                              repeat: 1,
                              delayMs: 0,
                              stopOnFailure: false,
                            },
                          )
                    }
                  >
                    {busy ? <Square size={15} /> : <Play size={15} />}{" "}
                    {busy ? "Cancel" : "Run"}
                  </Button>
                </div>
                {selectedScenario ? (
                  <ScenarioSettings
                    scenario={selectedScenario}
                    workspace={w}
                    onChange={(s) =>
                      saveWorkspace({
                        ...w,
                        scenarios: w.scenarios.map((x) =>
                          x.id === s.id ? s : x,
                        ),
                      })
                    }
                  />
                ) : (
                  <div className="container-requests">
                    {nodeRequests.map((r) => (
                      <button key={r.id} onClick={() => select(r.id)}>
                        <span className={"method " + r.method.toLowerCase()}>
                          {r.method}
                        </span>
                        <strong>{r.name}</strong>
                        <span className="truncate">{r.url}</span>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                    {!nodeRequests.length && (
                      <Empty title="Organize your API">
                        Add requests to this {node.kind}, or move existing
                        requests here.
                      </Empty>
                    )}
                  </div>
                )}
                {report && <RunResults report={report} workspace={w} />}
              </>
            ) : (
              <div className="welcome">
                <div className="welcome-icon">{"{ }"}</div>
                <span className="eyebrow">YOUR APIS. YOUR WORKSPACE.</span>
                <h1>Make your next request.</h1>
                <p>
                  A familiar place to build, organize and test your APIs.
                  <br />
                  Everything stays in this browser.
                </p>
                <div className="welcome-actions">
                  <Button className="primary" onClick={() => create()}>
                    <Plus size={17} /> Create a request
                  </Button>
                  <Button onClick={() => setDialog("import")}>
                    <Upload size={17} /> Import repository
                  </Button>
                </div>
                <div className="welcome-features">
                  <div>
                    <Database size={20} />
                    <strong>Bring your work</strong>
                    <span>
                      Talend, Postman, OpenAPI,
                      <br />
                      HAR and cURL imports.
                    </span>
                  </div>
                  <div>
                    <Globe size={20} />
                    <strong>Switch environments</strong>
                    <span>
                      Reusable variables and
                      <br />
                      private credentials.
                    </span>
                  </div>
                  <div>
                    <CheckCircle2 size={20} />
                    <strong>Test the whole flow</strong>
                    <span>
                      Assertions and scenarios
                      <br />
                      with linked responses.
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <footer className="statusbar">
            <span>
              <span className="status-dot" /> Stored locally
            </span>
            <span>
              {busy
                ? `Running ${runName || "request"}…`
                : `${w.requests.length} requests · ${w.environments.length} environments`}
            </span>
            <span className="grow" />
            <span>Ctrl/⌘ + Enter: Send</span>
            <span>Ctrl/⌘ + S: Save</span>
          </footer>
        </main>
      </div>
      {notice && (
        <div className="toast">
          <CheckCircle2 size={17} />
          {notice}
        </div>
      )}
      {dialog === "environments" && (
        <EnvironmentsDialog
          workspace={w}
          onChange={saveWorkspace}
          onClose={() => setDialog("")}
        />
      )}
      {dialog === "import" && (
        <ImportDialog
          onClose={() => setDialog("")}
          onImport={async (r) => {
            await queue.current;
            const next = mergeWorkspace(workspaceRef.current, r.workspace);
            await store.save(next);
            workspaceRef.current = next;
            setW(next);
            setSidebar("repository");
            setSearch("");
            setNotice(`Imported ${r.workspace.requests.length} requests`);
          }}
        />
      )}
      {dialog === "export" && (
        <ExportDialog workspace={w} onClose={() => setDialog("")} />
      )}
      {dialog === "expression" && (
        <ExpressionDialog
          workspace={w}
          responses={responses}
          onClose={() => setDialog("")}
        />
      )}
      {dialog === "help" && (
        <Modal title="About apiman" onClose={() => setDialog("")}>
          <p>
            Local-first API management and testing for Chrome, Firefox and Zen.
          </p>
          <p>
            <kbd>Ctrl/⌘ Enter</kbd> Send request · <kbd>Ctrl/⌘ S</kbd> Save
          </p>
          <p>
            Use {'${"variable"}'} for environment values. Reference a previous
            request with{" "}
            {'${"Request name"."response"."body".jsonPath("$.id")}'}.
          </p>
          <p>
            Host access is requested when you send a request. Scenario runs
            request HTTP/HTTPS access because later URLs may depend on earlier
            responses.
          </p>
          <p>
            Keep this tab open while running. Closing it interrupts requests.
            Back up your workspace before uninstalling the extension.
          </p>
          <p className="section-note">
            Browser certificate trust, redirects, cookie policies and restricted
            headers apply. Private values are masked in history; local storage
            is not an encrypted vault.
          </p>
          <Button
            onClick={() => {
              setDialog("export");
            }}
          >
            Back up workspace
          </Button>
        </Modal>
      )}
      {moveId && (
        <Modal title="Move item" onClose={() => setMoveId("")}>
          <label className="field">
            Destination
            <select
              value={moveParent}
              onChange={(e) => setMoveParent(e.target.value)}
            >
              <option value="">Repository root</option>
              {w.nodes
                .filter((n) => !descendants(moveId).has(n.id))
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="modal-actions">
            <Button onClick={() => setMoveId("")}>Cancel</Button>
            <Button
              className="primary"
              onClick={() => {
                saveWorkspace({
                  ...w,
                  nodes: w.nodes.map((n) =>
                    n.id === moveId
                      ? { ...n, parentId: moveParent || undefined }
                      : n,
                  ),
                  scenarios: w.scenarios.map((s) =>
                    s.id === moveParent &&
                    w.requests.some((r) => r.id === moveId) &&
                    !s.requestIds.includes(moveId)
                      ? { ...s, requestIds: [...s.requestIds, moveId] }
                      : s,
                  ),
                  requests: w.requests.map((r) =>
                    r.id === moveId
                      ? { ...r, parentId: moveParent || undefined }
                      : r,
                  ),
                });
                setMoveId("");
              }}
            >
              Move
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
