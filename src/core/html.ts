import { newRequest, pair, uid, type RequestDefinition } from "./model";

/** A disconnected template keeps scripts and resource loading inert, including during parsing. */
export function parseHtmlResponse(
  body: string,
  baseUrl: string,
): { html: string; drafts: RequestDefinition[] } {
  const template = document.createElement("template");
  template.innerHTML = body.slice(0, 1024 * 1024);
  const root = template.content;
  const drafts: RequestDefinition[] = [];
  const resolve = (value: string) => {
    const url = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("Unsupported link");
    return url.href;
  };
  for (const el of root.querySelectorAll("a[href],form")) {
    if (drafts.length >= 50) break;
    try {
      const r = newRequest(
        el.tagName === "FORM" ? "Response form" : "Response link",
      );
      r.url = resolve(
        el.getAttribute(el.tagName === "FORM" ? "action" : "href") || baseUrl,
      );
      if (el.tagName === "FORM") {
        r.method = (el.getAttribute("method") || "GET").toUpperCase();
        if (!["GET", "POST"].includes(r.method)) continue;
        const fields = [];
        for (const field of el.querySelectorAll<
          HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
        >("input,textarea,select")) {
          if (
            !field.name ||
            field.matches(":disabled") ||
            ["submit", "button", "reset", "image"].includes(field.type)
          )
            continue;
          if (
            ["checkbox", "radio"].includes(field.type) &&
            !(field as HTMLInputElement).checked
          )
            continue;
          if (field.type === "file") {
            fields.push({
              ...pair(field.name, ""),
              fileId: uid(),
              fileName: "Select a file",
            });
            continue;
          }
          if (field.tagName === "SELECT")
            for (const option of (field as HTMLSelectElement).selectedOptions)
              fields.push(pair(field.name, option.value));
          else fields.push(pair(field.name, field.value));
        }
        if (r.method === "GET") r.query = fields;
        else
          r.body = {
            type:
              el.getAttribute("enctype") === "multipart/form-data"
                ? "multipart"
                : "urlencoded",
            text: "",
            fields,
          };
      }
      drafts.push(r);
    } catch {
      /* Malformed and non-HTTP links are not executable requests. */
    }
  }
  // Deliberately small allowlist: preview layout/text, never active or network-capable markup.
  const allowed = new Set(
    "A ARTICLE ASIDE B BLOCKQUOTE BR CAPTION CODE DD DIV DL DT EM FIGCAPTION FIGURE FOOTER H1 H2 H3 H4 H5 H6 HEADER HR I LABEL LI MAIN OL P PRE SECTION SMALL SPAN STRONG TABLE TBODY TD TH THEAD TR U UL FORM INPUT TEXTAREA SELECT OPTION".split(
      " ",
    ),
  );
  for (const el of root.querySelectorAll("*")) {
    if (!allowed.has(el.tagName)) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes])
      if (
        ![
          "colspan",
          "rowspan",
          "value",
          "type",
          "checked",
          "selected",
          "disabled",
        ].includes(attr.name)
      )
        el.removeAttribute(attr.name);
    if (["INPUT", "SELECT", "TEXTAREA"].includes(el.tagName))
      el.setAttribute("disabled", "");
  }
  return {
    html: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; form-action 'none'; style-src 'unsafe-inline'">${template.innerHTML}`,
    drafts,
  };
}
