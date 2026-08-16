"use client";

import { useState } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isBefore,
  isAfter,
  startOfDay,
  format,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

type DatePickerCalendarProps = {
  selected: Date;
  onSelect: (date: Date) => void;
  minDate: Date;
  maxDate: Date;
};

/**
 * A plain month-grid built on date-fns (already a dependency) rather than
 * pulling in react-day-picker for one calendar — mirrors this codebase's
 * existing preference for small hand-built date UI (see the day-pill
 * strip this sits alongside in BookingWidget.tsx). Dates outside
 * [minDate, maxDate] render but are disabled, so the month grid stays
 * legible instead of jumping structure when a month is partly bookable.
 */
export function DatePickerCalendar({ selected, onSelect, minDate, maxDate }: DatePickerCalendarProps) {
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(selected));

  const gridStart = startOfWeek(startOfMonth(visibleMonth));
  const gridEnd = endOfWeek(endOfMonth(visibleMonth));
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const minDay = startOfDay(minDate);
  const maxDay = startOfDay(maxDate);
  const canGoBack = isAfter(startOfMonth(visibleMonth), startOfMonth(minDay));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          aria-label="Previous month"
          disabled={!canGoBack}
          onClick={() => setVisibleMonth((m) => subMonths(m, 1))}
          className="flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
        </button>
        <p className="text-sm font-medium text-foreground">{format(visibleMonth, "MMMM yyyy")}</p>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setVisibleMonth((m) => addMonths(m, 1))}
          className="flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent"
        >
          <ChevronRight className="size-4" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 px-1 text-center text-xs text-muted-foreground">
        {WEEKDAY_LABELS.map((label, i) => (
          <span key={i}>{label}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 px-1">
        {days.map((day) => {
          const disabled = isBefore(day, minDay) || isAfter(day, maxDay);
          const outsideMonth = !isSameMonth(day, visibleMonth);
          const active = isSameDay(day, selected);
          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onSelect(day)}
              className={cn(
                "flex size-8 items-center justify-center rounded-md text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                outsideMonth && "text-muted-foreground/40",
                !outsideMonth && !disabled && !active && "text-foreground hover:bg-accent",
                disabled && "cursor-not-allowed text-muted-foreground/25",
                active && "bg-primary text-primary-foreground hover:bg-primary"
              )}
            >
              {format(day, "d")}
            </button>
          );
        })}
      </div>
    </div>
  );
}
