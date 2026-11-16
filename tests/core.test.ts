import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { newRequest, newWorkspace } from "../src/core/model";
import { interpolate, evaluate } from "../src/core/expressions";
import { compileRequest, executeRequest } from "../src/core/http";
import { evaluateAssertions } from "../src/core/assertions";
import { runScenario } from "../src/core/runner";

const context = {
  variables: { host: "example.test", token: "secret", nested: '${"token"}' },
  responses: {},
  requests: [],
};
describe("Talend expressions", () => {
  it("resolves nested environment values and leaves literal constants intact", () => {
    expect(interpolate('https://${"host"}/${"nested"}', context)).toBe(
      "https://example.test/secret",
    );
    expect(evaluate('"literal".upper().substring(0,3)', context)).toBe("LIT");
  });
  it("evaluates transformations, hashes and JSON paths without executing JS", () => {
    expect(evaluate('"7".math("MULTIPLY", "6")', context)).toBe(42);
    expect(evaluate('"toto".md5()', context)).toBe(
      "f71dbe52628a3f83a77ab494817525c6",
    );
    expect(evaluate('"test".hmac("sha256", "secret", "Base64")', context)).toBe(
      "Aymga2LNFrM+tnkr6MYLFY2Jou46h2/Omogeu0iMCRQ=",
    );
    expect(evaluate('"{\\"id\\":7}".jsonPath("$.id")', context)).toBe(7);
    expect(() =>
      evaluate('constructor.constructor("return globalThis")()', context),
    ).toThrow();
  });
  it("rejects cycles and missing prior responses", () => {
    expect(() =>
      interpolate('${"a"}', {
        ...context,
        variables: { a: '${"b"}', b: '${"a"}' },
      }),
    ).toThrow(/cycl/i);
    const r = newRequest("Login");
    expect(() =>
      interpolate('${"Login"."response"."body"}', {
        ...context,
        requests: [r],
      }),
    ).toThrow(/response/i);
  });
});

describe("real HTTP and scenarios", () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      if (req.url === "/slow") {
        await new Promise((r) => setTimeout(r, 150));
      }
      if (req.url === "/fail") res.statusCode = 422;
      if (req.url === "/large") {
        res.end("x".repeat(100));
        return;
      }
      const parts: Buffer[] = [];
      for await (const part of req) parts.push(part);
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          id: 7,
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: Buffer.concat(parts).toString(),
        }),
      );
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  it("preserves duplicate query values and encodes form data and authentication", async () => {
    const r = newRequest("echo");
    r.url = origin + "/echo?x=1";
    r.method = "POST";
    r.query = [{ id: "q", name: "x", value: "a b", enabled: true }];
    r.body = {
      type: "urlencoded",
      text: "",
      fields: [{ id: "f", name: "key", value: "a&b", enabled: true }],
    };
    r.auth = { type: "basic", username: "u", password: "p" };
    const response = await executeRequest(await compileRequest(r, context));
    const data = JSON.parse(response.body);
    expect(data.url).toBe("/echo?x=1&x=a+b");
    expect(data.body).toBe("key=a%26b");
    expect(data.headers.authorization).toBe("Basic dTpw");
    expect(response.status).toBe(200);
  });
  it("sends multipart bytes, filenames and duplicate fields to a real server", async () => {
    const r = newRequest();
    r.url = origin + "/upload";
    r.method = "POST";
    r.body = {
      type: "multipart",
      text: "",
      fields: [
        { id: "a", name: "tag", value: "one", enabled: true },
        { id: "b", name: "tag", value: "two", enabled: true },
        {
          id: "f",
          name: "file",
          value: "",
          enabled: true,
          fileId: "blob",
          fileName: "hello.txt",
        },
      ],
    };
    const response = await executeRequest(
      await compileRequest(
        r,
        context,
        async () => new Blob(["uploaded bytes"], { type: "text/plain" }),
      ),
    );
    const data = JSON.parse(response.body);
    expect(data.headers["content-type"]).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    expect(data.body).toContain('filename="hello.txt"');
    expect(data.body).toContain("uploaded bytes");
    expect(data.body.match(/name="tag"/g)).toHaveLength(2);
  });
  it("returns non-2xx HTTP responses and distinguishes timeout, cancellation and size limit", async () => {
    const r = newRequest();
    r.url = origin + "/fail";
    expect(
      (await executeRequest(await compileRequest(r, context))).status,
    ).toBe(422);
    r.url = origin + "/slow";
    r.timeoutMs = 20;
    expect(
      (await executeRequest(await compileRequest(r, context))).error?.kind,
    ).toBe("timeout");
    const abort = new AbortController();
    abort.abort();
    expect(
      (await executeRequest(await compileRequest(r, context), abort.signal))
        .error?.kind,
    ).toBe("cancelled");
    r.url = origin + "/large";
    r.maxResponseBytes = 10;
    expect(
      (await executeRequest(await compileRequest(r, context))).error?.kind,
    ).toBe("size");
  });
  it("rejects forbidden headers and GET payloads before sending", async () => {
    const r = newRequest();
    r.url = origin;
    r.headers = [{ id: "h", name: "Cookie", value: "x=1", enabled: true }];
    await expect(compileRequest(r, context)).rejects.toThrow(/browser|header/i);
    r.headers = [];
    r.body = { type: "text", text: "payload", fields: [] };
    await expect(compileRequest(r, context)).rejects.toThrow(/GET/);
  });
  it("chains responses and stops the scenario after an assertion failure", async () => {
    const w = newWorkspace();
    const a = newRequest("First");
    a.url = origin + "/first";
    const b = newRequest("Second");
    b.url = origin + '/${"First"."response"."body".jsonPath("$.id")}';
    b.assertions = [
      {
        id: "a",
        target: "status",
        operator: "equals",
        expected: "201",
        selector: "",
        enabled: true,
      },
    ];
    const c = newRequest("Third");
    c.url = origin + "/third";
    w.requests = [a, b, c];
    const report = await runScenario(
      w,
      {
        id: "s",
        name: "Flow",
        requestIds: [a.id, b.id, c.id],
        stopOnFailure: true,
        repeat: 1,
        delayMs: 0,
      },
      context,
    );
    expect(report.steps).toHaveLength(2);
    expect(report.steps[1]?.result.url).toBe(origin + "/7");
    expect(report.status).toBe("failed");
  });
  it("uses typed JSON assertions and reports selector/regex errors as failures", async () => {
    const r = newRequest();
    r.url = origin;
    const response = await executeRequest(await compileRequest(r, context));
    const assertions = [
      {
        id: "a",
        target: "json" as const,
        selector: "$.id",
        operator: "equals" as const,
        expected: "7",
        enabled: true,
      },
      {
        id: "b",
        target: "body" as const,
        selector: "",
        operator: "matches" as const,
        expected: "[",
        enabled: true,
      },
    ];
    const results = evaluateAssertions(assertions, response, context);
    expect(results.map((x) => x.passed)).toEqual([true, false]);
    expect(results[1]?.error).toBeTruthy();
  });
});

it("selects JSONPath filters without evaluating arbitrary JavaScript", () => {
  const ctx = {
    variables: { data: '{"items":[{"id":1},{"id":2}]}' },
    requests: [],
    responses: {},
  };
  expect(evaluate('"data".jsonPath("$.items[?(@.id > 1)].id")', ctx)).toBe(2);
  expect(() =>
    evaluate('"data".jsonPath("$[?(globalThis.process.exit())]")', ctx),
  ).toThrow();
});

it("evaluates regex assertions asynchronously and rejects malformed expressions", async () => {
  const { evaluateAssertionsAsync } = await import("../src/core/assertions");
  const result = {
    id: "r",
    requestId: "a",
    url: "https://example.test",
    method: "GET",
    status: 200,
    statusText: "OK",
    headers: [],
    body: "hello",
    size: 5,
    durationMs: 1,
    startedAt: 1,
    completed: true,
  };
  const rows = await evaluateAssertionsAsync(
    [
      {
        id: "regex",
        target: "body",
        selector: "",
        operator: "matches",
        expected: "^hello$",
        enabled: true,
      },
      {
        id: "bad",
        target: "body",
        selector: "",
        operator: "matches",
        expected: "[",
        enabled: true,
      },
    ],
    result,
    context,
  );
  expect(rows.map((r) => r.passed)).toEqual([true, false]);
});
it("rejects oversized run configurations before making network calls", async () => {
  const w = newWorkspace();
  await expect(
    runScenario(
      w,
      {
        id: "s",
        name: "Too large",
        requestIds: ["missing", "another"],
        repeat: 10000,
        delayMs: 0,
        stopOnFailure: true,
      },
      context,
    ),
  ).rejects.toThrow(/1000/);
});

it("rejects empty scenarios and non-finite delays rather than reporting a successful run", async () => {
  const w = newWorkspace();
  const s = {
    id: "empty",
    name: "Empty",
    requestIds: [],
    repeat: 1,
    delayMs: 0,
    stopOnFailure: true,
  };
  await expect(runScenario(w, s, context)).rejects.toThrow(/request|step/i);
  await expect(
    runScenario(w, { ...s, requestIds: ["x"], delayMs: NaN }, context),
  ).rejects.toThrow(/delay/i);
});
