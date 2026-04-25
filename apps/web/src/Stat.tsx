import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "motion/react";

type Props = { label: string; value: number | string };

// Count-up from 0 when the stat enters view. String values render as-is.
export function Stat({ label, value }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const [display, setDisplay] = useState<string>(typeof value === "number" ? "0" : value);

  useEffect(() => {
    if (typeof value !== "number") {
      setDisplay(value);
      return;
    }
    if (!inView) return;
    const start = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const e = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - e, 3);
      setDisplay(Math.round(value * eased).toLocaleString());
      if (e < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value]);

  return (
    <div ref={ref} className="relative px-4 py-2 min-w-[82px]">
      <div className="smallcaps text-[color:var(--color-dust)]">{label}</div>
      <motion.div
        className="display tnum text-[22px] leading-none mt-1 text-[color:var(--color-ivory)]"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15 }}
      >
        {display}
      </motion.div>
    </div>
  );
}
