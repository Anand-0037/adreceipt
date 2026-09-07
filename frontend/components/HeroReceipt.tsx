/**
 * Hero artwork: the panel inside the product card, mirroring the reference's
 * image area.
 *
 * Drawn inline rather than shipped as a file. It depicts what AdReceipt
 * actually produces: an assistant answer whose commercial line is highlighted,
 * the payment that bought that exact line, and the two independent sources
 * that have to agree before a badge appears.
 */
export function ReceiptArtwork() {
  return (
    <svg
      className="nb-receipt-art"
      viewBox="0 0 320 300"
      role="img"
      aria-label="An assistant answer with the paid line highlighted, a USDC payment flowing into it, and two verification checks"
    >
      <title>A paid recommendation, its payment, and the checks that confirm both</title>
      <defs>
        {/* Layered ground: a soft mesh rather than a flat fill. */}
        <linearGradient id="ar-ground" x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#f2fbe6" />
          <stop offset="0.5" stopColor="#e2f5ee" />
          <stop offset="1" stopColor="#eae8f8" />
        </linearGradient>
        <radialGradient id="ar-glow-lime" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#c6fb6f" stopOpacity="0.75" />
          <stop offset="1" stopColor="#c6fb6f" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="ar-glow-mint" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#67f8bb" stopOpacity="0.6" />
          <stop offset="1" stopColor="#67f8bb" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ar-coin" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#e2ffab" />
          <stop offset="0.55" stopColor="#c6fb6f" />
          <stop offset="1" stopColor="#93e23f" />
        </linearGradient>
        <linearGradient id="ar-line" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#c6fb6f" />
          <stop offset="1" stopColor="#8fe86f" />
        </linearGradient>
        <filter id="ar-soft" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="7" stdDeviation="7" floodColor="#131825" floodOpacity="0.16" />
        </filter>
        <clipPath id="ar-frame">
          <rect width="320" height="300" />
        </clipPath>
      </defs>

      <g clipPath="url(#ar-frame)">
        <rect width="320" height="300" fill="url(#ar-ground)" />
        <circle cx="252" cy="70" r="130" fill="url(#ar-glow-lime)" />
        <circle cx="60" cy="250" r="130" fill="url(#ar-glow-mint)" />

        {/* Faint hatch, echoing the disc behind the card. */}
        <g stroke="#131825" strokeWidth="1" opacity="0.06">
          {Array.from({ length: 26 }, (_, i) => -80 + i * 22).map((x) => (
            <line key={x} x1={x} y1="320" x2={x + 140} y2="-20" />
          ))}
        </g>

        {/* Two cards behind the front one, so the stack reads as depth. */}
        <g filter="url(#ar-soft)">
          <rect
            x="52"
            y="44"
            width="200"
            height="150"
            rx="14"
            fill="#ffffff"
            opacity="0.55"
            transform="rotate(-9 152 119)"
          />
          <rect
            x="46"
            y="52"
            width="212"
            height="158"
            rx="14"
            fill="#ffffff"
            opacity="0.8"
            transform="rotate(-4.5 152 131)"
          />
        </g>

        {/* The assistant answer itself. */}
        <g filter="url(#ar-soft)" transform="rotate(-1.5 160 148)">
          <rect
            x="40"
            y="62"
            width="224"
            height="172"
            rx="15"
            fill="#fff"
            stroke="#131825"
            strokeWidth="2.5"
          />

          {/* Assistant avatar and label */}
          <circle cx="64" cy="88" r="9.5" fill="#131825" />
          <path
            d="M60 88.5l3 3 5.5-6"
            stroke="#c6fb6f"
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect x="82" y="83" width="54" height="8" rx="4" fill="#131825" opacity="0.42" />

          {/* Ordinary answer text */}
          <rect x="60" y="112" width="184" height="8" rx="4" fill="#131825" opacity="0.13" />
          <rect x="60" y="128" width="150" height="8" rx="4" fill="#131825" opacity="0.13" />

          {/* The commercial line, highlighted and marked as disclosed. */}
          <rect
            x="56"
            y="148"
            width="192"
            height="30"
            rx="9"
            fill="url(#ar-line)"
            stroke="#131825"
            strokeWidth="2.2"
          />
          <rect x="68" y="159" width="112" height="8" rx="4" fill="#131825" opacity="0.72" />
          <circle cx="228" cy="163" r="9" fill="#131825" />
          <path
            d="M224 163.5l3 3 5.5-6"
            stroke="#c6fb6f"
            strokeWidth="2.2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <rect x="60" y="194" width="120" height="8" rx="4" fill="#131825" opacity="0.13" />
          <rect x="60" y="210" width="76" height="8" rx="4" fill="#131825" opacity="0.13" />
        </g>

        {/* The payment that bought that line. */}
        <g filter="url(#ar-soft)" transform="rotate(11 250 62)">
          <circle cx="250" cy="62" r="35" fill="url(#ar-coin)" stroke="#131825" strokeWidth="2.5" />
          <circle
            cx="250"
            cy="62"
            r="26"
            fill="none"
            stroke="#131825"
            strokeWidth="1.5"
            opacity="0.35"
          />
          <text
            x="250"
            y="68"
            textAnchor="middle"
            fontFamily="var(--body), sans-serif"
            fontSize="15"
            fontWeight="700"
            fill="#131825"
          >
            USDC
          </text>
        </g>

        {/* Payment flows into the highlighted line. */}
        <path
          d="M228 96c-6 22-18 40-38 52"
          stroke="#131825"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          strokeDasharray="1 9"
        />
        <path
          d="M198 146l-9 4 1-9"
          stroke="#131825"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Two independent sources agreeing. */}
        <g filter="url(#ar-soft)" transform="rotate(-5 236 250)">
          <rect
            x="176"
            y="232"
            width="120"
            height="42"
            rx="21"
            fill="#fff"
            stroke="#131825"
            strokeWidth="2.5"
          />
          <circle cx="204" cy="253" r="14" fill="#fff" stroke="#131825" strokeWidth="2.2" />
          <path
            d="M198 253l4.5 4.5 8-8.5"
            stroke="#131825"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="238" cy="253" r="14" fill="#c6fb6f" stroke="#131825" strokeWidth="2.2" />
          <path
            d="M232 253l4.5 4.5 8-8.5"
            stroke="#131825"
            strokeWidth="2.4"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text
            x="268"
            y="258"
            textAnchor="middle"
            fontFamily="var(--body), sans-serif"
            fontSize="15"
            fontWeight="700"
            fill="#131825"
          >
            =
          </text>
        </g>

        {/* Small sparkles for lift. */}
        <g fill="#131825" opacity="0.5">
          <path d="M298 132l2.6 6.4 6.4 2.6-6.4 2.6-2.6 6.4-2.6-6.4-6.4-2.6 6.4-2.6Z" />
          <path d="M28 44l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" />
        </g>
      </g>
    </svg>
  );
}
