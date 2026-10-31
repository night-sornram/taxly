import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Loading } from "./components";
import LedgerApp from "./ledger/LedgerApp";
import { isDesktop } from "./api";
import { useCloud } from "./sync/SyncProvider";
import SyncPage from "./sync/SyncPage";

type Area = "tax" | "ledger";
const TaxApp = lazy(() => import("./TaxApp"));
export default function App() {
  const cloud = useCloud();
  const [area, setArea] = useState<Area>("tax");
  const [taxVersion, setTaxVersion] = useState(0);
  // Both modules stay mounted; switching only toggles visibility so each keeps
  // its data, current view, and scroll position instead of refetching.
  const taxShell = useRef<HTMLDivElement>(null);
  const ledgerShell = useRef<HTMLDivElement>(null);
  const scrollMemory = useRef({ tax: 0, ledger: 0 });
  const previous = useRef(area);
  const switchArea = (next: Area) => {
    if (next === previous.current) return;
    scrollMemory.current[previous.current] = window.scrollY;
    previous.current = next;
    setArea(next);
  };
  useEffect(() => {
    window.scrollTo({ top: scrollMemory.current[area] });
    const shell = area === "ledger" ? ledgerShell.current : taxShell.current;
    shell?.querySelector<HTMLElement>("main h1")?.focus({ preventScroll: true });
  }, [area]);
  useEffect(() => {
    const updated = () => setTaxVersion((v) => v + 1);
    window.addEventListener("taxly-tax-changed", updated);
    return () => window.removeEventListener("taxly-tax-changed", updated);
  }, []);
  if (!isDesktop())
    return cloud.ready && !cloud.recovery ? (
      <LedgerApp active onSwitchArea={() => {}} onTaxChanged={() => {}} mobile />
    ) : (
      <SyncPage standalone />
    );
  return (
    <>
      <div hidden={area !== "tax"} ref={taxShell}>
        <Suspense fallback={<Loading />}>
          <TaxApp onSwitchArea={() => switchArea("ledger")} dataVersion={taxVersion} />
        </Suspense>
      </div>
      <div hidden={area !== "ledger"} ref={ledgerShell}>
        <LedgerApp
          active={area === "ledger"}
          onSwitchArea={() => switchArea("tax")}
          onTaxChanged={() => setTaxVersion((v) => v + 1)}
        />
      </div>
    </>
  );
}
