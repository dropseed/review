import type * as React from "react";

import { cn } from "../../lib/utils";

function Input({
  className,
  type,
  ref,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  ref?: React.Ref<HTMLInputElement>;
}) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-lg border border-edge-default bg-surface-raised/50 px-3 py-2 text-sm text-fg-secondary placeholder:text-fg-muted focus:border-guide/50 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

export { Input };
