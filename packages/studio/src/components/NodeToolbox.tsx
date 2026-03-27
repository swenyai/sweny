import { type DragEvent, useState, useMemo } from "react";
import { SkillIcon, skillColors } from "./SkillIcon.js";

interface NodeTemplate {
  name: string;
  defaultId: string;
  skills: string[];
  description: string;
  instruction: string;
}

const TEMPLATES: { category: string; items: NodeTemplate[] }[] = [
  {
    category: "General",
    items: [
      {
        name: "Blank Node",
        defaultId: "new_node",
        skills: [],
        description: "Empty node",
        instruction: "",
      },
      {
        name: "Decision Gate",
        defaultId: "decide",
        skills: [],
        description: "Route based on conditions",
        instruction:
          "Evaluate the context and decide the next step. Use the output schema to classify the decision so downstream edges can route accordingly.",
      },
      {
        name: "Human Review",
        defaultId: "human_review",
        skills: ["slack"],
        description: "Pause for human approval",
        instruction:
          "Send the current findings to the team for review and wait for approval before proceeding. Summarize what was done and what needs sign-off.",
      },
      {
        name: "Validate Output",
        defaultId: "validate",
        skills: [],
        description: "Check results meet criteria",
        instruction:
          "Validate the output from the previous step. Check for completeness, correctness, and adherence to the expected format. Report any issues found.",
      },
    ],
  },
  {
    category: "Observability",
    items: [
      {
        name: "Gather Context",
        defaultId: "gather",
        skills: ["github", "sentry", "datadog", "betterstack"],
        description: "Collect logs, errors, and metrics",
        instruction:
          "Gather all relevant context using the available observability and source control tools. Be thorough.",
      },
      {
        name: "Root Cause Analysis",
        defaultId: "investigate",
        skills: ["github"],
        description: "Analyze data and determine root cause",
        instruction:
          "Based on the gathered context, perform a root cause analysis. Identify the most likely cause, assess severity, and recommend a fix.",
      },
      {
        name: "Search Logs",
        defaultId: "search_logs",
        skills: ["datadog", "betterstack"],
        description: "Query logs for errors or patterns",
        instruction:
          "Search logs for the relevant time window around the incident. Look for error patterns, stack traces, and anomalies. Summarize key findings.",
      },
      {
        name: "Check Alerts",
        defaultId: "check_alerts",
        skills: ["datadog", "betterstack", "sentry"],
        description: "Review active alerts and monitors",
        instruction:
          "Check active alerts and monitors for related incidents. Identify if this issue has triggered other alerts or if there are correlated problems.",
      },
    ],
  },
  {
    category: "Code",
    items: [
      {
        name: "Analyze Code",
        defaultId: "analyze_code",
        skills: ["github"],
        description: "Read and understand the codebase",
        instruction:
          "Analyze the relevant code to understand the current implementation, identify the affected areas, and determine what changes are needed.",
      },
      {
        name: "Implement Fix",
        defaultId: "implement",
        skills: ["github"],
        description: "Write and apply a code change",
        instruction:
          "Implement the planned fix based on the analysis. Write clean, well-tested code that addresses the root cause without introducing regressions.",
      },
      {
        name: "Code Review",
        defaultId: "review",
        skills: ["github"],
        description: "Review changes for quality",
        instruction:
          "Review the code changes for correctness, style, performance, and security. Flag any issues and suggest improvements.",
      },
      {
        name: "Create PR",
        defaultId: "create_pr",
        skills: ["github"],
        description: "Open a pull request",
        instruction:
          "Create a pull request with a clear title and description. Include what changed, why, how to test, and link to the relevant issue.",
      },
    ],
  },
  {
    category: "Tasks",
    items: [
      {
        name: "Create Issue",
        defaultId: "create_issue",
        skills: ["linear", "github"],
        description: "File a ticket in your issue tracker",
        instruction:
          "Create an issue documenting the findings. Include root cause, severity, affected services, and recommended fix.",
      },
      {
        name: "Update Issue",
        defaultId: "update_issue",
        skills: ["linear"],
        description: "Update an existing ticket",
        instruction:
          "Update the existing issue with the latest findings, status changes, or resolution details. Keep the issue timeline accurate.",
      },
      {
        name: "Search Issues",
        defaultId: "search_issues",
        skills: ["linear", "github"],
        description: "Find related or duplicate issues",
        instruction:
          "Search for existing issues related to this problem. Check for duplicates, related incidents, and prior investigations that may provide useful context.",
      },
    ],
  },
  {
    category: "Notification",
    items: [
      {
        name: "Notify Team",
        defaultId: "notify",
        skills: ["slack", "notification"],
        description: "Send alerts to your team",
        instruction:
          "Send a notification summarizing the result. Include a brief summary, severity, and a link to the created issue.",
      },
      {
        name: "Send Summary",
        defaultId: "send_summary",
        skills: ["slack", "notification"],
        description: "Post a detailed report",
        instruction:
          "Compile and send a comprehensive summary of the workflow results. Include findings, actions taken, outcomes, and any follow-up items.",
      },
      {
        name: "Escalate",
        defaultId: "escalate",
        skills: ["slack", "notification", "linear"],
        description: "Escalate to on-call or leadership",
        instruction:
          "Escalate this issue to the appropriate on-call engineer or team lead. Include severity, impact, what has been tried so far, and urgency level.",
      },
    ],
  },
];

function onDragStart(event: DragEvent, template: NodeTemplate) {
  event.dataTransfer.setData("application/sweny-node", JSON.stringify(template));
  event.dataTransfer.effectAllowed = "move";
}

export function NodeToolbox() {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return TEMPLATES;
    return TEMPLATES.map((group) => ({
      ...group,
      items: group.items.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.skills.some((s) => s.toLowerCase().includes(q)),
      ),
    })).filter((group) => group.items.length > 0);
  }, [search]);

  const isSearching = search.trim().length > 0;

  return (
    <div className="w-56 bg-gray-50 border-r border-gray-200 overflow-y-auto flex-shrink-0 flex flex-col">
      {/* Header + search */}
      <div className="px-3 pt-3 pb-1 sticky top-0 bg-gray-50 z-10">
        <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Drag to canvas</h2>
        <div className="relative mb-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes..."
            className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-xs bg-white placeholder-gray-300 focus:outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-xs leading-none"
            >
              x
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="px-3 py-6 text-center">
          <p className="text-[10px] text-gray-400">No templates match your search</p>
        </div>
      )}

      {filtered.map((group) => {
        const isCollapsed = !isSearching && collapsed[group.category];
        return (
          <div key={group.category} className="px-2 pb-1">
            <button
              onClick={() => setCollapsed((prev) => ({ ...prev, [group.category]: !prev[group.category] }))}
              className="flex items-center gap-1 w-full text-left px-1 py-1 rounded hover:bg-gray-100 transition-colors"
            >
              <svg
                width="8"
                height="8"
                viewBox="0 0 8 8"
                className={`text-gray-400 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
              >
                <path d="M2 1l4 3-4 3z" fill="currentColor" />
              </svg>
              <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">{group.category}</span>
              <span className="text-[8px] text-gray-300 ml-auto">{group.items.length}</span>
            </button>
            <div
              style={{
                maxHeight: isCollapsed ? 0 : 1000,
                overflow: "hidden",
                transition: "max-height 0.2s ease",
              }}
            >
              <div className="flex flex-col gap-1.5 pb-1">
                {group.items.map((template) => (
                  <div
                    key={template.defaultId}
                    draggable
                    onDragStart={(e) => onDragStart(e, template)}
                    className="bg-white border border-gray-200 rounded-md px-2.5 py-2 cursor-grab active:cursor-grabbing hover:border-indigo-300 hover:shadow-sm transition-all select-none"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{
                          background:
                            template.skills.length > 0 ? (skillColors[template.skills[0]] ?? "#6366f1") : "#94a3b8",
                        }}
                      />
                      <span className="text-xs font-semibold text-gray-700">{template.name}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{template.description}</p>
                    {template.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {template.skills.map((sid) => (
                          <span
                            key={sid}
                            className="text-[8px] font-medium px-1.5 py-0.5 rounded inline-flex items-center gap-0.5"
                            style={{
                              background: `${skillColors[sid] ?? "#6366f1"}15`,
                              color: skillColors[sid] ?? "#6366f1",
                            }}
                          >
                            <SkillIcon skillId={sid} size={10} />
                            {sid}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
