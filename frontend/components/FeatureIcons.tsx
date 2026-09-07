/**
 * Outline icons for the feature strip, matching the reference's line weight.
 * Inline SVG so there is no icon dependency and they inherit currentColor.
 */
export function SignIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false">
      <path d="M5 27h22" />
      <path d="M21.5 5.5a3 3 0 0 1 4.2 4.2L12 23.4 6 25l1.6-6Z" />
    </svg>
  );
}

export function SettleIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false">
      <circle cx="16" cy="16" r="12" />
      <path d="M20 11h-6a2.6 2.6 0 0 0 0 5.2h4a2.6 2.6 0 0 1 0 5.2h-6" />
      <path d="M16 8.5v15" />
    </svg>
  );
}

export function VerifyIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden focusable="false">
      <circle cx="14" cy="14" r="9.5" />
      <path d="M21 21l6 6" />
      <path d="M10.5 14l2.8 2.8L18 11.6" />
    </svg>
  );
}
