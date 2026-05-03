import { cva } from "class-variance-authority";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
  {
    variants: {
      variant: {
        default: "border-transparent bg-bg-panel2 text-fg",
        accent: "border-transparent bg-accent-subtle text-accent",
        success: "border-transparent bg-success/15 text-success",
        warn: "border-transparent bg-warn/15 text-warn",
        danger: "border-transparent bg-danger/15 text-danger",
        info: "border-transparent bg-info/15 text-info",
        outline: "border-border bg-transparent text-fg-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
