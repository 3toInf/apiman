import { defineConfig } from "wxt";
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifestVersion: 3,
  zip: {
    excludeSources: [
      "test-results/**",
      "playwright-report/**",
      "coverage/**",
      ".superpowers/**",
      "*.log",
    ],
  },
  hooks: {
    "vite:build:extendConfig": (entrypoints, config) => {
      if (entrypoints.some((entry) => entry.type === "background")) return;
      config.build ??= {};
      config.build.rolldownOptions ??= {};
      config.build.rolldownOptions.output = {
        codeSplitting: {
          groups: [
            { name: "html-preview", test: /src\/core\/html\.ts$/ },
            {
              name: "react-vendor",
              test: /node_modules\/(react|react-dom|scheduler)\//,
            },
            {
              name: "editor-vendor",
              test: /node_modules\/(@codemirror|@lezer)\//,
            },
          ],
        },
      };
    },
  },
  manifest: ({ browser }) => ({
    name: "apiman — API Tester",
    description:
      "A local API workspace: requests, environments, assertions and scenarios. Import your Talend repository.",
    permissions: ["storage", "unlimitedStorage"],
    optional_host_permissions: ["http://*/*", "https://*/*"],
    action: {
      default_title: "Open apiman",
      default_icon: {
        16: "icon-16.png",
        32: "icon-32.png",
        48: "icon-48.png",
        64: "icon-64.png",
      },
    },
    icons: {
      16: "icon-16.png",
      32: "icon-32.png",
      48: "icon-48.png",
      64: "icon-64.png",
      96: "icon-96.png",
      128: "icon-128.png",
      256: "icon-256.png",
      512: "icon-512.png",
    },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "apiman@local.invalid",
              strict_min_version: "140.0",
              data_collection_permissions: { required: ["none"] },
            },
            gecko_android: { strict_min_version: "142.0" },
          },
        }
      : { minimum_chrome_version: "120" }),
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'",
    },
  }),
});
