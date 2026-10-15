import { useState } from "react";
import type { ReactNode } from "react";
import type { Instrument } from "./types";

export function instrumentLogo(instrument?: Instrument): string | undefined {
  if (!instrument) return undefined;
  const exchange = instrument.exchange.trim().toUpperCase().replace(/\s+/g, "");
  const symbol = instrument.symbol.trim().toUpperCase();
  const provider = instrument.provider_symbol.trim().toUpperCase();
  const thai = ["SET", "XBKK", "BKK"].includes(exchange);
  const ticker = provider || (thai && !symbol.endsWith(".BK") ? `${symbol}.BK` : symbol);
  if (!/^[A-Z0-9][A-Z0-9.^=-]{0,31}$/.test(ticker)) return undefined;
  return `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`;
}

export default function InstrumentIdentity({
  instrument,
  secondary,
  loadLogo = false,
}: {
  instrument?: Instrument;
  secondary?: ReactNode;
  loadLogo?: boolean;
}) {
  const source = loadLogo ? instrumentLogo(instrument) : undefined;
  const [failedSource, setFailedSource] = useState<string>();
  const initials = Array.from((instrument?.symbol ?? "?").trim().toUpperCase())
    .filter((character) => /[\p{L}\p{N}]/u.test(character))
    .slice(0, 2)
    .join("");
  return (
    <div className="wealth-instrument-identity">
      <span className="wealth-instrument-logo" aria-hidden="true">
        {source && source !== failedSource ? (
          <img
            src={source}
            alt=""
            width={32}
            height={32}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            draggable={false}
            onError={() => setFailedSource(source)}
          />
        ) : (
          <span>{initials || "?"}</span>
        )}
      </span>
      <div>
        <strong>{instrument?.symbol ?? "—"}</strong>
        {secondary && <small>{secondary}</small>}
      </div>
    </div>
  );
}
