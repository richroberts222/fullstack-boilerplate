import { cn } from "@/lib/utils";

/**
 * The App Boilerplate wordmark, drawn as text until a logo exists. The one place the brand name is drawn as a
 * mark (docs/ui.md); replace the body with an image when the owner supplies one. `large` is for the home page,
 * `compact` for the rest.
 */
export function BrandWordmark({ size = "compact", className }: { size?: "large" | "compact"; className?: string }) {
  return (
    <span
      className={cn(
        "font-heading font-extrabold tracking-tight text-gradient-brand",
        size === "large" ? "text-3xl sm:text-4xl" : "text-xl sm:text-2xl",
        className,
      )}
    >
      App Boilerplate
    </span>
  );
}
