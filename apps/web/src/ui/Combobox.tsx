import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { Check, ChevronDown } from "lucide-react";
import { forwardRef, type ReactNode, useState } from "react";
import { cn } from "./cn";

/**
 * Observatory-themed searchable combobox built on Radix Popover + cmdk.
 * Used for the repo filter where the flat list is 100+ items long and a
 * plain Select isn't ergonomic.
 *
 * Items can opt into a `group` field; entries with the same group are
 * collected under a smallcaps header in the dropdown.
 */
export type ComboboxItem = {
  value: string;
  label: string;
  /** Optional group header (rendered as a smallcaps separator above the items). */
  group?: string;
};

type Props = {
  items: ComboboxItem[];
  value: string;
  onValueChange: (v: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  /** Optional render for the trigger label (defaults to the matching item's label). */
  renderValue?: (it: ComboboxItem | undefined) => ReactNode;
};

export const Combobox = forwardRef<HTMLButtonElement, Props>(function Combobox(
  {
    items,
    value,
    onValueChange,
    placeholder = "Select…",
    searchPlaceholder = "Search…",
    emptyText = "No matches.",
    className,
    renderValue,
  },
  ref,
) {
  const [open, setOpen] = useState(false);
  const current = items.find((it) => it.value === value);

  // Group items but preserve relative order. Items with no group fall under "".
  const groups: Map<string, ComboboxItem[]> = new Map();
  for (const it of items) {
    const g = it.group ?? "";
    const arr = groups.get(g) ?? [];
    arr.push(it);
    groups.set(g, arr);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          ref={ref}
          aria-expanded={open}
          className={cn(
            "mono text-xs px-2.5 py-1 pr-7 inline-flex items-center justify-between gap-2",
            "bg-transparent border border-[color:var(--color-ink-rail)] rounded-[3px]",
            "text-[color:var(--color-ivory)]",
            "max-w-[280px] min-w-[140px] relative",
            "data-[state=open]:border-[color:var(--color-brass)]",
            "hover:border-[color:var(--color-brass-dim)]",
            "focus:outline-none focus:border-[color:var(--color-brass)]",
            "focus:shadow-[0_0_0_3px_rgba(212,168,90,0.07)]",
            "transition-[border-color,box-shadow] duration-150",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <span className="truncate">
            {renderValue ? renderValue(current) : (current?.label ?? placeholder)}
          </span>
          <ChevronDown
            aria-hidden
            className={cn(
              "h-3 w-3 absolute right-2 top-1/2 -translate-y-1/2",
              "text-[color:var(--color-brass)] opacity-90",
              "transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={cn(
            "z-50 w-[var(--radix-popover-trigger-width)] min-w-[260px]",
            "overflow-hidden rounded-[3px]",
            "bg-[color:var(--color-ink-deep)]/95 backdrop-blur",
            "border border-[color:var(--color-brass-dim)]/60",
            "shadow-[0_10px_30px_rgba(0,0,0,0.45)]",
            "data-[state=open]:animate-[selectIn_140ms_cubic-bezier(0.16,1,0.3,1)]",
            "data-[state=closed]:animate-[selectOut_120ms_ease-in_forwards]",
            "origin-[var(--radix-popover-content-transform-origin)]",
          )}
        >
          <Command
            className="flex flex-col"
            filter={(itemValue, search) => {
              // Match on lowercased substring so the trigger label and the
              // value stay independently searchable.
              const v = itemValue.toLowerCase();
              const s = search.toLowerCase().trim();
              if (!s) return 1;
              return v.includes(s) ? 1 : 0;
            }}
          >
            <Command.Input
              placeholder={searchPlaceholder}
              className={cn(
                "mono text-xs px-3 py-2 bg-transparent",
                "border-b border-[color:var(--color-ink-rail)]",
                "text-[color:var(--color-ivory)]",
                "placeholder:text-[color:var(--color-dust)]/60",
                "focus:outline-none",
              )}
            />
            <Command.List className="max-h-[300px] overflow-auto p-1">
              <Command.Empty className="mono text-[11px] text-[color:var(--color-dust)] italic px-3 py-2">
                {emptyText}
              </Command.Empty>
              {[...groups.entries()].map(([groupName, groupItems]) => (
                <Command.Group
                  key={groupName || "_"}
                  heading={
                    groupName ? (
                      <span className="smallcaps text-[10px] text-[color:var(--color-dust)] px-2 py-1 block">
                        {groupName}
                      </span>
                    ) : undefined
                  }
                >
                  {groupItems.map((it) => {
                    const selected = it.value === value;
                    return (
                      <Command.Item
                        key={it.value}
                        value={it.label}
                        onSelect={() => {
                          onValueChange(it.value);
                          setOpen(false);
                        }}
                        className={cn(
                          "relative mono text-xs px-2.5 py-1.5 pl-7 pr-2 rounded-[2px]",
                          "text-[color:var(--color-ivory-soft)]",
                          "cursor-pointer outline-none",
                          "data-[selected=true]:bg-[color:var(--color-ink-rail)]/60",
                          "data-[selected=true]:text-[color:var(--color-ivory)]",
                          "transition-colors",
                          selected && "text-[color:var(--color-brass)]",
                        )}
                      >
                        {selected && (
                          <Check className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-[color:var(--color-brass)]" />
                        )}
                        {it.label}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
});
