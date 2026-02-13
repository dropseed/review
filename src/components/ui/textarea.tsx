import type * as React from "react";

import { cn } from "../../lib/utils";

function Textarea({
  className,
  ref,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: React.Ref<HTMLTextAreaElement>;
}) {
  return (
    <textarea
      className={cn(
        "flex min-h-[60px] w-full rounded-lg border border-stone-700 bg-stone-800/50 px-3 py-2 text-sm text-stone-200 placeholder:text-stone-500 focus:border-violet-500/50 focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
}

export { Textarea };
