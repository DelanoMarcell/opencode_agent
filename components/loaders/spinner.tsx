import { cn } from "@/lib/utils";

type SpinnerProps = React.ComponentProps<"span"> & {
  size?: "sm" | "md" | "lg";
};

const sizeClasses = {
  sm: "size-3.5 border-[1.5px]",
  md: "size-4 border-2",
  lg: "size-5 border-2",
} as const;

function Spinner({ className, size = "md", ...props }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-current border-r-transparent align-middle",
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
}

export { Spinner };
