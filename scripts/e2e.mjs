import { verifyTalendCompatibility } from "./e2e-talend.mjs";
import {
  verifyRepositoryTree,
  verifyFirefoxRepositoryTree,
} from "./e2e-tree.mjs";
import { chromium, firefox as playwrightFirefox } from "@playwright/test";
import { Builder, By } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { createServer } from "node:http";
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const temp = await mkdtemp(path.join(tmpdir(), "apiman-e2e-"));
await mkdir("test-results", { recursive: true });
let unexpectedLoads = 0;
const server = createServer(async (req, res) => {
  let body = "";
  for await (const c of req) body += c;
  if (req.url.startsWith("/unexpected")) unexpectedLoads++;
  if (req.url === "/xml") {
    res.setHeader("Content-Type", "application/xml");
    res.end("<root><id>7</id></root>");
    return;
  }
  if (req.url === "/evil") {
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<h1>Safe preview</h1><img src="/unexpected-image" onerror="fetch('/unexpected-event')"><script>fetch('/unexpected-script')</script><iframe src="/unexpected-frame"></iframe><form action="/submitted" method="post"><input name="hello" value="world"><input name="skip" disabled value="no"></form>`,
    );
    return;
  }
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/slow")
    await new Promise((r) => setTimeout(r, 35000).unref());
  res.end(
    JSON.stringify({
      message: "Hello from apiman",
      method: req.method,
      url: req.url,
      body,
      authorization: req.headers.authorization ?? null,
    }),
  );
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
async function fixture(browser) {
  const dest = path.join(temp, browser);
  await cp(`.output/${browser}-mv3`, dest, { recursive: true });
  const manifest = JSON.parse(
    await readFile(path.join(dest, "manifest.json"), "utf8"),
  );
  manifest.host_permissions = ["http://*/*", "https://*/*"];
  await writeFile(path.join(dest, "manifest.json"), JSON.stringify(manifest));
  return dest;
}
// The disposable copy pregrants host permissions to bypass native permission prompts. All traffic is to the local echo fixture. Production permissions are unchanged.
try {
  const extension = await fixture("chrome");
  const context = await chromium.launchPersistentContext(
    path.join(temp, "chrome-profile"),
    {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        "--no-sandbox",
      ],
    },
  );
  try {
    let worker = context.serviceWorkers()[0];
    worker ??= await context.waitForEvent("serviceworker");
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(`chrome-extension://${id}/workspace.html`);
    await page
      .getByRole("button", { name: "New request", exact: true })
      .click();
    await page.getByLabel("Request name", { exact: true }).fill("Echo test");
    await page
      .getByLabel("Request URL", { exact: true })
      .fill(origin + "/echo");
    await page
      .getByRole("button", { name: "Save request", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await page
      .getByTestId("response-status")
      .filter({ hasText: "200" })
      .waitFor();
    assert.match(
      await page.getByTestId("response-body").innerText(),
      /Hello from apiman/,
    );
    await page.reload();
    await page.getByText("Echo test", { exact: true }).first().click();
    assert.equal(
      await page.getByLabel("Request URL", { exact: true }).inputValue(),
      origin + "/echo",
    );
    await verifyTalendCompatibility(page, origin);
    await verifyRepositoryTree(page);
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page
      .getByLabel("Import text")
      .fill(`curl '${origin}/imported' -H 'X-Test: yes'`);
    await page
      .getByRole("button", { name: "Preview import", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Import data", exact: true })
      .click();
    await page.getByText("Imported request", { exact: true }).first().click();
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await page
      .getByTestId("response-status")
      .filter({ hasText: "200" })
      .waitFor();
    // Conditions must re-evaluate against the displayed response without another send.
    await page
      .getByRole("button", { name: "Add assertion", exact: true })
      .click();
    await page.locator(".assertion-result.passed").waitFor();
    await page.getByLabel("Expected value", { exact: true }).fill("201");
    await page.locator(".assertion-result.failed").waitFor();
    assert.match(await page.getByTestId("response-status").innerText(), /200/);
    await page.getByLabel("Assertion target").selectOption("body");
    await page.getByLabel("Assertion operator").selectOption("matches");
    await page
      .getByLabel("Expected value", { exact: true })
      .fill("Hello from apiman");
    await page.locator(".assertion-result.passed").waitFor();
    await page.getByLabel("Request URL", { exact: true }).fill(origin + "/xml");
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await page
      .getByTestId("response-status")
      .filter({ hasText: "200" })
      .waitFor();
    await page.getByLabel("Assertion target").selectOption("xml");
    await page.getByLabel("Assertion operator").selectOption("equals");
    await page.getByLabel("Assertion selector").fill("//id");
    await page.getByLabel("Expected value", { exact: true }).fill("7");
    await page.locator(".assertion-result.passed").waitFor();
    await page
      .getByLabel("Request URL", { exact: true })
      .fill(origin + "/evil");
    await page
      .getByRole("button", { name: "Send request", exact: true })
      .click();
    await page
      .getByTestId("response-status")
      .filter({ hasText: "200" })
      .waitFor();
    await page
      .locator(".response-tabs")
      .getByRole("button", { name: "PREVIEW", exact: true })
      .click();
    await page
      .frameLocator('iframe[title="Isolated HTML preview"]')
      .getByText("Safe preview", { exact: true })
      .waitFor();
    await page
      .locator(".response-links button")
      .filter({ hasText: "/submitted" })
      .click();
    assert.equal(await page.getByLabel("HTTP method").inputValue(), "POST");
    assert.equal(
      await page.getByLabel("Field name").first().inputValue(),
      "hello",
    );
    assert.equal(
      unexpectedLoads,
      0,
      "HTML preview must not load remote resources or execute scripts",
    );

    const flow = JSON.parse(
      (
        await readFile("tests/fixtures/talend-roundtrip-v6.json", "utf8")
      ).replaceAll("127.0.0.1", `127.0.0.1:${server.address().port}`),
    );
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByLabel("Import text").fill(JSON.stringify(flow));
    await page
      .getByRole("button", { name: "Preview import", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Import data", exact: true })
      .click();
    await page.getByText("Echo chain", { exact: true }).first().click();
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.locator(".run-results .status.passed").waitFor();
    assert.equal(await page.locator(".run-result.passed").count(), 2);
    console.log(
      "PASS Chromium: editable assertions, regex worker, XPath, safe HTML/forms, imported chained scenario",
    );
    if (!process.argv.includes("--skip-slow")) {
      await page
        .getByRole("button", { name: "New request", exact: true })
        .click();
      await page
        .getByLabel("Request URL", { exact: true })
        .fill(origin + "/slow");
      await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
      await page.getByLabel("Timeout (ms)", { exact: true }).fill("60000");
      await page
        .getByRole("button", { name: "Send request", exact: true })
        .click();
      await page
        .getByTestId("response-status")
        .filter({ hasText: "200" })
        .waitFor({ timeout: 45000 });
      await page
        .getByRole("button", { name: "Send request", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Cancel request", exact: true })
        .click();
      await page
        .getByTestId("response-status")
        .filter({ hasText: "CANCELLED" })
        .waitFor();
      console.log("PASS Chromium: request survives 35 seconds, cancellation");
    }
    const regressions = [];
    await page.getByText("Migration checks", { exact: true }).first().click();
    await page
      .getByRole("button", { name: "Add request", exact: true })
      .click();
    await page
      .getByLabel("Request name", { exact: true })
      .fill("Unsaved child");
    await page
      .locator(".tree-row")
      .filter({ hasText: "Migration checks" })
      .hover();
    await page
      .locator(".tree-row")
      .filter({ hasText: "Migration checks" })
      .getByTitle("Item actions")
      .click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(".tree-menu button").last().click();
    await page
      .getByText("Migration checks", { exact: true })
      .waitFor({ state: "hidden" });
    const orphaned = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("apiman");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return new Promise((resolve) => {
        const request = db.transaction("drafts").objectStore("drafts").getAll();
        request.onsuccess = () => {
          resolve(
            request.result.some((d) => d.request.name === "Unsaved child"),
          );
          db.close();
        };
      });
    });
    if (orphaned)
      regressions.push("Deleted folder left a persisted child draft");
    await page
      .getByRole("button", { name: "New request", exact: true })
      .click();
    await page
      .getByLabel("Request name", { exact: true })
      .fill("Protected draft");
    await page
      .getByLabel("Request URL", { exact: true })
      .fill(origin + "/pending");
    await page.getByRole("button", { name: "SETTINGS", exact: true }).click();
    await page.getByLabel("Timeout (ms)", { exact: true }).fill("0");
    await page
      .getByRole("button", { name: "Save request", exact: true })
      .click();
    await page.locator(".global-error").waitFor();
    await page.reload();
    await page.getByLabel("Request name", { exact: true }).waitFor();
    if (
      (await page.getByLabel("Request name", { exact: true }).inputValue()) !==
      "Protected draft"
    )
      regressions.push("Rejected save lost its recoverable draft");
    assert.deepEqual(regressions, []);
    console.log(
      "PASS Chromium: atomic failed-save recovery and deletion of unsaved folder children",
    );
    await page.screenshot({
      path: "test-results/chromium-workspace.png",
      fullPage: true,
    });
    console.log(
      "PASS Chromium: actual extension HTTP, save/reload, curl import, response rendering",
    );
  } finally {
    await context.close();
  }
  if (!process.argv.includes("--chromium-only")) {
    const ext = await fixture("firefox");
    const xpi = path.join(temp, "apiman.xpi");
    execFileSync("python3", [
      "-c",
      'import zipfile,sys,pathlib; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w"); [z.write(f,f.relative_to(p)) for f in p.rglob("*") if f.is_file()]; z.close()',
      ext,
      xpi,
    ]);
    const uuid = "83c81e3c-3c20-4f96-861c-d302fc596667";
    const options = new firefox.Options()
      .setBinary(process.env.FIREFOX_BIN || playwrightFirefox.executablePath())
      .addArguments("-headless")
      .setPreference(
        "extensions.webextensions.uuids",
        JSON.stringify({ "apiman@local.invalid": uuid }),
      )
      .setPreference("extensions.webextOptionalPermissionPrompts", false);
    const driver = await new Builder()
      .forBrowser("firefox")
      .setFirefoxService(
        new firefox.ServiceBuilder().addArguments("--allow-system-access"),
      )
      .setFirefoxOptions(options)
      .build();
    try {
      await driver.installAddon(xpi, true);
      await driver.setContext("chrome");
      await driver.executeScript(
        "gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});",
        `moz-extension://${uuid}/workspace.html`,
      );
      await driver.setContext("content");
      const button = (name) =>
        driver.findElement(By.css(`button[aria-label="${name}"]`));
      await driver.wait(
        async () =>
          await driver
            .findElements(By.css('button[aria-label="New request"]'))
            .then((a) => a.length > 0),
        15000,
      );
      await (await button("New request")).click();
      const url = await driver.findElement(
        By.css('input[aria-label="Request URL"]'),
      );
      await url.clear();
      await url.sendKeys(origin + "/firefox");
      await (await button("Send request")).click();
      await driver.wait(
        async () =>
          await driver
            .findElement(By.css('[data-testid="response-status"]'))
            .getText()
            .then((t) => t.includes("200"))
            .catch(() => false),
        15000,
      );
      assert.match(
        await driver
          .findElement(By.css('[data-testid="response-body"]'))
          .getText(),
        /Hello from apiman/,
      );
      await driver
        .findElement(By.xpath('//button[contains(.,"Add assertion")]'))
        .click();
      await driver.wait(
        async () =>
          (await driver.findElements(By.css(".assertion-result.passed")))
            .length > 0,
        10000,
      );
      const expected = await driver.findElement(
        By.css('input[aria-label="Expected value"]'),
      );
      await expected.clear();
      await expected.sendKeys("201");
      await driver.wait(
        async () =>
          (await driver.findElements(By.css(".assertion-result.failed")))
            .length > 0,
        10000,
      );
      const requestName = await driver.findElement(
        By.css('input[aria-label="Request name"]'),
      );
      await requestName.clear();
      await requestName.sendKeys("Firefox echo");
      await (await button("Save request")).click();
      await driver.wait(
        async () =>
          (await driver.findElements(By.css(".unsaved"))).length === 0,
        10000,
      );
      await driver.navigate().refresh();
      await driver.wait(
        async () =>
          (await driver.findElements(By.css('input[aria-label="Request URL"]')))
            .length > 0,
        10000,
      );
      assert.equal(
        await driver
          .findElement(By.css('input[aria-label="Request URL"]'))
          .getAttribute("value"),
        origin + "/firefox",
      );
      assert.equal(
        await driver
          .findElement(By.css('input[aria-label="Expected value"]'))
          .getAttribute("value"),
        "201",
      );
      await verifyFirefoxRepositoryTree(driver);
      await writeFile(
        "test-results/firefox-workspace.png",
        await driver.takeScreenshot(),
        "base64",
      );
      console.log(
        "PASS Firefox: actual MV3 extension HTTP, assertions, save/reload and response rendering",
      );
    } finally {
      await driver.quit();
    }
  }
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(temp, { recursive: true, force: true });
}
