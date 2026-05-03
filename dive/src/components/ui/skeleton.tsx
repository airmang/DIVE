import { cn } from "../../lib/utils";

interface Props {
  className?: string;
  width?: string | number;
  height?: string | number;
  circle?: boolean;
}

export function Skeleton({ className, width, height, circle = false }: Props) {
  return (
    <div
      className={cn(
        "animate-pulse bg-bg-panel2 motion-reduce:animate-none",
        circle ? "rounded-full" : "rounded-md",
        className,
      )}
      style={{
        width: width ?? "100%",
        height: height ?? "1rem",
      }}
      data-testid="skeleton"
      aria-hidden="true"
    />
  );
}

export default Skeleton;
