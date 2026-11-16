self.onmessage = (event: MessageEvent<{ pattern: string; value: string }>) => {
  try {
    const { pattern, value } = event.data;
    const match = pattern.match(/^\/(.*)\/([dgimsuvy]*)$/);
    const regex = new RegExp(match?.[1] ?? pattern, match?.[2] ?? "");
    self.postMessage({ passed: regex.test(value) });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
export {};
