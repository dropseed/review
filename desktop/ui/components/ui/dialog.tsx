import type * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";
import { XIcon } from "./icons";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

function DialogOverlay({
  className,
  children,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & {
  ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Overlay>>;
}) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Overlay>
  );
}

function DialogContent({
  className,
  overlayClassName,
  children,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Content>>;
  /** Positions the dialog — e.g. `items-start pt-[15vh]` to top-anchor it. */
  overlayClassName?: string;
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName}>
        <DialogPrimitive.Content
          ref={ref}
          aria-modal="true"
          className={cn(
            "overscroll-contain border border-edge-default/80 bg-surface-panel shadow-2xl shadow-black/50 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogOverlay>
    </DialogPortal>
  );
}

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex items-center justify-between border-b border-edge px-4 py-3",
      className,
    )}
    {...props}
  />
);

function DialogTitle({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title> & {
  ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Title>>;
}) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn("text-sm font-semibold text-fg", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description> & {
  ref?: React.Ref<React.ComponentRef<typeof DialogPrimitive.Description>>;
}) {
  return (
    <DialogPrimitive.Description
      ref={ref}
      className={cn("text-xs text-fg-muted", className)}
      {...props}
    />
  );
}

/**
 * The panel-shaped dialog four call sites had each written out by hand:
 * `MovePairModal`, `SimilarHunksModal`, `SimilarFilesModal` and
 * `FilenameModal`. Same 600px column, same `max-h-[80vh]`, same
 * stop-propagation on Escape (these open over a file view that has its own
 * Escape handling), same header row of title + close.
 *
 * `count` is the pill three of them show beside the title ("12 hunks");
 * omitting it just omits the pill.
 */
function PanelDialog({
  title,
  count,
  className,
  children,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof DialogContent>, "title"> & {
  title: React.ReactNode;
  count?: React.ReactNode;
}) {
  return (
    <DialogContent
      className={cn(
        "flex max-h-[80vh] w-[600px] max-w-[90vw] flex-col rounded-lg",
        className,
      )}
      onEscapeKeyDown={(e) => e.stopPropagation()}
      {...props}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <span>{title}</span>
          {count != null && (
            <span className="rounded-full bg-surface-hover/50 px-2 py-0.5 text-xs font-normal text-fg-muted tabular-nums">
              {count}
            </span>
          )}
        </DialogTitle>
        <DialogClose className="rounded p-1 text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg-secondary">
          <XIcon className="h-4 w-4" />
        </DialogClose>
      </DialogHeader>
      {children}
    </DialogContent>
  );
}

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  PanelDialog,
};
