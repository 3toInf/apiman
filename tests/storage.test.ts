import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import {
  WorkspaceStore,
  mergeWorkspace,
  redactResult,
} from "../src/storage/store";
import { newWorkspace, newRequest } from "../src/core/model";
describe("local data integrity", () => {
  it("persists a complete workspace and merges imports without replacing existing IDs", async () => {
    const db = new WorkspaceStore("test-" + crypto.randomUUID());
    const a = newWorkspace();
    const request = newRequest("Original");
    a.requests = [request];
    await db.save(a);
    expect((await db.load())?.requests[0]?.name).toBe("Original");
    const b = newWorkspace();
    b.requests = [{ ...request, name: "Imported" }];
    const merged = mergeWorkspace(a, b);
    expect(merged.requests).toHaveLength(2);
    expect(new Set(merged.requests.map((r) => r.id)).size).toBe(2);
    await db.save(merged);
    expect((await db.load())?.requests).toHaveLength(2);
    db.close();
    await db.delete();
  });
  it("masks secrets in persisted result body, URLs and headers", () => {
    const result = {
      id: "x",
      requestId: "r",
      url: "https://example.test?token=private-token",
      method: "GET",
      status: 200,
      statusText: "OK",
      headers: [["Set-Cookie", "session=abc"]],
      body: '{"token":"private-token"}',
      durationMs: 5,
      size: 25,
      startedAt: 1,
      completed: true,
    };
    const redacted = redactResult(result, ["private-token"]);
    expect(JSON.stringify(redacted)).not.toContain("private-token");
    expect(JSON.stringify(redacted)).not.toContain("session=abc");
  });
});
