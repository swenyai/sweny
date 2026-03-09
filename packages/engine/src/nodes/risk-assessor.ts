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

export interface RiskAssessment {
  level: "low" | "high";
  reasons: string[];
}

/** Assess the risk of a set of changed file paths. */
export function assessRisk(changedFiles: string[]): RiskAssessment {
  const reasons: string[] = [];

  if (changedFiles.length > 10) {
    reasons.push(`Large change scope: ${changedFiles.length} files modified`);
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
