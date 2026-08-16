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
    <div className="flex flex-col gap-1 text-sm">
      {DAY_LABELS.map((label, dayOfWeek) => {
        const hours = operatingHours.find((h) => h.day_of_week === dayOfWeek);
        const isToday = dayOfWeek === todayDayOfWeek;
        return (
          <div key={dayOfWeek} className={cn("flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5", isToday && "bg-accent")}>
            <span className={cn("text-muted-foreground", isToday && "font-medium text-foreground")}>{label}</span>
            <span className={cn(hours ? "text-foreground" : "text-muted-foreground", isToday && "font-medium")}>
              {hours ? `${formatHour(hours.start_time)} – ${formatHour(hours.end_time)}` : "Closed"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
