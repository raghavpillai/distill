import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "./cn";

/**
 * Observatory-themed Radix Select. Same visual language as the rest of the
 * app (brass-on-ink, hairline borders, mono labels, micro-animations on
 * open / item-hover).
 */
export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(function SelectTrigger({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      {...props}
      className={cn(
        "mono text-xs px-2.5 py-1 pr-7 inline-flex items-center justify-between gap-2",
        "bg-transparent border border-[color:var(--color-ink-rail)] rounded-[3px]",
        "text-[color:var(--color-ivory)]",
        "max-w-[280px] min-w-[140px]",
        "data-[state=open]:border-[color:var(--color-brass)]",
        "hover:border-[color:var(--color-brass-dim)]",
        "focus:outline-none focus:border-[color:var(--color-brass)]",
        "focus:shadow-[0_0_0_3px_rgba(212,168,90,0.07)]",
        "transition-[border-color,box-shadow] duration-150",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <span className="truncate">{children}</span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          aria-hidden
          className="h-3 w-3 text-[color:var(--color-brass)] opacity-90 data-[state=open]:rotate-180 transition-transform duration-150"
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = "popper", ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={6}
        {...props}
        // data-state-driven CSS animation: Radix toggles data-state="open"|"closed"
        // on mount/unmount, and the animation keyframes below ride that.
        className={cn(
          "z-50 overflow-hidden rounded-[3px]",
          "bg-[color:var(--color-ink-deep)]/95 backdrop-blur",
          "border border-[color:var(--color-brass-dim)]/60",
          "shadow-[0_10px_30px_rgba(0,0,0,0.45)]",
          "min-w-[var(--radix-select-trigger-width)]",
          "max-h-[min(60vh,420px)]",
          "data-[state=open]:animate-[selectIn_140ms_cubic-bezier(0.16,1,0.3,1)]",
          "data-[state=closed]:animate-[selectOut_120ms_ease-in_forwards]",
          "origin-[var(--radix-select-content-transform-origin)]",
          className,
        )}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      {...props}
      className={cn(
        "relative mono text-xs px-2.5 py-1.5 pl-7 pr-2 rounded-[2px]",
        "text-[color:var(--color-ivory-soft)] cursor-default select-none",
        "outline-none",
        "data-[highlighted]:bg-[color:var(--color-ink-rail)]/60",
        "data-[highlighted]:text-[color:var(--color-ivory)]",
        "data-[state=checked]:text-[color:var(--color-brass)]",
        "transition-colors",
        className,
      )}
    >
      <span className="absolute left-2 inline-flex items-center justify-center w-3 h-3 top-1/2 -translate-y-1/2">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-3 w-3 text-[color:var(--color-brass)]" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});

export const SelectLabel = forwardRef<
  ElementRef<typeof SelectPrimitive.Label>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      {...props}
      className={cn(
        "smallcaps text-[color:var(--color-dust)] px-3 py-1.5",
        className,
      )}
    />
  );
});

export const SelectSeparator = forwardRef<
  ElementRef<typeof SelectPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Separator
      ref={ref}
      {...props}
      className={cn("h-px my-1 bg-[color:var(--color-ink-rail)]", className)}
    />
  );
});
