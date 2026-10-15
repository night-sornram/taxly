import { useState } from "react";
import TaxApp from "./TaxApp";
import WealthApp from "./wealth/WealthApp";

export default function App() {
  const [area, setArea] = useState<"tax" | "wealth">("tax");
  return area === "wealth" ? (
    <WealthApp onTaxes={() => setArea("tax")} />
  ) : (
    <TaxApp onInvestments={() => setArea("wealth")} />
  );
}
