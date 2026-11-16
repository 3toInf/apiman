export type Pair = {
  id: string;
  name: string;
  value: string;
  enabled: boolean;
  fileId?: string;
  fileName?: string;
};
export type Variable = Pair & { private: boolean };
export type Environment = { id: string; name: string; variables: Variable[] };
export type BodyType =
  "none" | "json" | "xml" | "text" | "urlencoded" | "multipart" | "binary";
export type Auth = {
  type: "none" | "basic" | "bearer" | "apikey";
  username?: string;
  password?: string;
  token?: string;
  name?: string;
  value?: string;
  location?: "header" | "query";
};
export type AssertionTarget =
  | "status"
  | "statusText"
  | "header"
  | "body"
  | "size"
  | "duration"
  | "json"
  | "xml";
export type Operator =
  | "equals"
  | "notEquals"
  | "greater"
  | "greaterOrEqual"
  | "less"
  | "lessOrEqual"
  | "exists"
  | "notExists"
  | "contains"
  | "notContains"
  | "matches"
  | "lengthEquals"
  | "lengthGreaterOrEqual"
  | "lengthLessOrEqual";
export type Assertion = {
  id: string;
  target: AssertionTarget;
  selector: string;
  operator: Operator;
  expected: string;
  enabled: boolean;
};
export type RequestDefinition = {
  id: string;
  name: string;
  parentId?: string;
  method: string;
  url: string;
  query: Pair[];
  headers: Pair[];
  body: {
    type: BodyType;
    text: string;
    fields: Pair[];
    fileId?: string;
    fileName?: string;
  };
  auth: Auth;
  assertions: Assertion[];
  timeoutMs: number;
  maxResponseBytes: number;
  cookies: boolean;
  referenceIds?: Record<string, string>;
  description: string;
  unsupported: string[];
  source?: unknown;
  order: number;
};
export type RepositoryNode = {
  id: string;
  parentId?: string;
  kind: "project" | "service" | "scenario";
  name: string;
  order: number;
};
export type Scenario = {
  id: string;
  name: string;
  requestIds: string[];
  stopOnFailure: boolean;
  repeat: number;
  delayMs: number;
};
export type Workspace = {
  format: "apiman";
  schemaVersion: 1;
  nodes: RepositoryNode[];
  requests: RequestDefinition[];
  environments: Environment[];
  scenarios: Scenario[];
  activeEnvironmentId?: string;
  attachments?: { id: string; name: string; type: string; base64: string }[];
};
export type RequestError = {
  kind:
    | "timeout"
    | "cancelled"
    | "network"
    | "size"
    | "configuration"
    | "permission";
  message: string;
};
export type ExecutionResult = {
  id: string;
  requestId: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  headers: string[][];
  body: string;
  durationMs: number;
  size: number;
  startedAt: number;
  completed: boolean;
  error?: RequestError;
  blob?: Blob;
  requestHeaders?: string[][];
  requestBody?: string;
  truncated?: boolean;
};
export type AssertionResult = {
  id: string;
  passed: boolean;
  actual: unknown;
  expected: unknown;
  error?: string;
};
export type RunStep = {
  requestId: string;
  iteration: number;
  result: ExecutionResult;
  assertions: AssertionResult[];
  passed: boolean;
};
export type RunReport = {
  id: string;
  name: string;
  startedAt: number;
  status: "running" | "passed" | "failed" | "cancelled" | "interrupted";
  steps: RunStep[];
  finishedAt?: number;
};
export type EvalContext = {
  referenceIds?: Record<string, string>;
  variables: Record<string, string>;
  requests: RequestDefinition[];
  nodes?: RepositoryNode[];
  responses: Record<string, ExecutionResult>;
  compiled?: Record<
    string,
    { url: string; method: string; headers: string[][]; body: string }
  >;
};
export type ImportReport = {
  format: string;
  workspace: Workspace;
  warnings: string[];
  errors: string[];
};
export const uid = () => crypto.randomUUID();
export const pair = (name = "", value = ""): Pair => ({
  id: uid(),
  name,
  value,
  enabled: true,
});
export const newRequest = (
  name = "Untitled request",
  parentId?: string,
): RequestDefinition => ({
  id: uid(),
  name,
  parentId,
  method: "GET",
  url: "",
  query: [],
  headers: [],
  body: { type: "none", text: "", fields: [] },
  auth: { type: "none" },
  assertions: [],
  timeoutMs: 30000,
  maxResponseBytes: 20 * 1024 * 1024,
  cookies: true,
  description: "",
  unsupported: [],
  order: Date.now(),
});
export const newWorkspace = (): Workspace => ({
  format: "apiman",
  schemaVersion: 1,
  nodes: [],
  requests: [],
  environments: [],
  scenarios: [],
});
export function environmentContext(w: Workspace): EvalContext {
  return {
    variables: Object.fromEntries(
      (
        w.environments.find((e) => e.id === w.activeEnvironmentId)?.variables ??
        []
      )
        .filter((v) => v.enabled)
        .map((v) => [v.name, v.value]),
    ),
    requests: w.requests,
    nodes: w.nodes,
    responses: {},
  };
}
