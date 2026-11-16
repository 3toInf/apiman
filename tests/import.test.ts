import { describe, expect, it } from "vitest";
import { importDocument, exportWorkspace, exportCurl } from "../src/importers";
import { newWorkspace, newRequest } from "../src/core/model";
const talend = {
  version: 6,
  entities: [
    {
      entity: { type: "Project", id: "p", name: "Demo" },
      children: [
        {
          entity: {
            type: "Request",
            id: "r",
            name: "Hello",
            method: { name: "POST" },
            uri: {
              scheme: { name: "https" },
              host: "example.test",
              path: "/hello",
              query: { items: [{ name: "x", value: "1", enabled: false }] },
            },
            headers: [{ name: "X-Key", value: '${"token"}', enabled: true }],
            body: { bodyType: "Text", textBody: '{"ok":true}' },
          },
        },
      ],
    },
  ],
  environments: [
    {
      id: "e",
      name: "Dev",
      variables: {
        v: { name: "token", value: "secret", private: true, enabled: true },
      },
    },
  ],
};
describe("data portability", () => {
  it("imports real Talend v6 shape without flattening hierarchy or losing secrets flags", () => {
    const report = importDocument(JSON.stringify(talend));
    expect(report.workspace.nodes[0]?.name).toBe("Demo");
    expect(report.workspace.requests[0]?.url).toBe(
      "https://example.test/hello",
    );
    expect(report.workspace.requests[0]?.query[0]?.enabled).toBe(false);
    expect(report.workspace.environments[0]?.variables[0]?.private).toBe(true);
    expect(report.workspace.requests[0]?.headers[0]?.value).toBe('${"token"}');
    expect(report.errors).toEqual([]);
  });
  it("redacts private values on native export and roundtrips all request structure", () => {
    const w = importDocument(JSON.stringify(talend)).workspace;
    const output = exportWorkspace(w);
    expect(output).not.toContain("secret");
    const restored = importDocument(output).workspace;
    expect(restored.requests[0]?.body.text).toBe('{"ok":true}');
    expect(restored.environments[0]?.variables[0]?.value).toBe("");
    expect(exportWorkspace(w, { includeSecrets: true })).toContain("secret");
  });
  it("imports Postman nested folders and reports scripts that cannot be executed", () => {
    const d = {
      info: {
        name: "PM",
        schema:
          "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
      },
      item: [
        {
          name: "Folder",
          item: [
            {
              name: "Req",
              event: [{ listen: "test", script: { exec: ['pm.test("ok")'] } }],
              request: { method: "GET", url: "https://example.test/{{id}}" },
            },
          ],
        },
      ],
    };
    const r = importDocument(JSON.stringify(d));
    expect(r.workspace.requests).toHaveLength(1);
    expect(r.warnings.join(" ")).toMatch(/script/i);
    expect(r.workspace.requests[0]?.unsupported.length).toBeGreaterThan(0);
  });
  it("imports OpenAPI YAML, HAR and curl without executing shell syntax", () => {
    expect(
      importDocument(
        "openapi: 3.0.0\ninfo:\n  title: Demo\nservers:\n  - url: https://example.test\npaths:\n  /pets:\n    get:\n      summary: List\n",
      ).workspace.requests[0]?.url,
    ).toBe("https://example.test/pets");
    expect(
      importDocument(
        JSON.stringify({
          log: {
            version: "1.2",
            entries: [
              {
                request: {
                  method: "GET",
                  url: "https://example.test",
                  headers: [],
                },
              },
            ],
          },
        }),
      ).workspace.requests,
    ).toHaveLength(1);
    const r = importDocument(
      "curl 'https://example.test' -H 'X-Name: a b' --data-raw '{\"ok\":true}'",
    ).workspace.requests[0]!;
    expect(r.method).toBe("POST");
    expect(r.headers[0]?.value).toBe("a b");
    expect(() =>
      importDocument("curl https://example.test $(touch /tmp/no)"),
    ).toThrow();
    expect(exportCurl(r)).toContain("--data-raw");
  });
  it("rejects unknown and malformed formats rather than pretending import succeeded", () => {
    expect(() => importDocument('{"version":999,"entities":[]}')).toThrow(
      /version/i,
    );
    expect(() => importDocument("{}")).toThrow();
    const w = newWorkspace();
    w.requests = [newRequest()];
    const snapshot = JSON.parse(exportWorkspace(w));
    snapshot.requests = "invalid";
    expect(() => importDocument(JSON.stringify(snapshot))).toThrow();
  });
});

it("converts Talend comparison/subject/path assertions and scenario order", () => {
  const source = {
    version: 6,
    entities: [
      {
        entity: { type: "Scenario", id: "s", name: "Flow" },
        children: [
          {
            entity: {
              type: "Request",
              id: "a",
              name: "Echo",
              method: { name: "GET" },
              uri: {
                scheme: { name: "http" },
                host: "example.test",
                path: "/echo",
              },
              assertions: [
                {
                  comparison: "Equals",
                  subject: "ResponseStatus",
                  path: "code",
                  enabled: true,
                  value: "200",
                },
                {
                  comparison: "Contains",
                  subject: "ResponseBody",
                  path: "content",
                  enabled: true,
                  value: "ok",
                },
              ],
            },
          },
        ],
      },
    ],
  };
  const report = importDocument(JSON.stringify(source));
  expect(report.workspace.requests[0]?.unsupported).toEqual([]);
  expect(
    report.workspace.requests[0]?.assertions.map((a) => [
      a.target,
      a.operator,
      a.expected,
    ]),
  ).toEqual([
    ["status", "equals", "200"],
    ["body", "contains", "ok"],
  ]);
  expect(report.workspace.scenarios[0]?.requestIds).toEqual(["a"]);
});

it("keeps imported response references bound when names collide or requests are renamed", async () => {
  const { mergeWorkspace } = await import("../src/storage/store");
  const { compileRequest } = await import("../src/core/http");
  const { environmentContext } = await import("../src/core/model");
  const source = {
    version: 6,
    entities: [
      {
        entity: {
          type: "Request",
          id: "a",
          name: "Login",
          method: { name: "GET" },
          uri: {
            scheme: { name: "https" },
            host: "example.test",
            path: "/login",
          },
        },
      },
      {
        entity: {
          type: "Request",
          id: "b",
          name: "Use token",
          method: { name: "GET" },
          uri: {
            scheme: { name: "https" },
            host: "example.test",
            path: '/${"Login"."response"."body".jsonPath("$.token")}',
          },
        },
      },
    ],
  };
  const incoming = importDocument(JSON.stringify(source)).workspace;
  const existing = newWorkspace();
  existing.requests = [
    { ...newRequest("Login"), url: "https://unrelated.test" },
  ];
  const merged = mergeWorkspace(existing, incoming);
  const login = merged.requests[1]!;
  login.name = "Renamed login";
  const ctx = environmentContext(merged);
  ctx.responses[login.id] = {
    id: "result",
    requestId: login.id,
    url: login.url,
    method: "GET",
    status: 200,
    statusText: "OK",
    headers: [],
    body: '{"token":"abc"}',
    size: 15,
    durationMs: 1,
    startedAt: 1,
    completed: true,
  };
  expect((await compileRequest(merged.requests[2]!, ctx)).url).toBe(
    "https://example.test/abc",
  );
});

it("imports published official v6 fixtures and the chained scenario fixture", async () => {
  const { readFileSync } = await import("node:fs");
  const official = importDocument(
    readFileSync(
      new URL("./fixtures/talend-official-v6.json", import.meta.url),
      "utf8",
    ),
  );
  expect(official.workspace.requests).toHaveLength(5);
  expect(
    official.workspace.nodes.filter((n) => n.kind === "service"),
  ).toHaveLength(5);
  const flow = importDocument(
    readFileSync(new URL("./fixtures/flow-v6.json", import.meta.url), "utf8"),
  );
  expect(flow.workspace.scenarios).toHaveLength(1);
  expect(flow.workspace.requests.every((r) => r.unsupported.length === 0)).toBe(
    true,
  );
  expect(flow.workspace.requests[1]?.referenceIds?.['"First"']).toBe(
    "fixture-first",
  );
});

it("keeps native backup schema and IDs intact when credentials are short", () => {
  const w = newWorkspace();
  const r = newRequest("sample");
  r.url = "https://example.test/path";
  r.auth = { type: "basic", username: "u", password: "p" };
  w.requests = [r];
  const restored = importDocument(exportWorkspace(w)).workspace;
  expect(restored.requests[0]?.id).toBe(r.id);
  expect(restored.requests[0]?.auth.password).toBe("");
  expect(restored.format).toBe("apiman");
});
it("exports generated content type and query API key to curl", () => {
  const r = newRequest();
  r.method = "POST";
  r.url = "https://example.test";
  r.body = { type: "json", text: '{"id":1}', fields: [] };
  r.auth = { type: "apikey", name: "key", value: "abc", location: "query" };
  const out = exportCurl(r);
  expect(out).toContain("Content-Type: application/json");
  expect(out).toContain("?key=abc");
});

it("exports a selected scenario with external request dependencies", async () => {
  const { exportScope } = await import("../src/importers");
  const w = newWorkspace();
  w.nodes = [
    { id: "project", name: "Other", kind: "project", order: 0 },
    { id: "scenario", name: "Flow", kind: "scenario", order: 1 },
  ];
  const r = { ...newRequest("Shared"), parentId: "project" };
  w.requests = [r];
  w.scenarios = [
    {
      id: "scenario",
      name: "Flow",
      requestIds: [r.id],
      repeat: 1,
      delayMs: 0,
      stopOnFailure: true,
    },
  ];
  const restored = importDocument(
    exportWorkspace(exportScope(w, "scenario")),
  ).workspace;
  expect(restored.requests[0]?.id).toBe(r.id);
  expect(restored.nodes.map((n) => n.id)).toContain("project");
  expect(restored.scenarios[0]?.requestIds).toEqual([r.id]);
});
