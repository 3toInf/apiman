import { compileRequest, executeRequest } from "./http";
import { evaluateAssertionsAsync } from "./assertions";
import {
  uid,
  type Workspace,
  type Scenario,
  type EvalContext,
  type RunReport,
  type ExecutionResult,
} from "./model";
export async function runScenario(
  w: Workspace,
  scenario: Scenario,
  base: EvalContext,
  options: {
    signal?: AbortSignal;
    getFile?: (id: string) => Promise<Blob | undefined>;
    onProgress?: (r: RunReport) => void;
    beforeSend?: (url: string) => Promise<void>;
  } = {},
): Promise<RunReport> {
  const report: RunReport = {
    id: uid(),
    name: scenario.name,
    startedAt: Date.now(),
    status: "running",
    steps: [],
  };
  const publish = () =>
    options.onProgress?.({ ...report, steps: [...report.steps] });
  if (scenario.repeat * scenario.requestIds.length > 1000)
    throw new Error("A run is limited to 1000 steps. Reduce the repeat count.");
  if (
    !Number.isInteger(scenario.repeat) ||
    scenario.repeat < 1 ||
    scenario.repeat > 10000 ||
    !Number.isFinite(scenario.delayMs) ||
    scenario.delayMs < 0
  )
    throw new Error("Invalid scenario repeat or delay");
  if (!scenario.requestIds.length)
    throw new Error("Add at least one request step before running");
  publish();
  let failed = false;
  outer: for (let iteration = 1; iteration <= scenario.repeat; iteration++) {
    const ctx: EvalContext = {
      ...base,
      requests: w.requests,
      nodes: w.nodes,
      responses: {},
      compiled: {},
    };
    for (const requestId of scenario.requestIds) {
      if (options.signal?.aborted) {
        report.status = "cancelled";
        break outer;
      }
      const r = w.requests.find((x) => x.id === requestId);
      let result: ExecutionResult;
      try {
        if (!r) throw new Error("Scenario references a missing request");
        const compiled = await compileRequest(r, ctx, options.getFile);
        await options.beforeSend?.(compiled.url);
        ctx.compiled![r.id] = {
          url: compiled.url,
          method: compiled.method,
          headers: [...compiled.headers.entries()],
          body: compiled.bodyText,
        };
        result = await executeRequest(compiled, options.signal);
      } catch (e) {
        result = {
          id: uid(),
          requestId,
          url: r?.url ?? "",
          method: r?.method ?? "",
          status: 0,
          statusText: "",
          headers: [],
          body: "",
          size: 0,
          durationMs: 0,
          startedAt: Date.now(),
          completed: false,
          error: {
            kind: "configuration",
            message: e instanceof Error ? e.message : String(e),
          },
        };
      }
      ctx.responses[requestId] = result;
      const assertions = await evaluateAssertionsAsync(
        r?.assertions ?? [],
        result,
        {
          ...ctx,
          referenceIds: r?.referenceIds,
        },
      );
      const passed =
        result.completed &&
        (assertions.length
          ? assertions.every((a) => a.passed)
          : result.status >= 200 && result.status < 400);
      const preview = {
        ...result,
        body: result.body.slice(0, 65536),
        truncated: result.truncated || result.body.length > 65536,
      };
      delete preview.blob;
      report.steps.push({
        requestId,
        iteration,
        result: preview,
        assertions,
        passed,
      });
      failed ||= !passed;
      publish();
      if (options.signal?.aborted || result.error?.kind === "cancelled") {
        report.status = "cancelled";
        break outer;
      }
      if (!passed && scenario.stopOnFailure) break outer;
      if (scenario.delayMs)
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, scenario.delayMs);
          options.signal?.addEventListener("abort", done, { once: true });
        });
    }
  }
  if (report.status === "running") report.status = failed ? "failed" : "passed";
  report.finishedAt = Date.now();
  publish();
  return report;
}
