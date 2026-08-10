import { cn } from "@/lib/utils";
import type { CourtSurfaceColor } from "@/types/court";

const SURFACE_COLORS: Record<CourtSurfaceColor, { fill: string; edge: string }> = {
  blue: { fill: "#2F6FE0", edge: "#1D4FAE" },
  green: { fill: "#1E9E5A", edge: "#147241" },
  terracotta: { fill: "#C1573A", edge: "#93402A" },
  teal: { fill: "#147D82", edge: "#0E5A5E" },
  navy: { fill: "#26436E", edge: "#152B4C" },
  sand: { fill: "#D9A857", edge: "#AC8140" },
};

type CourtSurfaceProps = {
  surfaceColor: CourtSurfaceColor;
  indoor: boolean;
  className?: string;
};

const SURFACE_COLOR_KEYS = Object.keys(SURFACE_COLORS) as CourtSurfaceColor[];

/**
 * Deterministic color choice from any stable id (a real venue's UUID) —
 * the same venue always renders the same illustration palette instead of
 * a different random one on every page load, while still not requiring a
 * `surfaceColor` column to exist on `venues`.
 */
export function deterministicSurfaceColor(id: string): CourtSurfaceColor {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return SURFACE_COLOR_KEYS[Math.abs(hash) % SURFACE_COLOR_KEYS.length];
}

/**
 * Illustrated aerial court view used in place of real venue photography.
 * Phase 1 has no photo pipeline for onboarded venues, so cards render a
 * deterministic, brand-consistent illustration instead of a broken or
 * generic stock image. Swap for real photos once venue onboarding ships.
 */
export function CourtSurface({ surfaceColor, indoor, className }: CourtSurfaceProps) {
  const { fill, edge } = SURFACE_COLORS[surfaceColor];
  const bg = indoor ? "url(#indoor-bg)" : "url(#outdoor-bg)";

  return (
    <svg
      viewBox="0 0 400 260"
      className={cn("h-full w-full", className)}
      role="img"
      aria-label={`${indoor ? "Indoor" : "Outdoor"} pickleball court illustration`}
    >
      <defs>
        <linearGradient id="outdoor-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#BEE0F5" />
          <stop offset="55%" stopColor="#E9F3EC" />
          <stop offset="100%" stopColor="#F4EFE4" />
        </linearGradient>
        <linearGradient id="indoor-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3A3F4A" />
          <stop offset="100%" stopColor="#20232B" />
        </linearGradient>
      </defs>

      <rect width="400" height="260" fill={bg} />

      {!indoor && (
        <circle cx="352" cy="34" r="26" fill="#FFF6DE" opacity="0.8" />
      )}
      {indoor && (
        <>
          <ellipse cx="120" cy="18" rx="46" ry="10" fill="#FFF7E0" opacity="0.18" />
          <ellipse cx="280" cy="14" rx="46" ry="10" fill="#FFF7E0" opacity="0.18" />
        </>
      )}

      {/* out-of-bounds edge */}
      <rect x="32" y="24" width="336" height="212" rx="14" fill={edge} />
      {/* court surface */}
      <rect x="44" y="34" width="312" height="192" rx="8" fill={fill} />

      {/* boundary line */}
      <rect
        x="56"
        y="44"
        width="288"
        height="172"
        rx="4"
        fill="none"
        stroke="#F8F7F3"
        strokeWidth="3"
      />

      {/* kitchen lines */}
      <line x1="144" y1="44" x2="144" y2="216" stroke="#F8F7F3" strokeWidth="2.5" />
      <line x1="256" y1="44" x2="256" y2="216" stroke="#F8F7F3" strokeWidth="2.5" />

      {/* service centerlines */}
      <line x1="56" y1="130" x2="144" y2="130" stroke="#F8F7F3" strokeWidth="2" opacity="0.85" />
      <line x1="256" y1="130" x2="344" y2="130" stroke="#F8F7F3" strokeWidth="2" opacity="0.85" />

      {/* net */}
      <line x1="200" y1="40" x2="200" y2="220" stroke="#12151A" strokeWidth="5" opacity="0.85" />
      <line x1="200" y1="40" x2="200" y2="220" stroke="#F8F7F3" strokeWidth="1.5" strokeDasharray="3 4" opacity="0.6" />

      {/* pickleball accent */}
      <g transform="translate(338 200)">
        <circle r="16" fill="#F3700F" stroke="#F8F7F3" strokeWidth="2.5" />
        <circle cx="-5" cy="-6" r="1.6" fill="#12151A" />
        <circle cx="5" cy="-6" r="1.6" fill="#12151A" />
        <circle cx="-7" cy="3" r="1.6" fill="#12151A" />
        <circle cx="0" cy="6" r="1.6" fill="#12151A" />
        <circle cx="7" cy="3" r="1.6" fill="#12151A" />
      </g>
    </svg>
  );
}
