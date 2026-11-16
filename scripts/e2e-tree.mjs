import { expect } from "@playwright/test";
import assert from "node:assert/strict";
import { By } from "selenium-webdriver";

export const treeFixture = {
  format: "apiman",
  schemaVersion: 1,
  nodes: [
    { id: "tree-project", name: "Tree project", kind: "project", order: 0 },
    {
      id: "tree-service",
      parentId: "tree-project",
      name: "Tree service",
      kind: "service",
      order: 0,
    },
    {
      id: "tree-scenario",
      parentId: "tree-service",
      name: "Tree scenario",
      kind: "scenario",
      order: 0,
    },
    { id: "tree-other", name: "Other project", kind: "project", order: 1 },
  ],
  requests: [
    {
      id: "tree-request",
      parentId: "tree-scenario",
      name: "Nested tree request",
      method: "GET",
      url: "https://example.test/tree",
      query: [],
      headers: [],
      body: { type: "none", text: "", fields: [] },
      auth: { type: "none" },
      assertions: [],
      timeoutMs: 30000,
      maxResponseBytes: 20971520,
      cookies: true,
      description: "",
      unsupported: [],
      order: 0,
    },
  ],
  scenarios: [
    {
      id: "tree-scenario",
      name: "Tree scenario",
      requestIds: ["tree-request"],
      stopOnFailure: true,
      repeat: 1,
      delayMs: 0,
    },
  ],
  environments: [],
};

export async function verifyRepositoryTree(page) {
  const row = (name) =>
    page.locator(".tree-row").filter({
      has: page.locator(".tree-label").getByText(name, { exact: true }),
    });
  const toggle = (name) =>
    row(name).getByRole("button", { name: "Toggle folder", exact: true });
  const importTree = async (document) => {
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByLabel("Import text").fill(JSON.stringify(document));
    await page
      .getByRole("button", { name: "Preview import", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Import data", exact: true })
      .click();
  };
  await importTree(treeFixture);
  await expect(row("Nested tree request")).toBeVisible();

  // A child folder must keep its state independently of its parent across reloads.
  await toggle("Tree service").click();
  await expect(row("Tree scenario")).toHaveCount(0);
  await page.reload();
  await expect(row("Tree service")).toBeVisible();
  await expect(row("Tree scenario")).toHaveCount(0);
  await expect(toggle("Tree service")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await toggle("Tree project").click();
  await page.reload();
  await expect(row("Tree project")).toBeVisible();
  await expect(row("Tree service")).toHaveCount(0);
  await toggle("Tree project").press("Enter");
  await expect(row("Tree service")).toBeVisible();
  await expect(row("Tree scenario")).toHaveCount(0);
  await toggle("Tree service").press("Space");
  await expect(row("Nested tree request")).toBeVisible();

  const expand = page.getByRole("button", {
    name: "Expand all folders",
    exact: true,
  });
  const collapse = page.getByRole("button", {
    name: "Collapse all folders",
    exact: true,
  });
  await collapse.click();
  await page.reload();
  await expect(row("Tree project")).toBeVisible();
  await expect(row("Other project")).toBeVisible();
  await expect(row("Tree service")).toHaveCount(0);
  await toggle("Tree project").click();
  await expect(row("Tree scenario")).toHaveCount(0);
  await toggle("Tree service").click();
  await expect(row("Tree scenario")).toBeVisible();
  await expect(row("Nested tree request")).toHaveCount(0);

  // Searching reveals a collapsed result without changing the stored folder state.
  const search = page.getByLabel("Search repository", { exact: true });
  await search.fill("Nested tree request");
  await expect(row("Nested tree request")).toBeVisible();
  await expect(toggle("Tree scenario")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(expand).toBeDisabled();
  await expect(collapse).toBeDisabled();
  await search.fill("");
  await expect(row("Nested tree request")).toHaveCount(0);
  await page.reload();
  await expect(row("Tree scenario")).toBeVisible();
  await expect(row("Nested tree request")).toHaveCount(0);

  await expand.click();
  await page.reload();
  await expect(row("Nested tree request")).toBeVisible();
  await expect(expand).toBeDisabled();

  // Importing another collection must not reset the existing collection's state.
  await toggle("Tree project").click();
  await importTree({
    ...treeFixture,
    nodes: [
      { id: "later-project", name: "Later project", kind: "project", order: 0 },
    ],
    requests: [],
    scenarios: [],
  });
  await expect(row("Later project")).toBeVisible();
  await expect(row("Tree service")).toHaveCount(0);
  await page.reload();
  await expect(row("Later project")).toBeVisible();
  await expect(row("Tree service")).toHaveCount(0);
  await expand.click();
  await expect(row("Nested tree request")).toBeVisible();
  const viewport = page.viewportSize();
  for (const width of [1024, 720]) {
    await page.setViewportSize({ width, height: 800 });
    const sidebar = await page.locator(".sidebar").boundingBox();
    for (const control of [expand, collapse]) {
      const box = await control.boundingBox();
      assert.ok(
        box.x >= sidebar.x && box.x + box.width <= sidebar.x + sidebar.width,
        `Folder controls must fit inside the sidebar at ${width}px`,
      );
    }
  }
  await page.setViewportSize(viewport);
  await page.screenshot({
    path: "test-results/chromium-tree-controls.png",
    fullPage: true,
  });
  await page
    .locator(".tree-label")
    .getByText("Echo test", { exact: true })
    .click();
  console.log(
    "PASS Chromium: nested folder persistence, expand/collapse all, keyboard controls, search and import preserve state",
  );
}

export async function verifyFirefoxRepositoryTree(driver) {
  const textButton = (name) =>
    driver.findElement(By.xpath(`//button[normalize-space(.)='${name}']`));
  const row = (name) =>
    By.xpath(
      `//div[contains(concat(' ', normalize-space(@class), ' '), ' tree-row ')][.//span[normalize-space(.)='${name}']]`,
    );
  const waitForRow = (name) =>
    driver.wait(
      async () => (await driver.findElements(row(name))).length > 0,
      10000,
    );
  const toggle = async (name) =>
    (await driver.findElement(row(name))).findElement(
      By.css('[aria-label="Toggle folder"]'),
    );
  const hidden = async (name) =>
    assert.equal((await driver.findElements(row(name))).length, 0);
  await (await textButton("Import")).click();
  await driver
    .findElement(By.css('[aria-label="Import text"]'))
    .sendKeys(JSON.stringify(treeFixture));
  await (await textButton("Preview import")).click();
  await (await textButton("Import data")).click();
  await waitForRow("Nested tree request");
  await (await toggle("Tree service")).click();
  await driver.wait(
    async () => (await driver.findElements(row("Tree scenario"))).length === 0,
    10000,
  );
  await driver.navigate().refresh();
  await waitForRow("Tree service");
  await hidden("Tree scenario");
  assert.equal(
    await (await toggle("Tree service")).getAttribute("aria-expanded"),
    "false",
  );

  await driver
    .findElement(By.css('[aria-label="Collapse all folders"]'))
    .click();
  await driver.navigate().refresh();
  await waitForRow("Tree project");
  await hidden("Tree service");
  await (await toggle("Tree project")).click();
  await waitForRow("Tree service");
  await hidden("Tree scenario");
  await driver.findElement(By.css('[aria-label="Expand all folders"]')).click();
  await waitForRow("Nested tree request");
  await driver.navigate().refresh();
  await waitForRow("Nested tree request");
  console.log(
    "PASS Firefox: nested folder persistence and expand/collapse all survive reloads",
  );
}
