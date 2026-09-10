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
 * Content is visible in the server render. Motion may enhance it after
 * hydration, but a blocked script, reduced-motion browser, screenshot runner,
 * or missing IntersectionObserver can never leave the product at opacity 0.
 *
 * `once` keeps content settled after the first pass - re-animating on every
 * scroll direction change is what makes this pattern feel cheap.
 */
export function Reveal({
  children,
  delay = 0,
  immediate = true,
  className,
}: {
  children: ReactNode;
  delay?: number;
  immediate?: boolean;
  className?: string;
}) {
  const transition = { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const };
  const shown = { opacity: 1, y: 0 };
  const entrance = { opacity: 1, y: 0 };

  if (immediate) {
    return (
      <motion.div className={className} initial={false} animate={entrance} transition={transition}>
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      className={className}
      initial={false}
      whileInView={shown}
      viewport={{ once: true, amount: 0.2 }}
      transition={transition}
    >
      {children}
    </motion.div>
  );
}
