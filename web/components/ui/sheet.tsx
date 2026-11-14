"use client";

// Bottom sheet: the radix dialog (focus trap, Escape, scrim tap) in the mockup's sheet
// styling: rounded top, grab handle, slides up. The motion is in mock.css and is cut to
// nothing under prefers-reduced-motion.

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { Icon } from "@/components/icons";
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
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  // The sheets here are opened from code, not from a radix trigger, so radix has nothing
  // to hand focus back to. Remember what had focus and return it on close.
  const opener = React.useRef<HTMLElement | null>(null);
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay data-slot="sheet-overlay" className="scrim" />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn("sheet gutter", className)}
        onOpenAutoFocus={(e) => {
          opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          onOpenAutoFocus?.(e);
        }}
        onCloseAutoFocus={(e) => {
          onCloseAutoFocus?.(e);
          if (e.defaultPrevented) return;
          e.preventDefault();
          if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
        }}
        {...props}
      >
        <div className="grab" aria-hidden="true" />
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" className={cn("sheet-title", className)} {...props} />;
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description data-slot="sheet-description" className={cn("sheet-text", className)} {...props} />
  );
}

/** The mockup's sheet head: the title on the left, a round close button on the right. */
function SheetHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="sheet-head">
      <SheetTitle>{children}</SheetTitle>
      <SheetPrimitive.Close className="close" aria-label="Close">
        <Icon name="x" />
      </SheetPrimitive.Close>
    </div>
  );
}

export { Sheet, SheetClose, SheetContent, SheetTitle, SheetDescription, SheetHead };
