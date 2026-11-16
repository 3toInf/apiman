import Dexie, { type EntityTable } from "dexie";
import {
  newWorkspace,
  uid,
  type Workspace,
  type RequestDefinition,
  type ExecutionResult,
  type RunReport,
} from "../core/model";
import { validateWorkspace } from "../core/schema";
import { redactTree } from "../importers";
import {
  repairTalendUrls,
  type TalendUrlRepairReport,
} from "../importers/talend-url";
export type HistoryEntry = {
  id: string;
  request: RequestDefinition;
  result: ExecutionResult;
  startedAt: number;
};
export class WorkspaceStore extends Dexie {
  snapshots!: EntityTable<{ id: string; workspace: Workspace }, "id">;
  history!: EntityTable<HistoryEntry, "id">;
  files!: EntityTable<{ id: string; name: string; blob: Blob }, "id">;
  reports!: EntityTable<RunReport, "id">;
  drafts!: EntityTable<{ id: string; request: RequestDefinition }, "id">;
  constructor(name = "apiman") {
    super(name);
    this.version(1).stores({
      snapshots: "id",
      history: "id, startedAt",
      files: "id",
      reports: "id, startedAt",
      drafts: "id",
    });
  }
  async load(onRepairs?: (report: TalendUrlRepairReport) => void) {
    const restored = await this.transaction(
      "rw",
      this.snapshots,
      this.drafts,
      async () => {
        const row = await this.snapshots.get("main");
        const drafts = await this.drafts.toArray();
        const repair = repairTalendUrls(
          row ? validateWorkspace(row.workspace) : newWorkspace(),
          drafts.map((d) => d.request),
        );
        if (row && repair.report.repaired.length)
          await this.snapshots.put({
            id: "main",
            workspace: validateWorkspace(repair.workspace),
          });
        return {
          workspace: row ? repair.workspace : undefined,
          report: repair.report,
        };
      },
    );
    onRepairs?.(restored.report);
    return restored.workspace;
  }
  async save(
    workspace: Workspace,
    options: { savedDraft?: RequestDefinition; removeDraftIds?: string[] } = {},
  ) {
    const validated = validateWorkspace(workspace);
    await this.transaction(
      "rw",
      this.snapshots,
      this.files,
      this.drafts,
      async () => {
        if (workspace.attachments) {
          for (const f of workspace.attachments) {
            const bytes = Uint8Array.from(atob(f.base64), (c) =>
              c.charCodeAt(0),
            );
            await this.files.put({
              id: f.id,
              name: f.name,
              blob: new Blob([bytes], { type: f.type }),
            });
          }
        }
        if (options.savedDraft) {
          const current = await this.drafts.get(options.savedDraft.id);
          if (
            current &&
            JSON.stringify(current.request) ===
              JSON.stringify(options.savedDraft)
          )
            await this.drafts.delete(current.id);
        }
        if (options.removeDraftIds?.length)
          await this.drafts.bulkDelete(options.removeDraftIds);
        delete validated.attachments;
        await this.snapshots.put({ id: "main", workspace: validated });
      },
    );
  }
  async addFile(file: File) {
    const id = uid();
    await this.files.put({ id, name: file.name, blob: file });
    return id;
  }
  async getFile(id: string) {
    return (await this.files.get(id))?.blob;
  }
  async addHistory(
    request: RequestDefinition,
    result: ExecutionResult,
    secrets: string[],
  ) {
    const safe = redactTree(request, secrets);
    safe.source = undefined;
    safe.auth = { type: "none" };
    safe.headers = safe.headers.map((h) =>
      /^(authorization|cookie|x-api-key|api-key)$/i.test(h.name)
        ? { ...h, value: "", enabled: false }
        : h,
    );
    await this.transaction("rw", this.history, async () => {
      await this.history.put({
        id: result.id,
        request: safe,
        result: redactResult(result, secrets),
        startedAt: result.startedAt,
      });
      const count = await this.history.count();
      if (count > 500)
        await this.history.bulkDelete(
          await this.history
            .orderBy("startedAt")
            .limit(count - 500)
            .primaryKeys(),
        );
    });
  }
  async backup(w: Workspace, includeAttachments: boolean) {
    const copy = structuredClone(w);
    if (includeAttachments) {
      copy.attachments = [];
      const ids = new Set(
        w.requests
          .flatMap((r) => [
            r.body.fileId,
            ...r.body.fields.map((f) => f.fileId),
          ])
          .filter((id): id is string => !!id),
      );
      for (const id of ids) {
        const f = await this.files.get(id);
        if (!f) continue;
        const a = new Uint8Array(await f.blob.arrayBuffer());
        let bytes = "";
        for (let i = 0; i < a.length; i += 32768)
          bytes += String.fromCharCode(...a.subarray(i, i + 32768));
        copy.attachments.push({
          id,
          name: f.name,
          type: f.blob.type,
          base64: btoa(bytes),
        });
      }
    }
    return copy;
  }
}
export function executionSecrets(
  result: ExecutionResult,
  secrets: string[],
): string[] {
  const found = [...secrets];
  for (const [name, value] of [
    ...result.headers,
    ...(result.requestHeaders ?? []),
  ]) {
    if (
      value &&
      /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(
        name ?? "",
      )
    ) {
      found.push(value);
      if (/authorization$/i.test(name ?? ""))
        found.push(value.replace(/^\S+\s+/, ""));
    }
  }
  return [...new Set(found.filter(Boolean))];
}
export function redactReport(report: RunReport, secrets: string[]): RunReport {
  const all = [
    ...new Set(
      report.steps.flatMap((step) => executionSecrets(step.result, secrets)),
    ),
  ];
  return redactTree(
    {
      ...report,
      steps: report.steps.map((step) => ({
        ...step,
        result: redactResult(step.result, all),
      })),
    },
    all,
  );
}
export function redactResult(
  result: ExecutionResult,
  secrets: string[],
): ExecutionResult {
  const rest = { ...result };
  delete rest.blob;
  const safe = redactTree(rest, executionSecrets(result, secrets));
  for (const list of [safe.headers, safe.requestHeaders ?? []])
    for (const h of list)
      if (
        /^(authorization|proxy-authorization|set-cookie|cookie|x-api-key|api-key)$/i.test(
          h[0] ?? "",
        )
      )
        h[1] = "••••";
  try {
    const u = new URL(safe.url);
    for (const key of [...u.searchParams.keys()])
      if (/token|secret|password|api.?key/i.test(key))
        u.searchParams.set(key, "••••");
    safe.url = u.href;
  } catch {
    /* Non-URL failure metadata is preserved. */
  }
  if (safe.body.length > 1024 * 1024) {
    safe.body = safe.body.slice(0, 1024 * 1024);
    safe.truncated = true;
  }
  return safe;
}
export function mergeWorkspace(
  existing: Workspace,
  incoming: Workspace,
): Workspace {
  const merged = structuredClone(existing);
  const copy = structuredClone(incoming);
  const map = new Map<string, string>();
  for (const e of [
    ...copy.nodes,
    ...copy.requests,
    ...copy.environments,
    ...(copy.attachments ?? []),
  ])
    map.set(e.id, uid());
  for (const r of copy.requests)
    for (const id of [r.body.fileId, ...r.body.fields.map((f) => f.fileId)])
      if (id && !map.has(id)) map.set(id, uid());
  const remap = (id: string | undefined) =>
    id ? (map.get(id) ?? id) : undefined;
  for (const n of copy.nodes) {
    n.id = remap(n.id)!;
    n.parentId = remap(n.parentId);
  }
  for (const r of copy.requests) {
    if (r.referenceIds)
      r.referenceIds = Object.fromEntries(
        Object.entries(r.referenceIds).map(([key, id]) => [key, remap(id)!]),
      );
    r.id = remap(r.id)!;
    r.parentId = remap(r.parentId);
    r.body.fileId = remap(r.body.fileId);
    for (const f of r.body.fields) f.fileId = remap(f.fileId);
  }
  for (const e of copy.environments) e.id = remap(e.id)!;
  for (const s of copy.scenarios) {
    s.id = remap(s.id)!;
    s.requestIds = s.requestIds.map((id) => remap(id)!);
  }
  for (const f of copy.attachments ?? []) f.id = remap(f.id)!;
  merged.nodes.push(...copy.nodes);
  merged.requests.push(...copy.requests);
  merged.environments.push(...copy.environments);
  merged.scenarios.push(...copy.scenarios);
  if (copy.attachments)
    merged.attachments = [...(merged.attachments ?? []), ...copy.attachments];
  merged.activeEnvironmentId ??= remap(copy.activeEnvironmentId);
  return validateWorkspace(merged);
}
export const store = new WorkspaceStore();
export async function initialWorkspace() {
  return (await store.load()) ?? newWorkspace();
}
