import type * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";

import { cn } from "../../lib/utils";

function Checkbox({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
  ref?: React.Ref<React.ComponentRef<typeof CheckboxPrimitive.Root>>;
}) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "peer h-4 w-4 shrink-0 rounded border transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-cyan-500 data-[state=checked]:bg-cyan-500 data-[state=unchecked]:border-stone-600 data-[state=unchecked]:bg-stone-800",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <svg
          className="h-2.5 w-2.5 text-stone-900"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
