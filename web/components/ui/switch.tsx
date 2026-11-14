"use client";

// shadcn/ui switch, restyled to the DESIGN.md tokens. The track is 28 px high inside a
// 44 px tall hit area; state is shown by thumb position plus ink fill, never color alone.

import * as React from "react";
import { Switch as SwitchPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "group relative inline-flex h-11 w-[52px] shrink-0 cursor-pointer items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="block h-7 w-[52px] rounded-full border-2 border-ink bg-ticket group-data-[state=checked]:bg-ink"
      />
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none absolute left-[6px] block size-4 rounded-full bg-ink data-[state=checked]:left-[30px] data-[state=checked]:bg-ticket"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
