import type { RankedTeam } from "@/lib/supabase/types";

/**
 * The live scoreboard's court strip: kitchen zone tinted, the four
 * standing spots, and a pulse ring on whoever is serving. Purely
 * illustrative — it doesn't track individual player positions, only which
 * team (near/far pair) is serving, which is all `ranked_matches.serving_team`
 * actually records.
 */
export function CourtDiagram({ serving }: { serving: RankedTeam }) {
  const positions: Array<{ x: number; y: number; team: RankedTeam }> = [
    { x: 54, y: 50, team: "a" },
    { x: 54, y: 124, team: "a" },
    { x: 246, y: 50, team: "b" },
    { x: 246, y: 124, team: "b" },
  ];

  return (
    <svg viewBox="0 0 300 174" className="block w-full" role="img" aria-label={`Serving: team ${serving.toUpperCase()}`}>
      <rect x="2" y="2" width="296" height="170" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      <rect x="108" y="2" width="84" height="170" fill="currentColor" fillOpacity="0.16" className="text-rally" />
      <line x1="108" y1="2" x2="108" y2="172" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      <line x1="192" y1="2" x2="192" y2="172" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      <line x1="150" y1="0" x2="150" y2="174" stroke="currentColor" strokeWidth="3" strokeDasharray="6 5" />
      <line x1="2" y1="87" x2="108" y2="87" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      <line x1="192" y1="87" x2="298" y2="87" stroke="currentColor" strokeOpacity="0.35" strokeWidth="2" />
      {positions.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="13" className={p.team === "a" ? "fill-rally" : "fill-white"} />
          {p.team === serving && (
            <circle cx={p.x} cy={p.y} r="20" fill="none" className="fill-none stroke-rally" strokeWidth="2.5">
              <animate attributeName="opacity" values="1;0.25;1" dur="1.1s" repeatCount="indefinite" />
            </circle>
          )}
        </g>
      ))}
      <text x="12" y="166" fill="currentColor" fillOpacity="0.5" fontSize="9" fontWeight="600" letterSpacing="1">
        TEAM A
      </text>
      <text x="248" y="166" fill="currentColor" fillOpacity="0.5" fontSize="9" fontWeight="600" letterSpacing="1">
        TEAM B
      </text>
    </svg>
  );
}
