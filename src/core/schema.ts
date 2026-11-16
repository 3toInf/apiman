import { z } from "zod/v3";
import type { Workspace } from "./model";
const pair = z.object({
  id: z.string(),
  name: z.string(),
  value: z.string(),
  enabled: z.boolean(),
  fileId: z.string().optional(),
  fileName: z.string().optional(),
});
const assertion = z.object({
  id: z.string(),
  target: z.enum([
    "status",
    "statusText",
    "header",
    "body",
    "size",
    "duration",
    "json",
    "xml",
  ]),
  selector: z.string(),
  operator: z.enum([
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
  ]),
  expected: z.string(),
  enabled: z.boolean(),
});
const request = z.object({
  referenceIds: z.record(z.string()).optional(),
  id: z.string(),
  name: z.string(),
  parentId: z.string().optional(),
  method: z.string(),
  url: z.string(),
  query: z.array(pair),
  headers: z.array(pair),
  body: z.object({
    type: z.enum([
      "none",
      "json",
      "xml",
      "text",
      "urlencoded",
      "multipart",
      "binary",
    ]),
    text: z.string(),
    fields: z.array(pair),
    fileId: z.string().optional(),
    fileName: z.string().optional(),
  }),
  auth: z.object({
    type: z.enum(["none", "basic", "bearer", "apikey"]),
    username: z.string().optional(),
    password: z.string().optional(),
    token: z.string().optional(),
    name: z.string().optional(),
    value: z.string().optional(),
    location: z.enum(["header", "query"]).optional(),
  }),
  assertions: z.array(assertion),
  timeoutMs: z.number().positive(),
  maxResponseBytes: z.number().positive(),
  cookies: z.boolean(),
  description: z.string(),
  unsupported: z.array(z.string()),
  source: z.unknown().optional(),
  order: z.number(),
});
const workspace = z.object({
  format: z.literal("apiman"),
  schemaVersion: z.literal(1),
  nodes: z.array(
    z.object({
      id: z.string(),
      parentId: z.string().optional(),
      kind: z.enum(["project", "service", "scenario"]),
      name: z.string(),
      order: z.number(),
    }),
  ),
  requests: z.array(request),
  environments: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      variables: z.array(pair.extend({ private: z.boolean() })),
    }),
  ),
  scenarios: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      requestIds: z.array(z.string()),
      stopOnFailure: z.boolean(),
      repeat: z.number().int().positive().max(10000),
      delayMs: z.number().nonnegative(),
    }),
  ),
  activeEnvironmentId: z.string().optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        type: z.string(),
        base64: z.string(),
      }),
    )
    .optional(),
});
export function validateWorkspace(value: unknown): Workspace {
  const parsed = workspace.parse(value);
  const all = [...parsed.nodes, ...parsed.requests];
  const ids = new Set<string>();
  for (const item of all) {
    if (ids.has(item.id)) throw new Error("Duplicate repository ID");
    ids.add(item.id);
  }
  const nodes = new Map(parsed.nodes.map((n) => [n.id, n]));
  for (const item of all) {
    const seen = new Set([item.id]);
    let parent = item.parentId;
    while (parent) {
      if (!nodes.has(parent)) throw new Error("Missing parent in repository");
      if (seen.has(parent)) throw new Error("Cyclic repository hierarchy");
      seen.add(parent);
      parent = nodes.get(parent)?.parentId;
    }
  }
  for (const s of parsed.scenarios) {
    if (!nodes.has(s.id)) throw new Error("Missing scenario node");
    if (s.requestIds.some((id) => !parsed.requests.some((r) => r.id === id)))
      throw new Error("Missing scenario request");
  }
  return parsed;
}
