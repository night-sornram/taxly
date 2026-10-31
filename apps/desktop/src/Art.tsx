/* Decorative, theme-aware illustrations (colors come from .art-* classes in shell.css). */

/** Coin stack, a tax sheet with a rising chart, and a leaf. */
export function MoneyArt({ className = "" }: { className?: string }) {
  return (
    <svg className={`art ${className}`} viewBox="0 0 240 180" aria-hidden="true">
      <ellipse className="art-shadow" cx="120" cy="164" rx="98" ry="10" />
      <rect className="art-paper" x="92" y="18" width="104" height="132" rx="14" />
      <rect className="art-mint" x="106" y="34" width="52" height="8" rx="4" />
      <rect className="art-line" x="106" y="50" width="76" height="6" rx="3" />
      <rect className="art-line" x="106" y="62" width="60" height="6" rx="3" />
      <rect className="art-mint" x="106" y="104" width="12" height="30" rx="4" />
      <rect className="art-mint" x="124" y="94" width="12" height="40" rx="4" />
      <rect className="art-bright" x="142" y="82" width="12" height="52" rx="4" />
      <rect className="art-forest" x="160" y="72" width="12" height="62" rx="4" />
      <path className="art-stroke" d="M108 100 130 88l18 4 26-24" />
      <circle className="art-forest" cx="174" cy="68" r="5" />
      <g>
        <ellipse className="art-gold-dark" cx="62" cy="146" rx="38" ry="12" />
        <rect className="art-gold-dark" x="24" y="128" width="76" height="18" />
        <ellipse className="art-gold" cx="62" cy="128" rx="38" ry="12" />
        <rect className="art-gold-dark" x="24" y="110" width="76" height="18" />
        <ellipse className="art-gold" cx="62" cy="110" rx="38" ry="12" />
        <rect className="art-gold-dark" x="24" y="92" width="76" height="18" />
        <ellipse className="art-gold" cx="62" cy="92" rx="38" ry="12" />
        <text className="art-coin-mark" x="62" y="97" textAnchor="middle">
          ฿
        </text>
      </g>
      <path className="art-bright" d="M206 54c-22 0-34 14-34 34 20 0 34-12 34-34Z" />
      <path className="art-stroke-light" d="M176 84c8-10 16-17 26-24" />
      <path className="art-sparkle" d="m40 30 4 10 10 4-10 4-4 10-4-10-10-4 10-4Z" />
      <path className="art-sparkle" d="m216 120 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z" />
    </svg>
  );
}

/** An open tray with a leaf: nothing here yet, and that is fine. */
export function EmptyArt({ className = "" }: { className?: string }) {
  return (
    <svg className={`art ${className}`} viewBox="0 0 160 120" aria-hidden="true">
      <ellipse className="art-shadow" cx="80" cy="108" rx="58" ry="7" />
      <path className="art-mint" d="M28 62h104l-10 38a8 8 0 0 1-8 6H46a8 8 0 0 1-8-6Z" />
      <rect className="art-paper art-outline" x="46" y="18" width="68" height="60" rx="10" />
      <rect className="art-line" x="58" y="32" width="44" height="6" rx="3" />
      <rect className="art-line" x="58" y="44" width="32" height="6" rx="3" />
      <path className="art-forest" d="M28 62h30a22 14 0 0 0 44 0h30l-4 10H32Z" />
      <path className="art-bright" d="M126 14c-14 0-22 9-22 22 13 0 22-8 22-22Z" />
      <path className="art-sparkle" d="m30 22 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z" />
    </svg>
  );
}
