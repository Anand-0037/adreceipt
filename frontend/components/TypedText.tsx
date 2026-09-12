"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";

/**
 * Reveal text the way an assistant appears to write it.
 *
 * The answer arrives from the API in one piece, so this is presentation, not
 * streaming - but it is the presentation people recognise, and it makes the
 * point of the page visible: the answer is finished *before* any advertising
 * logic is allowed to act on it.
 *
 * Whole words are revealed, not characters, so the text never flickers through
 * half-formed tokens. Anyone who has asked for reduced motion gets the text at
 * once, as does a restored session - re-typing an answer someone already read
 * would be theatre.
 */
export function TypedText({
  text,
  animate,
  onDone,
}: {
  text: string;
  animate: boolean;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState(animate ? "" : text);
  const [done, setDone] = useState(!animate);
  const finish = useRef(onDone);
  finish.current = onDone;

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!animate || reduceMotion) {
      setShown(text);
      setDone(true);
      finish.current?.();
      return;
    }

    // Split on whitespace but keep it, so joining the prefix back is lossless.
    const tokens = text.split(/(\s+)/).filter(Boolean);
    let revealed = 0;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      if (cancelled) return;
      revealed += 1;
      setShown(tokens.slice(0, revealed).join(""));
      if (revealed < tokens.length) {
        // A little jitter reads as writing rather than a metronome.
        timer = setTimeout(tick, 14 + Math.random() * 26);
      } else {
        setDone(true);
        finish.current?.();
      }
    };

    setShown("");
    setDone(false);
    timer = setTimeout(tick, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, animate]);

  return (
    <div className="typed-text">
      <Markdown text={shown} />
      {!done && <span className="typed-caret" aria-hidden="true" />}
    </div>
  );
}

/** Three pulsing dots, shown while the model is working. */
export function ThinkingDots({ label = "Thinking" }: { label?: string }) {
  return (
    <span className="thinking-dots" role="status" aria-label={label}>
      <span />
      <span />
      <span />
    </span>
  );
}
