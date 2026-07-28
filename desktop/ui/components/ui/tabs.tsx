import { Children, type ReactNode } from "react";
import type * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "../../lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  ref?: React.Ref<React.ComponentRef<typeof TabsPrimitive.List>>;
}) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn("flex rounded-md bg-surface-raised p-0.5", className)}
      {...props}
    />
  );
}

/**
 * Give each plain-text label a box of its own so it can ellipsize.
 *
 * `text-overflow` needs a block container, and the trigger is a flex row (the
 * label sits beside its count badge) — putting `truncate` on the trigger
 * itself only ever gets the `overflow: hidden` half, which with centred
 * content clips a long label at *both* ends. A bare string is an anonymous
 * flex item and can't be styled, so it's wrapped here rather than at every
 * call site.
 */
function truncatableLabels(children: ReactNode): ReactNode {
  return Children.map(children, (child) =>
    typeof child === "string" ? (
      <span className="truncate">{child}</span>
    ) : (
      child
    ),
  );
}

function TabsTrigger({
  className,
  children,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
  ref?: React.Ref<React.ComponentRef<typeof TabsPrimitive.Trigger>>;
}) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        // min-w-0 so a long label truncates instead of forcing the row wider
        // than the panel; the count badge stays shrink-0 beside it.
        "flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden rounded px-2 py-1 text-xxs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring/50 data-[state=active]:bg-surface-hover data-[state=active]:text-fg data-[state=inactive]:text-fg-muted data-[state=inactive]:hover:text-fg-secondary",
        className,
      )}
      {...props}
    >
      {truncatableLabels(children)}
    </TabsPrimitive.Trigger>
  );
}

function TabsContent({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> & {
  ref?: React.Ref<React.ComponentRef<typeof TabsPrimitive.Content>>;
}) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      className={cn("focus-visible:outline-hidden", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
