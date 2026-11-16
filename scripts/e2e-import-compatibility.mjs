import assert from "node:assert/strict";

// Only synthetic localhost fixtures, written into this test browser's isolated database.
export async function verifyImportCompatibility(page, origin) {
  await page.evaluate(async (origin) => {
    const db = await new Promise((resolve, reject) => {
      const open = indexedDB.open("apiman");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(["snapshots", "drafts"], "readwrite");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
      const get = tx.objectStore("snapshots").get("main");
      get.onsuccess = () => {
        const w = get.result.workspace,
          template = w.requests[0];
        const legacy = (id, url) => ({
          ...template,
          id,
          name: id,
          url,
          source: {
            type: "Request",
            id: "source-" + id,
            name: id,
            method: { name: "GET" },
            uri: { host: "${host}", path: "/health" },
          },
        });
        const automatic = legacy("Legacy automatic", "http://${host}/health");
        const manual = legacy("Legacy manual", origin + "/manual-edit");
        const savedDraft = legacy("Legacy draft", "http://${host}/health");
        const unknown = {
          ...legacy("Legacy unknown", "http://${host}/health"),
          source: undefined,
        };
        w.requests.push(automatic, manual, savedDraft, unknown);
        w.environments.push({
          id: "compat-env",
          name: "Compatibility",
          variables: [
            {
              id: "host",
              name: "host",
              value: origin,
              enabled: true,
              private: false,
            },
            {
              id: "nested",
              name: "nested",
              value: "${host}",
              enabled: true,
              private: false,
            },
            {
              id: "noScheme",
              name: "noScheme",
              value: "example.test",
              enabled: true,
              private: false,
            },
          ],
        });
        w.activeEnvironmentId = "compat-env";
        tx.objectStore("snapshots").put({ id: "main", workspace: w });
        tx.objectStore("drafts").put({
          id: savedDraft.id,
          request: {
            ...savedDraft,
            name: "Unsaved legacy draft",
            url: origin + "/unsaved-edit",
          },
        });
      };
    });
    db.close();
  }, origin);
  await page.reload();
  const notice = page.getByTestId("url-repair-notice");
  await notice.waitFor();
  assert.match(await notice.innerText(), /Repaired 1/);
  assert.match(await notice.innerText(), /3 request.*manual review/);
  const select = async (name) =>
    page.locator(".tree-label").filter({ hasText: name }).click();
  const url = page.getByLabel("Request URL", { exact: true });
  const send = () =>
    page.getByRole("button", { name: "Send request", exact: true }).click();
  await select("Legacy automatic");
  assert.equal(await url.inputValue(), "${host}/health");
  await send();
  await page
    .getByTestId("response-status")
    .filter({ hasText: "200" })
    .waitFor();
  assert.equal(
    JSON.parse(await page.getByTestId("response-body").innerText()).url,
    "/health",
  );
  await select("Legacy manual");
  assert.equal(await url.inputValue(), origin + "/manual-edit");
  await select("Legacy draft");
  assert.equal(await url.inputValue(), origin + "/unsaved-edit");
  await select("Legacy unknown");
  assert.equal(await url.inputValue(), "http://${host}/health");
  await page.reload();
  await notice.waitFor();
  assert.match(await notice.innerText(), /Repaired 0/);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByLabel("Import text").fill(
    JSON.stringify({
      version: 6,
      entities: [
        {
          entity: {
            type: "Request",
            id: "fresh-repository",
            name: "Fresh repository import",
            method: { name: "GET" },
            uri: { host: "${nested}", path: "/fresh" },
          },
        },
      ],
    }),
  );
  await page
    .getByRole("button", { name: "Preview import", exact: true })
    .click();
  await page.getByRole("button", { name: "Import data", exact: true }).click();
  await select("Fresh repository import");
  assert.equal(await url.inputValue(), "${nested}/fresh");
  await send();
  await page
    .getByTestId("response-status")
    .filter({ hasText: "200" })
    .waitFor();
  assert.equal(
    JSON.parse(await page.getByTestId("response-body").innerText()).url,
    "/fresh",
  );
  await url.fill("${missing}/health");
  await send();
  await page
    .locator(".global-error")
    .filter({ hasText: 'Environment variable "missing" is not defined' })
    .waitFor();
  await url.fill("${noScheme}/health");
  await send();
  await page
    .locator(".global-error")
    .filter({ hasText: "complete HTTP(S) URL" })
    .waitFor();
  await url.fill("${nested}/fresh");
  await page.getByRole("button", { name: "Save request", exact: true }).click();
  await page.getByTitle("Dismiss error").click();
  await page
    .getByRole("button", { name: "Dismiss URL repair notice", exact: true })
    .click();
  await select("Echo test");
  console.log(
    "PASS Chromium: repository bare/nested variables, preserved scheme, persisted legacy repair, modified/draft protection, actionable URL errors",
  );
}
