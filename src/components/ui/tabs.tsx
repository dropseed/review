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
      className={cn("flex rounded-md bg-stone-800 p-0.5", className)}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
  ref?: React.Ref<React.ComponentRef<typeof TabsPrimitive.Trigger>>;
}) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "flex-1 rounded px-2 py-1 text-xxs font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50 data-[state=active]:bg-stone-700 data-[state=active]:text-stone-100 data-[state=inactive]:text-stone-500 data-[state=inactive]:hover:text-stone-300",
        className,
      )}
      {...props}
    />
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
