/**
 * Emits the AIR/Rally Ranked tier badges into `public/ranks/`.
 *
 * The seven icons come from the Rank Icon System V1 design file. They are
 * generated rather than hand-copied because each one exists twice — once
 * with navy ink for cream surfaces (`rank-<slug>.svg`) and once with cream
 * ink for navy surfaces (`rank-<slug>-navy.svg`) — and the two differ only
 * in which color plays "ink". Keeping one geometry table means the pair can
 * never drift, and the mobile app can regenerate the identical set from this
 * same source instead of receiving a copy that slowly diverges.
 *
 *   npx ts-node --compiler-options '{"module":"commonjs"}' scripts/generate-rank-badges.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Ink on cream surfaces. Matches --navy in globals.css. */
const INK_ON_LIGHT = "#0f2747";
/** Ink on navy surfaces — the brand cream, not pure white, so the badges sit warm against navy. */
const INK_ON_NAVY = "#f6f1e8";

type Tier = {
  /** 1–7, low to high. Stored as `player_ranks.tier` in Postgres. */
  tier: number;
  slug: string;
  name: string;
  /**
   * The tier's material. The ladder reads as an escalation of substance:
   * wood, then bronze, then the brand orange from Volleyer up — with
   * regalia (crown, laurel) layered on for the top two.
   */
  material: string;
  /** `INK` and `MAT` are substituted per variant. */
  body: string;
};

const BALL_DOTS = (cx: number, cy: number, r: number, fill: string): string => {
  // The five perforations of a pickleball, at the icon's own scale.
  const o = r / 22;
  const dots: Array<[number, number]> = [
    [cx - 8 * o, cy - 8 * o],
    [cx + 8 * o, cy - 8 * o],
    [cx, cy + o],
    [cx - 10 * o, cy + 8 * o],
    [cx + 10 * o, cy + 8 * o],
  ];
  return `<g fill="${fill}">${dots
    .map(([x, y]) => `<circle cx="${round(x)}" cy="${round(y)}" r="${round(r * 0.15)}"/>`)
    .join("")}</g>`;
};

function round(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** Champion's twelve laurel spokes, struck at 30° intervals. */
const LAUREL = Array.from({ length: 12 }, (_, i) => i * 30 + 15)
  .map((deg) => `<rect x="59" y="6" width="10" height="24" rx="5" transform="rotate(${deg} 64 64)"/>`)
  .join("");

const TIERS: Tier[] = [
  {
    tier: 1,
    slug: "dinker",
    name: "Dinker",
    material: "#c2ad8b",
    // A wooden paddle mid-dink, ball above the face.
    body:
      `<path d="M12 98 Q26 30 92 20 L98 42 Q44 52 34 100 Z" fill="MAT" stroke="INK" stroke-width="6" stroke-linejoin="round"/>` +
      `<circle cx="94" cy="28" r="23" fill="INK"/>` +
      BALL_DOTS(94, 28, 23, "MAT") +
      `<rect x="8" y="102" width="112" height="12" rx="6" fill="INK"/>`,
  },
  {
    tier: 2,
    slug: "driver",
    name: "Driver",
    material: "#d9903a",
    // A ball leaving speed lines, driven forward into a bronze arrowhead.
    body:
      `<g fill="INK"><rect x="4" y="46" width="16" height="9" rx="4.5" opacity="0.5"/>` +
      `<rect x="4" y="74" width="16" height="9" rx="4.5" opacity="0.5"/>` +
      `<rect x="2" y="60" width="26" height="9" rx="4.5"/></g>` +
      `<path d="M58 26 L120 64 L58 102 Z" fill="MAT" stroke="INK" stroke-width="6" stroke-linejoin="round"/>` +
      `<circle cx="48" cy="64" r="22" fill="INK"/>` +
      BALL_DOTS(48, 64, 22, "MAT"),
  },
  {
    tier: 3,
    slug: "volleyer",
    name: "Volleyer",
    material: "#f3700f",
    // The ball taken out of the air, above the net.
    body:
      `<g fill="INK"><rect x="10" y="54" width="12" height="62" rx="4"/><rect x="106" y="54" width="12" height="62" rx="4"/></g>` +
      `<rect x="18" y="62" width="92" height="40" fill="MAT"/>` +
      `<g fill="INK"><rect x="18" y="62" width="92" height="8"/><rect x="18" y="94" width="92" height="8"/>` +
      `<rect x="34" y="70" width="6" height="24"/><rect x="61" y="70" width="6" height="24"/><rect x="88" y="70" width="6" height="24"/></g>` +
      `<circle cx="64" cy="24" r="20" fill="INK"/>` +
      BALL_DOTS(64, 24, 20, "MAT"),
  },
  {
    tier: 4,
    slug: "smasher",
    name: "Smasher",
    material: "#f3700f",
    // The ball driven down, impact marks either side.
    body:
      `<circle cx="64" cy="30" r="22" fill="INK"/>` +
      BALL_DOTS(64, 30, 22, "MAT") +
      `<path d="M22 58 L106 58 L64 122 Z" fill="MAT" stroke="INK" stroke-width="6" stroke-linejoin="round"/>` +
      `<g fill="INK"><path d="M8 74 L26 82 L8 92 Z"/><path d="M120 74 L102 82 L120 92 Z"/></g>`,
  },
  {
    tier: 5,
    slug: "ace",
    name: "Ace",
    material: "#f3700f",
    // An eight-point burst — the unreturnable serve.
    body:
      `<path d="M124 64 L88.9 53.7 L105 23 L74.3 39.1 L64 4 L53.7 39.1 L23 23 L39.1 53.7 L4 64 L39.1 74.3 L23 105 L53.7 88.9 L64 124 L74.3 88.9 L105 105 L88.9 74.3 Z" fill="MAT" stroke="INK" stroke-width="5" stroke-linejoin="round"/>` +
      `<circle cx="64" cy="64" r="26" fill="INK"/>` +
      BALL_DOTS(64, 64, 26, "MAT"),
  },
  {
    tier: 6,
    slug: "kitchen-king",
    name: "Kitchen King",
    material: "#f3700f",
    // First regalia: a crown standing on the kitchen line.
    body:
      `<path d="M22 82 L106 82 L120 116 L8 116 Z" fill="MAT" stroke="INK" stroke-width="6" stroke-linejoin="round"/>` +
      `<rect x="26" y="94" width="76" height="6" fill="INK"/>` +
      `<path d="M26 74 L26 30 L47 50 L64 20 L81 50 L102 30 L102 74 Z" fill="INK"/>` +
      `<circle cx="64" cy="58" r="10" fill="MAT"/>`,
  },
  {
    tier: 7,
    slug: "champion",
    name: "Champion",
    material: "#f3700f",
    // Laurel struck around the ball, crowned with a single flame.
    body:
      `<g fill="INK">${LAUREL}</g>` +
      `<circle cx="64" cy="64" r="27" fill="MAT" stroke="INK" stroke-width="5"/>` +
      BALL_DOTS(64, 64, 26, "INK") +
      `<path d="M64 0 L70 12 L64 24 L58 12 Z" fill="MAT"/>`,
  },
];

function render(tier: Tier, ink: string): string {
  const body = tier.body.split("INK").join(ink).split("MAT").join(tier.material);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${tier.name} rank badge">` +
    `<title>${tier.name}</title>${body}</svg>\n`
  );
}

function main(): void {
  const outDir = join(process.cwd(), "public", "ranks");
  mkdirSync(outDir, { recursive: true });

  for (const tier of TIERS) {
    writeFileSync(join(outDir, `rank-${tier.slug}.svg`), render(tier, INK_ON_LIGHT));
    writeFileSync(join(outDir, `rank-${tier.slug}-navy.svg`), render(tier, INK_ON_NAVY));
  }

  console.log(`Wrote ${TIERS.length * 2} badges to public/ranks/`);
}

main();
