export interface RiskAssessment {
    level: "low" | "high";
    reasons: string[];
}
/** Assess the risk of a set of changed file paths. */
export declare function assessRisk(changedFiles: string[]): RiskAssessment;
//# sourceMappingURL=risk-assessor.d.ts.map