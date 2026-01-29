import { type VariantProps, cva } from "class-variance-authority";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-1.5 py-0.5 text-xxs font-medium",
  {
    variants: {
      variant: {
        default: "bg-stone-700/50 text-stone-300",
        amber: "bg-amber-500/15 text-amber-400",
        lime: "bg-lime-500/15 text-lime-400",
        cyan: "bg-cyan-500/15 text-cyan-400",
        emerald: "bg-emerald-500/15 text-emerald-400",
        violet: "bg-violet-500/15 text-violet-400",
        rose: "bg-rose-500/15 text-rose-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
