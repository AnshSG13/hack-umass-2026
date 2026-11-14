"use client";

// shadcn/ui sheet, restyled to the DESIGN.md tokens: bottom sheet only, flat, no motion
// (DESIGN.md section 8: only three things animate, and a sheet isn't one of them).

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay data-slot="sheet-overlay" className="fixed inset-0 z-50 bg-ink/40" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "sheet-frame fixed bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-[16px] border border-b-0 border-line bg-ticket px-4 pt-5 pb-[calc(16px+env(safe-area-inset-bottom))] outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-[20px] leading-[1.3] font-semibold text-ink", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("mt-2 text-[16px] text-ink", className)}
      {...props}
    />
  );
}

export { Sheet, SheetClose, SheetContent, SheetTitle, SheetDescription };
