// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  site: "https://docs.sweny.ai",
  vite: {
    resolve: {
      alias: {
        "@sweny-ai/core/workflows": fileURLToPath(new URL("../core/dist/workflows/browser.js", import.meta.url)),
      },
    },
  },
  integrations: [
    react(),
    starlight({
      customCss: ["./src/styles/explorer-overrides.css", "./src/styles/mobile.css"],
      title: "SWEny",
      description: "Turn natural language into reliable AI workflows",
      favicon: "/favicon.svg",
      head: [
        { tag: "link", attrs: { rel: "apple-touch-icon", href: "/apple-touch-icon.png" } },
        { tag: "meta", attrs: { property: "og:type", content: "website" } },
        { tag: "meta", attrs: { property: "og:image", content: "https://docs.sweny.ai/og-image.png" } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:image", content: "https://docs.sweny.ai/twitter-card.png" } },
      ],
      lastUpdated: true,
      social: [
        { icon: "external", label: "SWEny Cloud", href: "https://app.sweny.ai" },
        { icon: "github", label: "GitHub", href: "https://github.com/swenyai/sweny" },
      ],
      editLink: {
        baseUrl: "https://github.com/swenyai/sweny/edit/main/packages/web/",
      },
      components: {
        Footer: "./src/components/Footer.astro",
      },
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "getting-started" },
            { label: "Concepts", slug: "getting-started/concepts" },
            { label: "Quick Start", slug: "getting-started/quick-start" },
            { label: "Walkthrough", slug: "getting-started/walkthrough" },
            { label: "FAQ", slug: "getting-started/faq" },
          ],
        },
        {
          label: "CLI",
          items: [
            { label: "Quick Start", slug: "cli" },
            { label: "Commands", slug: "cli/commands" },
            { label: "E2E Testing", slug: "cli/e2e" },
            { label: "Examples", slug: "cli/examples" },
          ],
        },
        {
          label: "Workflows",
          items: [
            { label: "How Workflows Work", slug: "workflows" },
            { label: "Custom Workflows", slug: "workflows/custom" },
            { label: "Triage", slug: "workflows/triage" },
            { label: "Implement", slug: "workflows/implement" },
            { label: "YAML Reference", slug: "workflows/yaml-reference" },
          ],
        },
        {
          label: "Use Cases",
          items: [
            { label: "Overview", slug: "use-cases" },
            { label: "Data Pipelines", slug: "use-cases/data-pipelines" },
          ],
        },
        {
          label: "GitHub Action",
          items: [
            { label: "Setup", slug: "action" },
            { label: "Inputs & Outputs", slug: "action/inputs" },
            { label: "Cron & Dispatch", slug: "action/scheduling" },
            { label: "Service Map", slug: "action/service-map" },
            { label: "Examples", slug: "action/examples" },
          ],
        },
        {
          label: "Studio",
          items: [
            { label: "Overview", slug: "studio" },
            { label: "Editor Guide", slug: "studio/editor" },
            { label: "Embedding", slug: "studio/embedding" },
            { label: "Live Mode", slug: "studio/live" },
          ],
        },
        {
          label: "Skills",
          items: [
            { label: "Overview", slug: "skills" },
            { label: "GitHub", slug: "skills/github" },
            { label: "Linear", slug: "skills/linear" },
            { label: "Sentry", slug: "skills/sentry" },
            { label: "Datadog", slug: "skills/datadog" },
            { label: "BetterStack", slug: "skills/betterstack" },
            { label: "Slack", slug: "skills/slack" },
            { label: "Notification", slug: "skills/notification" },
          ],
        },
        {
          label: "Cloud Dashboard",
          items: [
            { label: "Overview", slug: "cloud" },
            { label: "Getting Started", slug: "cloud/getting-started" },
            { label: "Dashboard Guide", slug: "cloud/dashboard" },
            { label: "Pricing", slug: "cloud/pricing" },
            { label: "API Reference", slug: "cloud/api" },
          ],
        },
        {
          label: "Advanced",
          collapsed: true,
          items: [
            { label: "Architecture", slug: "advanced/architecture" },
            { label: "MCP Servers", slug: "advanced/mcp-servers" },
            { label: "Troubleshooting", slug: "advanced/troubleshooting" },
          ],
        },
      ],
    }),
  ],
});
