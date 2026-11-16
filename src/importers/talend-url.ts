import type { RequestDefinition, Workspace } from "../core/model";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}
function schemeName(uri: RecordValue): string {
  const name =
    typeof uri.scheme === "string" ? uri.scheme : record(uri.scheme)?.name;
  return typeof name === "string" ? name.trim().toLowerCase() : "";
}
function authorityAndPath(uri: RecordValue): string {
  const port = uri.port ? ":" + String(uri.port) : "";
  const fragment = uri.fragment ? "#" + String(uri.fragment) : "";
  return `${uri.host ?? ""}${port}${uri.path ?? ""}${fragment}`;
}

/** Keep a missing scheme missing; the environment can supply the complete origin. */
export function talendUrl(uri: RecordValue): string {
  const scheme = schemeName(uri);
  return (scheme ? scheme + "://" : "") + authorityAndPath(uri);
}

export type TalendUrlRepairReport = {
  repaired: { id: string; name: string }[];
  review: {
    id: string;
    name: string;
    reason: "draft" | "modified" | "unverified";
  }[];
};

function legacyUrls(
  source: unknown,
): { previous: string; corrected: string } | "explicit" | undefined {
  const entity = record(source);
  const uri = record(entity?.uri);
  if (entity?.type !== "Request" || !uri) return;
  if (schemeName(uri)) return "explicit";
  // Only reconstruct source shapes whose original URL semantics are unambiguous.
  const scheme = record(uri.scheme);
  if (
    typeof uri.host !== "string" ||
    (uri.path != null && typeof uri.path !== "string") ||
    (uri.fragment != null && typeof uri.fragment !== "string") ||
    (uri.port != null &&
      typeof uri.port !== "string" &&
      typeof uri.port !== "number") ||
    (uri.scheme != null && !scheme && uri.scheme !== "") ||
    (scheme?.name != null && typeof scheme.name !== "string") ||
    (scheme?.secure != null && typeof scheme.secure !== "boolean")
  )
    return;
  // Reproduce the old importer's exact output, including its incorrect default.
  const oldScheme = String(
    scheme?.name ?? (scheme?.secure ? "https" : "http"),
  ).toLowerCase();
  return {
    previous: oldScheme + "://" + authorityAndPath(uri),
    corrected: talendUrl(uri),
  };
}

/** Never overwrite a draft or a saved URL that differs from the old import output. */
export function repairTalendUrls(
  workspace: Workspace,
  drafts: RequestDefinition[],
): {
  workspace: Workspace;
  report: TalendUrlRepairReport;
} {
  const report: TalendUrlRepairReport = { repaired: [], review: [] };
  const protectedIds = new Set(drafts.map((r) => r.id));
  const reviewIds = new Set<string>();
  const review = (
    r: RequestDefinition,
    reason: TalendUrlRepairReport["review"][number]["reason"],
  ) => {
    if (reviewIds.has(r.id)) return;
    report.review.push({ id: r.id, name: r.name, reason });
    reviewIds.add(r.id);
  };
  const inspect = (
    r: RequestDefinition,
    isDraft: boolean,
  ): RequestDefinition => {
    const urls = legacyUrls(r.source);
    if (urls === "explicit") return r;
    if (!urls) {
      if (/^https?:\/\/(?:\$\{|https?:\/\/)/i.test(r.url))
        review(r, isDraft ? "draft" : "unverified");
      return r;
    }
    if (r.url === urls.corrected) return r;
    if (isDraft || protectedIds.has(r.id)) review(r, "draft");
    else if (r.url !== urls.previous) review(r, "modified");
    else {
      report.repaired.push({ id: r.id, name: r.name });
      return { ...r, url: urls.corrected };
    }
    return r;
  };
  const requests = workspace.requests.map((r) => inspect(r, false));
  for (const draft of drafts) inspect(draft, true);
  return { workspace: { ...workspace, requests }, report };
}
