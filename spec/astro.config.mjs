// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://spec.sweny.ai",
  integrations: [
    starlight({
      title: "SWEny Workflow Specification",
      description: "A declarative format for AI agent orchestration",
      favicon: "/favicon.svg",
      head: [{ tag: "meta", attrs: { property: "og:type", content: "website" } }],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/swenyai/sweny" },
        { icon: "external", label: "Docs", href: "https://docs.sweny.ai" },
      ],
      components: {
        Footer: "./src/components/Footer.astro",
      },
      editLink: {
        baseUrl: "https://github.com/swenyai/sweny/edit/main/spec/",
      },
      sidebar: [
        { label: "Overview", slug: "" },
        { label: "Workflow", slug: "workflow" },
        { label: "Nodes", slug: "nodes" },
        { label: "Edges & Routing", slug: "edges" },
        { label: "Sources", slug: "sources" },
        { label: "Skills & Tools", slug: "skills" },
        { label: "Execution Model", slug: "execution" },
      ],
    }),
  ],
});
