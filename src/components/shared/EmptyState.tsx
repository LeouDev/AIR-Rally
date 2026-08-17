import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/50 px-6 py-10 text-center",
        className
      )}
    >
      <div className="mb-2 flex size-14 items-center justify-center rounded-full bg-card text-primary shadow-card">
        <Icon className="size-6" aria-hidden="true" />
      </div>
      <h3 className="text-[1.0625rem]/[1.375rem] font-semibold text-foreground">{title}</h3>
      <p className="mt-2 max-w-xs text-sm/5 text-subtle">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
