import { useEffect, useRef, useState } from "react";
import TaxApp from "./TaxApp";
import WealthApp from "./wealth/WealthApp";

export default function App() {
  const [area, setArea] = useState<"tax" | "wealth">("tax");
  // Both modules stay mounted; switching only toggles visibility so each keeps
  // its data, current view, and scroll position instead of refetching.
  const taxShell = useRef<HTMLDivElement>(null);
  const wealthShell = useRef<HTMLDivElement>(null);
  const scrollMemory = useRef({ tax: 0, wealth: 0 });
  const previous = useRef(area);
  const switchArea = (next: "tax" | "wealth") => {
    if (next === previous.current) return;
    scrollMemory.current[previous.current] = window.scrollY;
    previous.current = next;
    setArea(next);
  };
  useEffect(() => {
    window.scrollTo({ top: scrollMemory.current[area] });
    const shell = area === "wealth" ? wealthShell.current : taxShell.current;
    shell?.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
  }, [area]);
  return (
    <>
      <div hidden={area !== "tax"} ref={taxShell}>
        <TaxApp onInvestments={() => switchArea("wealth")} />
      </div>
      <div hidden={area !== "wealth"} ref={wealthShell}>
        <WealthApp onTaxes={() => switchArea("tax")} />
      </div>
    </>
  );
}
