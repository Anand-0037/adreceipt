/**
 * Decorative panel beside the sign-in form.
 *
 * The reference pairs the form with a grid of illustrated avatars: a tinted
 * disc, a solid-colour bust, a pale face and a hat. Rebuilt here as inline SVG
 * so there are no raster assets and no network request, and recoloured onto the
 * site's green palette rather than the reference's six unrelated hues.
 */

type Hat = "beanie" | "cowboy" | "sun" | "cap" | "pointed" | "bob";

const AVATARS: { disc: string; figure: string; hat: Hat }[] = [
  { disc: "#e4f7c9", figure: "#5f9e1f", hat: "beanie" },
  { disc: "#d3f6e6", figure: "#12876a", hat: "cowboy" },
  { disc: "#f6edcd", figure: "#a97f18", hat: "sun" },
  { disc: "#d7e9f8", figure: "#2b6ca3", hat: "cap" },
  { disc: "#f6dde8", figure: "#b23a68", hat: "pointed" },
  { disc: "#e2e2f6", figure: "#5b52a8", hat: "bob" },
];

/** Hat shapes, drawn over the head and sharing the figure colour. */
function HatShape({ hat, fill }: { hat: Hat; fill: string }) {
  switch (hat) {
    case "beanie":
      return (
        <>
          <path d="M24 24C25 12 47 12 48 24Z" fill={fill} />
          <rect x="21" y="22" width="30" height="6.5" rx="3.25" fill={fill} />
          <circle cx="36" cy="11" r="3.6" fill={fill} />
        </>
      );
    case "cowboy":
      return (
        <>
          <path d="M26 27C27 13 45 13 46 27Z" fill={fill} />
          <ellipse cx="36" cy="26.5" rx="25" ry="4.6" fill={fill} />
        </>
      );
    case "sun":
      return (
        <>
          <path d="M27 27C28 14 44 14 45 27Z" fill={fill} />
          <ellipse cx="36" cy="27" rx="27" ry="5.2" fill={fill} />
        </>
      );
    case "cap":
      return (
        <>
          <path d="M25 25C26 12 46 12 47 25Z" fill={fill} />
          <path d="M45 20h12a4.5 4.5 0 0 1 0 9H45Z" fill={fill} />
        </>
      );
    case "pointed":
      return (
        <>
          <path d="M36 5 51 27H21Z" fill={fill} />
          <circle cx="36" cy="6" r="3.4" fill={fill} />
        </>
      );
    default:
      // A bob: hair framing the face down both sides, cut back around it.
      return <path d="M17 44C17 10 55 10 55 44L47 44C47 25 43 18 36 18S25 25 25 44Z" fill={fill} />;
  }
}

function Avatar({ disc, figure, hat }: (typeof AVATARS)[number]) {
  return (
    <figure style={{ background: disc }}>
      <svg viewBox="0 0 72 72" aria-hidden>
        {/* Bust */}
        <path d="M13 72c0-17 9-23 23-23s23 6 23 23Z" fill={figure} />
        {/* Face, left blank like the reference illustrations */}
        <circle cx="36" cy="31" r="13.5" fill="#fdfdfb" />
        <HatShape hat={hat} fill={figure} />
      </svg>
    </figure>
  );
}

export function AuthAside({ registering }: { registering: boolean }) {
  return (
    <aside className="auth-aside">
      <span className="auth-aside-mark">
        <span aria-hidden>AR</span>
        AdReceipt
      </span>

      <div>
        <h2>
          {registering
            ? "One wallet, and everything you sign is checkable."
            : "Welcome back. Your wallet is your account."}
        </h2>
        <p>
          {registering
            ? "Publishers sign what they recommend. Advertisers pay for exactly that. Everyone else gets to re-check it."
            : "Connect to pick up where you left off, or browse the receipts without connecting at all."}
        </p>
      </div>

      <div className="auth-avatars" aria-hidden>
        {AVATARS.map((a) => (
          <Avatar key={a.hat} {...a} />
        ))}
      </div>

      <p className="auth-note">
        No email, no password, no session on our servers. Every action that matters is authorised by
        a signature and recorded on Sepolia.
      </p>
    </aside>
  );
}
