import { tv } from "tailwind-variants";

export const alert = tv({
  base: "text-foreground relative w-full rounded-lg border p-4",
  variants: {
    variant: {
      default: "bg-field-surface [&>h5>svg]:text-foreground",
      primary: "border-primary bg-primary/7 [&>h5>svg]:text-primary-text",
      secondary: "border-secondary bg-secondary/7 [&>h5>svg]:text-secondary",
      info: "border-info bg-info/7 [&>h5>svg]:text-info-text",
      success: "border-success bg-success/7 [&>h5>svg]:text-success-text",
      warning: "border-warning bg-warning/7 [&>h5>svg]:text-warning-text",
      error: "border-error bg-error/7 [&>h5>svg]:text-error-text",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export const alertDescription = tv({
  base: "leading-relaxed",
});

export const alertTitle = tv({
  base: "font-heading mb-2 flex items-center gap-2 text-lg leading-none font-medium tracking-tight",
});
