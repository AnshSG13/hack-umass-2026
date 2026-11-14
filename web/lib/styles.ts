// Shared control styles for the screens that keep their Tailwind markup (landing, setup,
// samples, save, settings, the public plan page). Same shapes as the mockup's .btn: pills,
// ink for the primary action, a hairline for the rest. At least 44 px tall.

export const btnPrimary =
  "flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full border border-ink bg-ink px-5 text-center text-[15.5px] font-semibold text-white disabled:opacity-60";

export const btnOutline =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border border-line bg-paper px-5 text-center text-[14.5px] font-semibold text-ink disabled:opacity-60";

export const btnText =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-center text-[14.5px] font-semibold text-ink disabled:opacity-60";

export const btnIcon = "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink";

export const linkInk = "text-ink font-semibold underline underline-offset-4";

export const inputBase =
  "min-h-[52px] rounded-[18px] border border-line bg-ticket px-4 text-[16px] text-ink placeholder:text-muted";

export const pageTitle = "wide text-[32px] leading-[1.12] text-ink";
export const sectionTitle = "wide text-[24px] leading-[1.15] text-ink";
export const meta = "text-[13px] text-muted";

export const btnDanger =
  "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full border border-danger-ink bg-danger-ink px-5 text-center text-[14.5px] font-semibold text-white disabled:opacity-60";

export const btnTextDanger =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-3 text-center text-[14.5px] font-semibold text-danger-ink disabled:opacity-60";
