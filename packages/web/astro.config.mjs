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
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/swenyai/sweny" }],
      editLink: {
        baseUrl: "https://github.com/swenyai/sweny/edit/main/packages/web/",
      },
      sidebar: [
        {
          label: "Getting Started",
          items: [
            { label: "Introduction", slug: "getting-started" },
            { label: "Concepts", slug: "getting-started/concepts" },
            { label: "Walkthrough", slug: "getting-started/walkthrough" },
            { label: "Troubleshooting", slug: "getting-started/troubleshooting" },
          ],
        },
        {
          label: "Triage Recipe",
          items: [
            { label: "Overview", slug: "recipes/triage" },
            { label: "Action Inputs", slug: "action/inputs" },
            { label: "Action Outputs", slug: "action/outputs" },
            { label: "Examples", slug: "action/examples" },
            { label: "Service Map", slug: "action/service-map" },
          ],
        },
        {
          label: "CLI",
          items: [
            { label: "Quick Start", slug: "cli" },
            { label: "Inputs", slug: "cli/inputs" },
            { label: "Examples", slug: "cli/examples" },
          ],
        },
        {
          label: "Provider Reference",
          autogenerate: { directory: "providers" },
        },
        {
          label: "Studio",
          items: [
            { label: "Live Recipe Explorer", slug: "studio/explorer" },
            { label: "Recipe Authoring", slug: "studio/recipe-authoring" },
            { label: "Overview", slug: "studio" },
          ],
        },
        {
          label: "Advanced",
          collapsed: true,
          items: [
            { label: "Engine & Recipes", slug: "getting-started/engine" },
            { label: "Provider Architecture", slug: "getting-started/providers" },
            { label: "Deploying the Agent", slug: "getting-started/agent" },
            { label: "Agent Plugins", slug: "agent/plugins" },
            { label: "Built-in Plugins", slug: "agent/built-in-plugins" },
            { label: "Agent Configuration", slug: "agent/configuration" },
          ],
        },
      ],
    }),
  ],
});
