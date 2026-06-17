/**
 * illustrations.tsx — custom brand mark + warm SVG illustrations for Couple Lab.
 * On-brand palette: teal #167d78, coral #bf4d45, gold #c28b21, plum #7351a5, ink #252521.
 * All scalable, theme-consistent, and dependency-free.
 */

export function BrandLogo({ size = 28 }: { size?: number }) {
  // two overlapping people-circles whose shared "lens" forms a heart — connection from two wholes
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="cl-a" x1="0" y1="0" x2="48" y2="48">
          <stop offset="0" stopColor="#1aa39c" />
          <stop offset="1" stopColor="#167d78" />
        </linearGradient>
        <linearGradient id="cl-b" x1="48" y1="0" x2="0" y2="48">
          <stop offset="0" stopColor="#d2685f" />
          <stop offset="1" stopColor="#bf4d45" />
        </linearGradient>
      </defs>
      <circle cx="18" cy="24" r="13" fill="url(#cl-a)" opacity="0.92" />
      <circle cx="30" cy="24" r="13" fill="url(#cl-b)" opacity="0.82" />
      {/* the shared heart in the overlap */}
      <path d="M24 30c-3.2-2.3-5.4-4-5.4-6.4 0-1.6 1.2-2.7 2.7-2.7 1 0 1.9.5 2.7 1.5.8-1 1.7-1.5 2.7-1.5 1.5 0 2.7 1.1 2.7 2.7 0 2.4-2.2 4.1-5.4 6.4z" fill="#fff" />
    </svg>
  );
}

export function CoupleHero({ className = "" }: { className?: string }) {
  // two figures turning toward each other, with "bids" (dots) arcing between them
  return (
    <svg className={className} viewBox="0 0 360 220" fill="none" role="img" aria-label="Two partners turning toward each other">
      <rect x="0" y="0" width="360" height="220" rx="16" fill="#f3f7f4" />
      <circle cx="300" cy="44" r="46" fill="#e0f2ef" />
      <circle cx="64" cy="186" r="58" fill="#fae7e2" opacity="0.7" />
      {/* connecting arc of bids */}
      <path d="M104 150 C150 70 210 70 256 150" stroke="#c28b21" strokeWidth="2.5" strokeDasharray="2 9" strokeLinecap="round" />
      <circle cx="150" cy="92" r="4" fill="#c28b21" />
      <circle cx="210" cy="92" r="4" fill="#c28b21" />
      <circle cx="180" cy="80" r="5" fill="#7351a5" />
      {/* left figure (teal) */}
      <g>
        <circle cx="118" cy="120" r="24" fill="#167d78" />
        <path d="M82 196c0-22 16-38 36-38s36 16 36 38z" fill="#167d78" opacity="0.9" />
      </g>
      {/* right figure (coral) */}
      <g>
        <circle cx="242" cy="120" r="24" fill="#bf4d45" />
        <path d="M206 196c0-22 16-38 36-38s36 16 36 38z" fill="#bf4d45" opacity="0.9" />
      </g>
      {/* small shared heart between them */}
      <path d="M180 150c-6-4.4-10-7.6-10-12 0-3 2.3-5.1 5.1-5.1 1.9 0 3.6 1 4.9 2.9 1.3-1.9 3-2.9 4.9-2.9 2.8 0 5.1 2.1 5.1 5.1 0 4.4-4 7.6-10 12z" fill="#fff" />
    </svg>
  );
}

export function CameraEmptyArt({ size = 96 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <rect x="14" y="30" width="92" height="64" rx="12" stroke="#d9ddd2" strokeWidth="3" />
      <circle cx="60" cy="62" r="20" stroke="#d9ddd2" strokeWidth="3" />
      <circle cx="60" cy="62" r="9" fill="#d9ddd2" opacity="0.6" />
      <rect x="46" y="22" width="28" height="12" rx="5" stroke="#d9ddd2" strokeWidth="3" />
      <circle cx="92" cy="44" r="3" fill="#d9ddd2" />
    </svg>
  );
}

export function EmptyArt({ size = 120 }: { size?: number }) {
  // gentle "begin a session" emblem: two arcs meeting around a spark
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" fill="none" aria-hidden="true">
      <path d="M40 100c-16-10-24-26-24-44 0-8 6-14 14-14" stroke="#167d78" strokeWidth="4" strokeLinecap="round" />
      <path d="M100 100c16-10 24-26 24-44 0-8-6-14-14-14" stroke="#bf4d45" strokeWidth="4" strokeLinecap="round" />
      <path d="M70 96c-9-6.6-15-11.4-15-18 0-4.4 3.4-7.6 7.6-7.6 2.8 0 5.4 1.5 7.4 4.4 2-2.9 4.6-4.4 7.4-4.4 4.2 0 7.6 3.2 7.6 7.6 0 6.6-6 11.4-15 18z" fill="#c28b21" />
      <circle cx="70" cy="118" r="3.5" fill="#7351a5" />
    </svg>
  );
}
