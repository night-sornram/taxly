import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import InstrumentIdentity, { instrumentLogo } from "./InstrumentIdentity";
import type { Instrument } from "./types";

afterEach(cleanup);

const ptt: Instrument = {
  id: "ptt",
  symbol: "PTT",
  name: "ปตท.",
  kind: "stock",
  exchange: "XBKK",
  currency: "THB",
  provider_symbol: "PTT.BK",
};
const apple: Instrument = {
  ...ptt,
  id: "apple",
  symbol: "AAPL",
  name: "Apple",
  exchange: "NASDAQ",
  currency: "USD",
  provider_symbol: "AAPL",
};

it("loads the provider logo URL without hiding the symbol or account information", () => {
  const { container } = render(
    <InstrumentIdentity instrument={ptt} secondary="บัญชีหลัก · THB" loadLogo />,
  );
  const image = container.querySelector("img");
  expect(image).toHaveAttribute("src", instrumentLogo(ptt));
  expect(image).toHaveAttribute("src", "https://financialmodelingprep.com/image-stock/PTT.BK.png");
  expect(image).toHaveAttribute("referrerPolicy", "no-referrer");
  expect(image).toHaveAttribute("alt", "");
  expect(screen.getByText("PTT")).toBeInTheDocument();
  expect(screen.getByText("บัญชีหลัก · THB")).toBeInTheDocument();
});

it("makes no image request until market data is enabled and removes the image when disabled", () => {
  const { container, rerender } = render(<InstrumentIdentity instrument={ptt} />);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("PT")).toBeInTheDocument();
  rerender(<InstrumentIdentity instrument={ptt} loadLogo />);
  expect(container.querySelector("img")).toBeInTheDocument();
  rerender(<InstrumentIdentity instrument={ptt} loadLogo={false} />);
  expect(container.querySelector("img")).toBeNull();
});

it("uses market-qualified symbols and rejects malformed symbols", () => {
  expect(instrumentLogo({ ...ptt, provider_symbol: "" })).toBe(
    "https://financialmodelingprep.com/image-stock/PTT.BK.png",
  );
  expect(instrumentLogo(apple)).toBe("https://financialmodelingprep.com/image-stock/AAPL.png");
  expect(instrumentLogo({ ...apple, provider_symbol: "../AAPL?account=private" })).toBeUndefined();
});

it("falls back on an image error and can display a different instrument afterward", () => {
  const { container, rerender } = render(<InstrumentIdentity instrument={ptt} loadLogo />);
  fireEvent.error(container.querySelector("img")!);
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("PT")).toBeInTheDocument();
  rerender(<InstrumentIdentity instrument={apple} loadLogo />);
  expect(container.querySelector("img")).toHaveAttribute("src", instrumentLogo(apple));
});
