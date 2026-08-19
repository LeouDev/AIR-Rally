import type { ReactNode } from "react";
import { RankedShell } from "@/components/ranked/RankedShell";

export default function RankedLayout({ children }: { children: ReactNode }) {
  return <RankedShell homeHref="/profile/rank">{children}</RankedShell>;
}
