/** Patterns that indicate a high-risk change requiring human review. */
const HIGH_RISK_PATTERNS: RegExp[] = [
  /migrations?\//i,
  /\bauth\//i,
  /\bcrypto\//i,
  /\bsecurity\//i,
  /\.github\/workflows\//i,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^pnpm-lock\.yaml$/,
  /^yarn\.lock$/,
  /schema\.(ts|js|sql|prisma)$/i,
];

/**
 * Files above this count indicate a broadly-scoped change that warrants human
 * review. 20 was chosen as a practical ceiling: typical agentic fixes touch
 * 1–10 source files; anything larger risks unintended side-effects across
 * subsystems. Non-code files (docs, artifacts, build outputs) are excluded
 * from this count via EXCLUDED_FROM_COUNT so they don't inflate the total.
 */
const LARGE_CHANGE_THRESHOLD = 20;

/**
 * Paths that don't represent meaningful code changes and should be excluded
 * from the file-count threshold. Agent analysis artifacts, docs, and build
 * outputs inflate the count without adding real risk.
 */
const EXCLUDED_FROM_COUNT: RegExp[] = [/\.github\/triage-analysis\//, /\.md$/i, /^dist\//, /\.map$/, /\.d\.ts$/];

function isCountable(file: string): boolean {
  return !EXCLUDED_FROM_COUNT.some((p) => p.test(file));
}

export interface RiskAssessment {
  level: "low" | "high";
  reasons: string[];
}

/** Assess the risk of a set of changed file paths. */
export function assessRisk(changedFiles: string[]): RiskAssessment {
  const reasons: string[] = [];

  const countableFiles = changedFiles.filter(isCountable);
  if (countableFiles.length > LARGE_CHANGE_THRESHOLD) {
    reasons.push(`Large change scope: ${countableFiles.length} code files modified`);
  }

  for (const file of changedFiles) {
    for (const pattern of HIGH_RISK_PATTERNS) {
      if (pattern.test(file)) {
        reasons.push(`High-risk file: ${file}`);
        break;
      }
    }
  }

  return {
    level: reasons.length > 0 ? "high" : "low",
    reasons,
  };
}
