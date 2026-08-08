"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { DayAvailability } from "@/types/court";

type AvailabilitySelectorProps = {
  availability: DayAvailability[];
  onSelectSlot?: (date: string, slotId: string) => void;
};

export function AvailabilitySelector({ availability, onSelectSlot }: AvailabilitySelectorProps) {
  const [activeDate, setActiveDate] = useState(availability[0]?.date);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const activeDay = availability.find((d) => d.date === activeDate) ?? availability[0];

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={activeDate}
        onValueChange={(value) => {
          setActiveDate(value);
          setSelectedSlotId(null);
        }}
      >
        <TabsList className="w-full justify-start overflow-x-auto">
          {availability.map((day) => (
            <TabsTrigger key={day.date} value={day.date}>
              {day.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {activeDay?.slots.map((slot) => {
          const isSelected = slot.id === selectedSlotId;
          return (
            <button
              key={slot.id}
              type="button"
              disabled={!slot.available}
              aria-pressed={isSelected}
              onClick={() => {
                setSelectedSlotId(slot.id);
                onSelectSlot?.(activeDay.date, slot.id);
              }}
              className={cn(
                "rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                !slot.available &&
                  "cursor-not-allowed border-border bg-muted text-muted-foreground/60 line-through",
                slot.available &&
                  !isSelected &&
                  "border-border bg-background text-foreground hover:border-primary hover:bg-accent",
                isSelected && "border-primary bg-primary text-primary-foreground"
              )}
            >
              {slot.time}
            </button>
          );
        })}
      </div>
    </div>
  );
}
