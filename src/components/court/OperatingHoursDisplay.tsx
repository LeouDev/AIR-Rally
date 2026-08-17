import { cn } from "@/lib/utils";
import type { VenueOperatingHours } from "@/lib/supabase/types";

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatHour(time: string): string {
  const [hourStr, minute] = time.split(":");
  const hour = Number(hourStr);
  const period = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return minute === "00" ? `${hour12} ${period}` : `${hour12}:${minute} ${period}`;
}

export function OperatingHoursDisplay({
  operatingHours,
  todayDayOfWeek,
}: {
  operatingHours: VenueOperatingHours[];
  todayDayOfWeek: number;
}) {
  return (
    <div className="rounded-lg bg-card px-3.5 py-1">
      {DAY_LABELS.map((label, dayOfWeek) => {
        const hours = operatingHours.find((h) => h.day_of_week === dayOfWeek);
        const isToday = dayOfWeek === todayDayOfWeek;
        return (
          <div
            key={dayOfWeek}
            className={cn(
              "flex items-center justify-between gap-3 border-b border-hairline py-2.5 text-[0.9375rem]/5 last:border-b-0",
              isToday ? "font-semibold text-primary" : "font-medium text-foreground"
            )}
          >
            {/* Today is marked in the row itself, not by a highlight bar —
                the reader is scanning for one line, and a fill just moves the
                emphasis onto the background. */}
            <span>{isToday ? `${label} · today` : label}</span>
            <span className={cn("font-mono", !isToday && "font-normal", !hours && "text-muted-foreground")}>
              {hours ? `${formatHour(hours.start_time)} – ${formatHour(hours.end_time)}` : "Closed"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
