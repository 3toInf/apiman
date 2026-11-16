import "fake-indexeddb/auto";
import { it, expect } from "vitest";
import {
  newWorkspace,
  newRequest,
  environmentContext,
  type ExecutionResult,
} from "../src/core/model";
import {
  importDocument,
  exportWorkspace,
  sensitiveValues,
  redactTree,
} from "../src/importers";
import {
  mergeWorkspace,
  redactResult,
  WorkspaceStore,
} from "../src/storage/store";
import { compileRequest } from "../src/core/http";
import { evaluateAssertions } from "../src/core/assertions";
const result: ExecutionResult = {
  id: "response",
  requestId: "request",
  url: "https://example.test",
  method: "GET",
  status: 200,
  statusText: "OK",
  headers: [],
  body: "",
  size: 0,
  durationMs: 1,
  startedAt: 1,
  completed: true,
};
it("omitted upload files cannot bind to an existing workspace file on import", () => {
  const w = newWorkspace(),
    r = newRequest();
  r.body = { type: "binary", text: "", fields: [], fileId: "original-file" };
  w.requests = [r];
  const imported = importDocument(exportWorkspace(w)).workspace;
  const merged = mergeWorkspace(w, imported);
  expect(merged.requests[1]!.body.fileId).not.toBe("original-file");
});
it("masks generated Basic authentication echoed in response content", () => {
  const token = btoa("alice:secretword");
  const response = {
    ...result,
    body: JSON.stringify({ authorization: "Basic " + token }),
    requestHeaders: [["authorization", "Basic " + token]],
  };
  expect(JSON.stringify(redactResult(response, ["secretword"]))).not.toContain(
    token,
  );
});
it("evaluates private variable expressions when collecting secrets", () => {
  const w = newWorkspace();
  w.activeEnvironmentId = "env";
  w.environments = [
    {
      id: "env",
      name: "Env",
      variables: [
        {
          id: "a",
          name: "public",
          value: "derived-private",
          enabled: true,
          private: false,
        },
        {
          id: "b",
          name: "secret",
          value: '${"public"}',
          enabled: true,
          private: true,
        },
      ],
    },
  ];
  expect(sensitiveValues(w)).toContain("derived-private");
});
it("redacts arbitrary JSON assertion values while preserving report metadata IDs", () => {
  const safe = redactTree(
    {
      id: "private-token",
      steps: [
        {
          assertions: [
            {
              id: "a",
              actual: { id: "private-token", name: "private-token" },
              expected: { name: "private-token" },
            },
          ],
        },
      ],
    },
    ["private-token"],
  );
  expect(safe.id).toBe("private-token");
  expect(JSON.stringify(safe.steps)).not.toContain("private-token");
});
it("does not equate JSON arrays with objects, including nested values", () => {
  const r = { ...result, body: '{"value":[],"nested":{"x":[]}}' };
  const assertions = ["$.value", "$.nested"].map((selector, i) => ({
    id: String(i),
    target: "json" as const,
    operator: "equals" as const,
    expected: i ? ' {"x":{}} ' : "{}",
    selector,
    enabled: true,
  }));
  expect(
    evaluateAssertions(assertions, r, {
      variables: {},
      requests: [],
      responses: {},
    }).map((a) => a.passed),
  ).toEqual([false, false]);
});
it("preserves curl data media type and data-urlencode value boundaries", async () => {
  for (const [option, body] of [
    ["--data 'x=1'", "x=1"],
    ["--data-urlencode 'a=x=y'", "a=x%3Dy"],
    ["--data-urlencode '=a&b'", "a%26b"],
  ]) {
    const w = importDocument("curl https://example.test " + option).workspace;
    const compiled = await compileRequest(
      w.requests[0]!,
      environmentContext(w),
    );
    expect(compiled.headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(compiled.bodyText).toBe(body);
  }
});
it("commits the snapshot and matching draft removal atomically, preserving newer edits and failed drafts", async () => {
  const db = new WorkspaceStore("review-" + crypto.randomUUID());
  const w = newWorkspace(),
    r = newRequest();
  w.requests = [r];
  await db.drafts.put({ id: r.id, request: r });
  await db.save(w, { savedDraft: r });
  expect(await db.drafts.get(r.id)).toBeUndefined();
  const newer = { ...r, name: "Newer edit" };
  await db.drafts.put({ id: r.id, request: newer });
  await db.save(w, { savedDraft: r });
  expect((await db.drafts.get(r.id))?.request.name).toBe("Newer edit");
  w.requests = [{ ...r, timeoutMs: 0 }];
  await expect(db.save(w, { savedDraft: newer })).rejects.toThrow();
  expect((await db.drafts.get(r.id))?.request.name).toBe("Newer edit");
  await db.delete();
});
it("masks compiled credentials throughout exported report assertions", async () => {
  const { redactReport } = await import("../src/storage/store");
  const token = btoa("alice:secretword");
  const report = {
    id: "report",
    name: "Run",
    startedAt: 1,
    status: "passed" as const,
    steps: [
      {
        requestId: "request",
        iteration: 1,
        passed: true,
        result: {
          ...result,
          requestHeaders: [["authorization", "Basic " + token]],
        },
        assertions: [
          { id: "a", actual: { name: token }, expected: token, passed: true },
        ],
      },
    ],
  };
  expect(JSON.stringify(redactReport(report, ["secretword"]))).not.toContain(
    token,
  );
});
it("retains shared file relationships when omitted uploads receive fresh IDs", () => {
  const w = newWorkspace(),
    a = newRequest("A"),
    b = newRequest("B");
  a.body = { type: "binary", text: "", fields: [], fileId: "shared" };
  b.body = {
    type: "multipart",
    text: "",
    fields: [
      { id: "f", name: "file", value: "", enabled: true, fileId: "shared" },
    ],
  };
  w.requests = [a, b];
  const merged = mergeWorkspace(newWorkspace(), w);
  expect(merged.requests[0]?.body.fileId).toBe(
    merged.requests[1]?.body.fields[0]?.fileId,
  );
  expect(merged.requests[0]?.body.fileId).not.toBe("shared");
});
it("restores included binary attachments under new IDs and rolls back malformed attachment imports", async () => {
  const db = new WorkspaceStore("files-" + crypto.randomUUID());
  const w = newWorkspace(),
    r = newRequest();
  const original = await db.addFile(
    new File([new Uint8Array([0, 1, 254, 255])], "payload.bin", {
      type: "application/octet-stream",
    }),
  );
  r.body = { type: "binary", text: "", fields: [], fileId: original };
  w.requests = [r];
  await db.save(w);
  const full = importDocument(
    exportWorkspace(await db.backup(w, true), { includeAttachments: true }),
  ).workspace;
  const merged = mergeWorkspace(w, full);
  await db.save(merged);
  const restored = merged.requests[1]!.body.fileId!;
  expect(restored).not.toBe(original);
  expect(
    new Uint8Array(await (await db.getFile(restored))!.arrayBuffer()),
  ).toEqual(new Uint8Array([0, 1, 254, 255]));
  await expect(
    db.save({
      ...merged,
      requests: [],
      attachments: [{ id: "broken", name: "bad", type: "", base64: "***" }],
    }),
  ).rejects.toThrow();
  expect((await db.load())?.requests).toHaveLength(2);
  expect(await db.getFile("broken")).toBeUndefined();
  await db.delete();
});
