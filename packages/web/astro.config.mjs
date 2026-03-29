// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import react from "@astrojs/react";

export default defineConfig({
  site: "https://docs.sweny.ai",
  integrations: [
    react(),
    starlight({
      customCss: ["./src/styles/explorer-overrides.css"],
      title: "SWEny",
      description: "Autonomous engineering tools powered by Claude AI",
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
          label: "Workflows",
          items: [
            { label: "How Workflows Work", slug: "workflows" },
            { label: "Triage", slug: "workflows/triage" },
            { label: "Implement", slug: "workflows/implement" },
            { label: "Custom Workflows", slug: "workflows/custom" },
            { label: "YAML Reference", slug: "workflows/yaml-reference" },
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
          label: "CLI",
          items: [
            { label: "Quick Start", slug: "cli" },
            { label: "Commands", slug: "cli/commands" },
            { label: "Examples", slug: "cli/examples" },
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
