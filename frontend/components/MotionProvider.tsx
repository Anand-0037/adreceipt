"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * `reducedMotion="user"` makes Motion honour the OS setting for every animation
 * below it, so individual components never branch their markup on the
 * preference. That branching is what caused a server/client hydration mismatch:
 * the server has no preference and rendered the animated tree, the client read
 * "reduce" and rendered a plain one, and React discarded the subtree.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
