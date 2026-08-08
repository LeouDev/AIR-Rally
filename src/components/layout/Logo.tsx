import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

type LogoProps = {
  className?: string;
  iconOnly?: boolean;
};

export function Logo({ className, iconOnly = false }: LogoProps) {
  return (
    <Link
      href="/"
      className={cn(
        "flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 rounded-md",
        className
      )}
    >
      <Image
        src="/brand/mark-transparent.png"
        alt=""
        width={32}
        height={32}
        className="size-7"
        priority
      />
      {iconOnly ? (
        <span className="sr-only">Air/Rally home</span>
      ) : (
        <span className="flex items-baseline">
          <span className="text-secondary dark:text-foreground">AIR</span>
          <span className="text-primary">/Rally</span>
        </span>
      )}
    </Link>
  );
}
