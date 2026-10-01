/**
 * @jest-environment node
 */
import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";

/**
 * White on Rally Orange is 2.94:1, under WCAG AA for any text size, and it
 * was every primary button on the site. Labels on orange are navy now
 * (5.09:1), matching the app. These compute the real ratios from
 * globals.css, and catch the other way it came back: a component writing
 * text-white straight onto bg-rally, which no token can reach.
 */

const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

function tokens(selector: string): Record<string, string> {
  const body = css.match(new RegExp(`^${selector} \\{([\\s\\S]*?)^\\}`, "m"))?.[1] ?? "";
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each([":root", "\\.dark"])("%s", (selector) => {
  const t = tokens(selector);
  it.each([
    ["primary-foreground", "primary"],
    ["rally-foreground", "rally"],
    ["sidebar-primary-foreground", "sidebar-primary"],
  ])("%s on %s clears WCAG AA", (fg, bg) => {
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

it("never puts light text straight onto an orange fill", () => {
  const light = "text-white|text-navy-foreground|text-background";
  const fill = "bg-rally|bg-primary";
  const pattern = new RegExp(
    `\\b(${fill})\\b(?![-/])[^"'\`]*\\b(${light})\\b|\\b(${light})\\b[^"'\`]*\\b(${fill})\\b(?![-/])`,
  );
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== "__tests__") walk(full);
      } else if (name.endsWith(".tsx")) {
        readFileSync(full, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (pattern.test(line)) offenders.push(`${path.relative(process.cwd(), full)}:${i + 1}`);
          });
      }
    }
  };
  walk(path.join(process.cwd(), "src"));
  expect(offenders).toEqual([]);
});
