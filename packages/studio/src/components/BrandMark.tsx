import { tok } from "../theme.js";

/**
 * Lockup for dark chrome (assets/logo-lockup-light.svg, the variant for dark backgrounds).
 * Inlined so it ships in the library build with no asset pipeline.
 */
export function BrandLockup({ height = 22 }: { height?: number }) {
  return (
    <svg
      role="img"
      aria-label="SWEny"
      data-testid="brand-lockup"
      viewBox="0 0 420 52"
      height={height}
      width={Math.round((height * 420) / 52)}
      style={{ flexShrink: 0 }}
    >
      <circle cx="14" cy="6" r="5.5" fill="#1e3a5f" stroke="#3b82f6" strokeWidth="1.5" />
      <rect x="3" y="17" width="10" height="10" rx="3" fill="#1e3a5f" stroke="#3b82f6" strokeWidth="1.5" />
      <rect x="19" y="17" width="10" height="10" rx="3" fill="#1e3a5f" stroke="#475569" strokeWidth="1.5" />
      <circle cx="14" cy="40" r="5.5" fill="#2563eb" stroke="#60a5fa" strokeWidth="1.5" />
      <line x1="14" y1="12" x2="8" y2="17" stroke="#334155" strokeWidth="1.5" />
      <line x1="14" y1="12" x2="24" y2="17" stroke="#334155" strokeWidth="1.5" />
      <line x1="8" y1="27" x2="14" y2="34" stroke="#334155" strokeWidth="1.5" />
      <line x1="24" y1="27" x2="14" y2="34" stroke="#334155" strokeWidth="1.5" />
      <text
        x="42"
        y="40"
        fontFamily="system-ui, -apple-system, 'Helvetica Neue', sans-serif"
        fontSize="46"
        fontWeight="800"
        letterSpacing="-1.5"
        fill="#f1f5f9"
      >
        SWE<tspan fill="#3b82f6">ny</tspan>
      </text>
    </svg>
  );
}

/** Empty-canvas watermark: the DAG icon, theme-aware, with a hint line. */
export function EmptyCanvasWatermark() {
  return (
    <div
      data-testid="empty-canvas"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none z-10"
      style={{ color: tok("textSecondary") }}
    >
      <svg viewBox="0 0 80 100" width={96} height={120} aria-hidden="true" style={{ opacity: 0.35 }}>
        <line x1="40" y1="18" x2="20" y2="38" stroke={tok("textMuted")} strokeWidth="2" />
        <line x1="40" y1="18" x2="60" y2="38" stroke={tok("textMuted")} strokeWidth="2" />
        <line x1="20" y1="54" x2="40" y2="82" stroke={tok("textMuted")} strokeWidth="2" />
        <line x1="60" y1="54" x2="40" y2="82" stroke={tok("textMuted")} strokeWidth="2" />
        <circle cx="40" cy="10" r="8" fill="none" stroke={tok("primary")} strokeWidth="2" />
        <rect x="12" y="38" width="16" height="16" rx="4" fill="none" stroke={tok("primary")} strokeWidth="2" />
        <rect x="52" y="38" width="16" height="16" rx="4" fill="none" stroke={tok("textMuted")} strokeWidth="2" />
        <circle cx="40" cy="90" r="8" fill={tok("primary")} stroke={tok("primaryHover")} strokeWidth="2" />
      </svg>
      <p className="text-sm font-semibold">No nodes yet</p>
      <p className="text-xs">Use New or Import in the toolbar to start a workflow</p>
    </div>
  );
}
