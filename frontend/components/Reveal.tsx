"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * Scroll-triggered entrance used across the landing page.
 *
 * The rendered tree is identical on the server and the client - reduced motion
 * is handled once by <MotionConfig reducedMotion="user"> in MotionProvider.
 * Branching the markup on useReducedMotion() here instead would produce a
 * hydration mismatch and blank the section out entirely.
 *
 * `immediate` plays on mount and is the default. Scroll-triggered reveals look
 * nicer but fail closed the wrong way: if the IntersectionObserver never fires
 * - offscreen rendering, a prerender, an odd viewport - the content stays at
 * opacity 0 and the section is simply gone. Visibility beats the flourish, so
 * opt into `immediate={false}` only where the element is reliably scrolled to.
 *
 * `once` keeps content settled after the first pass - re-animating on every
 * scroll direction change is what makes this pattern feel cheap.
 */
export function Reveal({
  children,
  delay = 0,
  y = 18,
  immediate = true,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  immediate?: boolean;
  className?: string;
}) {
  const transition = { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const };
  const shown = { opacity: 1, y: 0 };
  const hidden = { opacity: 0, y };

  if (immediate) {
    return (
      <motion.div className={className} initial={hidden} animate={shown} transition={transition}>
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      className={className}
      initial={hidden}
      whileInView={shown}
      viewport={{ once: true, amount: 0.2 }}
      transition={transition}
    >
      {children}
    </motion.div>
  );
}
