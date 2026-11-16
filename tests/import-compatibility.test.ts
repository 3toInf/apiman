import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { interpolate, evaluate } from "../src/core/expressions";
import { compileRequest } from "../src/core/http";
import {
  environmentContext,
  newRequest,
  newWorkspace,
  type Workspace,
} from "../src/core/model";
import { importDocument } from "../src/importers";
import { WorkspaceStore } from "../src/storage/store";

function repositoryExport(
  uri: Record<string, unknown>,
  host = "https://example.test",
) {
  return {
    version: 6,
    entities: [
      {
        entity: {
          type: "Request",
          id: "health",
          name: "Health",
          method: { name: "GET" },
          uri,
        },
      },
    ],
    environments: [
      {
        id: "env",
        name: "Test",
        variables: { host: { name: "host", value: host, enabled: true } },
      },
    ],
  };
}
const ctx = {
  variables: {
    host: "https://example.test",
    alias: "${host}",
    mixed: '${"alias"}',
  },
  requests: [],
  responses: {},
};
describe("bare repository environment variables", () => {
  it.each([
    "${host}/health",
    '${"host"}/health',
    "${alias}/health",
    "${mixed}/health",
  ])("resolves %s through the active environment", (template) => {
    expect(interpolate(template, ctx)).toBe("https://example.test/health");
  });
  it("reports a missing bare variable instead of treating it as a literal or request name", () => {
    const context = { ...ctx, variables: {}, requests: [newRequest("host")] };
    expect(() => interpolate("${host}", context)).toThrow(
      /environment variable.*host.*not defined/i,
    );
    expect(() => interpolate("${toString}", context)).toThrow(
      /environment variable.*toString.*not defined/i,
    );
    expect(interpolate('${"literal"}', context)).toBe("literal");
  });
  it("keeps cycle detection for mixed quoted and bare references", () => {
    expect(() =>
      interpolate("${host}", {
        ...ctx,
        variables: { host: '${"alias"}', alias: "${host}" },
      }),
    ).toThrow(/cyclic/i);
  });
  it("keeps the nesting bound for acyclic bare references", () => {
    const variables = Object.fromEntries(
      Array.from({ length: 35 }, (_, i) => [
        "v" + i,
        i === 34 ? "done" : "${v" + (i + 1) + "}",
      ]),
    );
    expect(() => interpolate("${v0}", { ...ctx, variables })).toThrow(
      /nesting limit/i,
    );
  });
  it("supports transformations without changing quoted literals, functions or response references", () => {
    expect(evaluate("host.upper()", ctx)).toBe("HTTPS://EXAMPLE.TEST");
    expect(evaluate('"host".upper()', ctx)).toBe("HTTPS://EXAMPLE.TEST");
    expect(evaluate('"7".math("MULTIPLY", "6")', ctx)).toBe(42);
    expect(evaluate("true", ctx)).toBe(true);
    expect(() => evaluate("globalThis.process.exit()", ctx)).toThrow();
  });
});

describe("repository URL semantics", () => {
  it.each(["http://example.test", "https://example.test"])(
    "does not invent a scheme before %s",
    async (host) => {
      const w = importDocument(
        JSON.stringify(
          repositoryExport({ host: "${host}", path: "/health" }, host),
        ),
      ).workspace;
      expect(w.requests[0]!.url).toBe("${host}/health");
      expect(
        (await compileRequest(w.requests[0]!, environmentContext(w))).url,
      ).toBe(host + "/health");
    },
  );
  it.each([undefined, null, {}, { name: "" }])(
    "preserves a missing/empty scheme %j",
    async (scheme) => {
      const w = importDocument(
        JSON.stringify(
          repositoryExport({ scheme, host: '${"host"}', path: "/health" }),
        ),
      ).workspace;
      expect(w.requests[0]!.url).toBe('${"host"}/health');
      expect(
        (await compileRequest(w.requests[0]!, environmentContext(w))).url,
      ).toBe("https://example.test/health");
    },
  );
  it.each(["http", "https"])(
    "preserves explicit %s, port, fragment and query parameters",
    async (scheme) => {
      const w = importDocument(
        JSON.stringify(
          repositoryExport(
            {
              scheme: { name: scheme },
              host: "${host}",
              port: "8080",
              path: "/health",
              fragment: "section",
              query: { items: [{ name: "x", value: "1", enabled: true }] },
            },
            "example.test",
          ),
        ),
      ).workspace;
      expect(w.requests[0]!.url).toBe(
        scheme + "://${host}:8080/health#section",
      );
      expect(
        (await compileRequest(w.requests[0]!, environmentContext(w))).url,
      ).toBe(scheme + "://example.test:8080/health?x=1#section");
    },
  );
  it("rejects an expanded URL still missing a protocol instead of choosing one", async () => {
    const w = importDocument(
      JSON.stringify(
        repositoryExport({ host: "${host}", path: "/health" }, "example.test"),
      ),
    ).workspace;
    await expect(
      compileRequest(w.requests[0]!, environmentContext(w)),
    ).rejects.toThrow(/complete HTTP\(S\) URL|http:\/\/.*https:\/\//i);
  });
});

function legacyRequest(id: string, uri: Record<string, unknown>, url: string) {
  return {
    ...newRequest(id),
    id,
    url,
    source: {
      type: "Request",
      id: "source-" + id,
      name: id,
      method: { name: "GET" },
      uri,
    },
  };
}
describe("repairing previously imported repository URLs", () => {
  it("persists only exact legacy URL repairs and reports modified, draft and unverified records", async () => {
    const db = new WorkspaceStore("repository-repair-" + crypto.randomUUID());
    try {
      const w = newWorkspace();
      const source = {
        host: "${host}",
        port: "8443",
        path: "/health",
        fragment: "ready",
      };
      w.requests = [
        legacyRequest("fix", source, "http://${host}:8443/health#ready"),
        legacyRequest("edited", source, "https://manual.example.test/health"),
        legacyRequest("drafted", source, "http://${host}:8443/health#ready"),
        legacyRequest(
          "explicit",
          { ...source, scheme: { name: "http" } },
          "http://${host}:8443/health#ready",
        ),
        legacyRequest("correct", source, "${host}:8443/health#ready"),
        {
          ...newRequest("unverified"),
          id: "unverified",
          url: "http://${host}/health",
        },
      ];
      const draft = {
        ...w.requests[2]!,
        name: "Unsaved edit",
        url: "https://draft.example.test/health",
      };
      const unsaved = legacyRequest(
        "unsaved",
        source,
        "http://${host}:8443/health#ready",
      );
      await db.save(w);
      await db.drafts.bulkPut([
        { id: draft.id, request: draft },
        { id: unsaved.id, request: unsaved },
      ]);
      let summary: any;
      const repaired = await db.load((report) => {
        summary = report;
      });
      expect(repaired!.requests[0]!.url).toBe("${host}:8443/health#ready");
      expect((await db.snapshots.get("main"))!.workspace.requests[0]!.url).toBe(
        "${host}:8443/health#ready",
      );
      expect(repaired!.requests.slice(1)).toEqual(w.requests.slice(1));
      expect(repaired!.requests[0]!.source).toEqual(w.requests[0]!.source);
      expect((await db.drafts.get(draft.id))!.request).toEqual(draft);
      expect((await db.drafts.get(unsaved.id))!.request).toEqual(unsaved);
      expect(summary.repaired.map((r: any) => r.id)).toEqual(["fix"]);
      expect(summary.review.map((r: any) => [r.id, r.reason])).toEqual([
        ["edited", "modified"],
        ["drafted", "draft"],
        ["unverified", "unverified"],
        ["unsaved", "draft"],
      ]);
      await db.load((report) => {
        summary = report;
      });
      expect(summary.repaired).toEqual([]);
    } finally {
      await db.delete();
    }
  });
  it("leaves ambiguous source records and explicit HTTPS URLs unchanged", async () => {
    const db = new WorkspaceStore("repository-source-" + crypto.randomUUID());
    try {
      const w = newWorkspace();
      w.requests = [
        {
          ...newRequest("unknown"),
          url: "http://${host}/health",
          source: { uri: { host: "${host}", path: "/health" } },
        },
        legacyRequest(
          "https",
          { scheme: { name: "https" }, host: "${host}", path: "/health" },
          "https://${host}/health",
        ),
        {
          ...newRequest("string-uri"),
          url: "http://${host}/health",
          source: { type: "Request", uri: "http://${host}/health" },
        },
      ];
      await db.save(w);
      expect(await db.load()).toEqual(w);
    } finally {
      await db.delete();
    }
  });
  it("rolls back an automatic repair if snapshot persistence fails", async () => {
    const db = new WorkspaceStore("repository-rollback-" + crypto.randomUUID());
    try {
      const w: Workspace = newWorkspace();
      w.requests = [
        legacyRequest(
          "fix",
          { host: "${host}", path: "/health" },
          "http://${host}/health",
        ),
      ];
      await db.save(w);
      const rejectUpdate = () => {
        throw new Error("Simulated storage write failure");
      };
      db.snapshots.hook("updating", rejectUpdate);
      await expect(db.load()).rejects.toThrow(/storage write failure/);
      db.snapshots.hook("updating").unsubscribe(rejectUpdate);
      expect((await db.snapshots.get("main"))!.workspace).toEqual(w);
    } finally {
      await db.delete();
    }
  });
});

it("flags an obvious doubled protocol without source for manual review without rewriting it", async () => {
  const db = new WorkspaceStore(
    "repository-double-protocol-" + crypto.randomUUID(),
  );
  try {
    const w = newWorkspace();
    w.requests = [
      {
        ...newRequest("Unknown source"),
        id: "unknown",
        url: "http://https://example.test/health",
      },
    ];
    await db.save(w);
    let summary: any;
    expect(
      await db.load((report) => {
        summary = report;
      }),
    ).toEqual(w);
    expect(summary.repaired).toEqual([]);
    expect(summary.review).toEqual([
      { id: "unknown", name: "Unknown source", reason: "unverified" },
    ]);
    expect((await db.snapshots.get("main"))!.workspace).toEqual(w);
  } finally {
    await db.delete();
  }
});
