import { forwardRef, type InputHTMLAttributes } from "react";
import { motion } from "motion/react";
import { cn } from "./cn";

/**
 * Observatory-themed input. Wraps the native <input> with consistent border,
 * focus, and motion behavior so every input across the app reads the same.
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <motion.div
        whileFocus={{}} /* placeholder so framer can animate the wrapper */
        className="relative w-full"
      >
        <input
          ref={ref}
          {...props}
          className={cn(
            "w-full mono text-xs px-3 py-2 bg-transparent",
            "border border-[color:var(--color-ink-rail)] rounded-[3px]",
            "text-[color:var(--color-ivory)]",
            "placeholder:text-[color:var(--color-dust)]/60",
            "focus:border-[color:var(--color-brass)] focus:outline-none",
            "focus:shadow-[0_0_0_3px_rgba(212,168,90,0.07)]",
            "transition-[border-color,box-shadow] duration-150",
            "disabled:opacity-50 disabled:cursor-not-allowed",
            className,
          )}
        />
      </motion.div>
    );
  },
);
