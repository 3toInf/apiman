import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
export default defineBackground(() => {
  browser.action.onClicked.addListener(async () => {
    const url = browser.runtime.getURL("/workspace.html");
    const tabs = await browser.tabs.query({});
    const existing = tabs.find((t) => t.url === url);
    if (existing?.id) {
      await browser.tabs.update(existing.id, { active: true });
      if (existing.windowId)
        await browser.windows.update(existing.windowId, { focused: true });
    } else await browser.tabs.create({ url });
  });
});
