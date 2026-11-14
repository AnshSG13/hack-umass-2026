// Class name join used by the shadcn/ui primitives and everything else.
// Plain join on purpose: no clsx or tailwind-merge, so no extra dependencies.
export type ClassValue = string | false | null | undefined;

export function cn(...parts: ClassValue[]): string {
  return parts.filter(Boolean).join(" ");
}
