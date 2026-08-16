"use client";

import { useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type BookingSection = {
  value: string;
  label: string;
  count: number;
  content: ReactNode;
};

/**
 * Client shell around server-rendered booking lists — the sections
 * themselves are built on the server (they need Supabase reads), and
 * only the active-tab state lives here. Same split ExploreLayout already
 * uses for its server-rendered `results`/`pagination` nodes.
 */
export function BookingSections({ sections }: { sections: BookingSection[] }) {
  const [active, setActive] = useState(sections[0]?.value ?? "");
  const activeSection = sections.find((s) => s.value === active) ?? sections[0];

  return (
    <div className="mt-8">
      <Tabs value={active} onValueChange={setActive}>
        <TabsList variant="line">
          {sections.map((section) => (
            <TabsTrigger key={section.value} value={section.value}>
              {section.label}
              {section.count > 0 && <span className="ml-1.5 text-xs text-muted-foreground">{section.count}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-6">{activeSection?.content}</div>
    </div>
  );
}
