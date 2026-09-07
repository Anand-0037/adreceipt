/**
 * The sign / settle / verify collage beside "How a badge earns its place".
 *
 * Laid out as the reference does it: three tall panels butted together behind
 * one border, each with its own tint. The scenes are drawn inline rather than
 * shipped as files, and depict what actually happens - the publisher commits
 * the exact wording, the payer settles straight to them, and anyone re-reads
 * the evidence from two sources.
 *
 * To use photography instead, drop three images in /public and swap each
 * <Panel>'s children for a <Image fill> - the panel geometry stays the same.
 */

const PANEL_W = 160;
const PANEL_H = 340;

function Panel({
  index,
  label,
  note,
  children,
}: {
  index: number;
  label: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <svg
      className="nb-collage-panel"
      viewBox={`0 0 ${PANEL_W} ${PANEL_H}`}
      role="img"
      aria-label={`${label}: ${note}`}
    >
      <title>{`${label}: ${note}`}</title>
      <rect width={PANEL_W} height={PANEL_H} fill={`url(#fc-bg-${index})`} />
      <g stroke="#131825" strokeWidth="1" opacity="0.07">
        {Array.from({ length: 16 }, (_, i) => -60 + i * 22).map((x) => (
          <line key={x} x1={x} y1={PANEL_H + 20} x2={x + 150} y2="-20" />
        ))}
      </g>

      {children}

      {/* Caption plate, so the label sits on the art like the reference. */}
      <g transform={`translate(0 ${PANEL_H - 74})`}>
        <rect x="14" y="0" width={PANEL_W - 28} height="58" rx="10" fill="#fff" opacity="0.92" />
        <text
          x={PANEL_W / 2}
          y="24"
          textAnchor="middle"
          fontFamily="var(--body), sans-serif"
          fontSize="15"
          fontWeight="700"
          fill="#131825"
        >
          {label}
        </text>
        <text
          x={PANEL_W / 2}
          y="43"
          textAnchor="middle"
          fontFamily="var(--body), sans-serif"
          fontSize="10.5"
          fill="#4b5162"
        >
          {note}
        </text>
      </g>
    </svg>
  );
}

export function FlowArtwork() {
  return (
    <div className="nb-collage">
      {/* Gradients live once, shared by all three panels. */}
      <svg width="0" height="0" aria-hidden focusable="false" style={{ position: "absolute" }}>
        <defs>
          <linearGradient id="fc-bg-0" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stopColor="#f7f3d9" />
            <stop offset="1" stopColor="#e9edbe" />
          </linearGradient>
          <linearGradient id="fc-bg-1" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stopColor="#e2f0f8" />
            <stop offset="1" stopColor="#cfe4f2" />
          </linearGradient>
          <linearGradient id="fc-bg-2" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stopColor="#e0f7e6" />
            <stop offset="1" stopColor="#bfeed6" />
          </linearGradient>
          <linearGradient id="fc-coin" x1="0.1" y1="0" x2="0.9" y2="1">
            <stop offset="0" stopColor="#e2ffab" />
            <stop offset="1" stopColor="#93e23f" />
          </linearGradient>
          <filter id="fc-soft" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#131825" floodOpacity="0.16" />
          </filter>
        </defs>
      </svg>

      {/* 1. Sign — the publisher commits the exact wording. */}
      <Panel index={0} label="Sign" note="The exact wording">
        <g filter="url(#fc-soft)">
          <rect
            x="30"
            y="66"
            width="100"
            height="80"
            rx="10"
            fill="#fff"
            opacity="0.6"
            transform="rotate(-8 80 106)"
          />
          <g transform="rotate(-3 80 116)">
            <rect
              x="26"
              y="76"
              width="108"
              height="96"
              rx="11"
              fill="#fff"
              stroke="#131825"
              strokeWidth="2.4"
            />
            <rect x="40" y="94" width="58" height="6" rx="3" fill="#131825" opacity="0.15" />
            <rect x="40" y="106" width="76" height="6" rx="3" fill="#131825" opacity="0.15" />
            <rect
              x="38"
              y="120"
              width="84"
              height="18"
              rx="6"
              fill="#c6fb6f"
              stroke="#131825"
              strokeWidth="2"
            />
            <path
              d="M44 154c9-8 13 5 21-3s11 5 20-3"
              stroke="#131825"
              strokeWidth="2.3"
              fill="none"
              strokeLinecap="round"
            />
          </g>
        </g>
      </Panel>

      {/* 2. Settle — payment goes straight to the publisher. */}
      <Panel index={1} label="Settle" note="Straight to the publisher">
        <g filter="url(#fc-soft)">
          <circle cx="80" cy="112" r="38" fill="url(#fc-coin)" stroke="#131825" strokeWidth="2.4" />
          <circle
            cx="80"
            cy="112"
            r="28"
            fill="none"
            stroke="#131825"
            strokeWidth="1.5"
            opacity="0.35"
          />
          <text
            x="80"
            y="119"
            textAnchor="middle"
            fontFamily="var(--body), sans-serif"
            fontSize="16"
            fontWeight="700"
            fill="#131825"
          >
            USDC
          </text>
        </g>
        {/* No escrow: one hop, payer to publisher. */}
        <g stroke="#131825" strokeWidth="2.3" fill="none" strokeLinecap="round">
          <path d="M30 186h84" strokeDasharray="1 8" opacity="0.6" />
          <path d="M108 180l8 6-8 6" />
          <circle cx="30" cy="186" r="5" fill="#131825" stroke="none" />
        </g>
      </Panel>

      {/* 3. Verify — re-read from two independent sources. */}
      <Panel index={2} label="Verify" note="From two sources">
        <g filter="url(#fc-soft)" transform="rotate(3 80 112)">
          <rect
            x="28"
            y="66"
            width="104"
            height="94"
            rx="11"
            fill="#fff"
            stroke="#131825"
            strokeWidth="2.4"
          />
          <rect x="42" y="84" width="48" height="6" rx="3" fill="#131825" opacity="0.15" />
          <rect x="42" y="96" width="70" height="6" rx="3" fill="#131825" opacity="0.15" />
          <rect x="42" y="108" width="58" height="6" rx="3" fill="#131825" opacity="0.15" />
          <rect
            x="42"
            y="124"
            width="44"
            height="17"
            rx="8"
            fill="#c6fb6f"
            stroke="#131825"
            strokeWidth="2"
          />
        </g>
        <g filter="url(#fc-soft)">
          <circle cx="104" cy="164" r="30" fill="#fff" fillOpacity="0.6" />
          <circle cx="104" cy="164" r="30" fill="none" stroke="#131825" strokeWidth="2.8" />
          <path d="M126 186l16 16" stroke="#131825" strokeWidth="5.5" strokeLinecap="round" />
          <path
            d="M93 164l7 7 13-14"
            stroke="#131825"
            strokeWidth="3.2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </Panel>
    </div>
  );
}
