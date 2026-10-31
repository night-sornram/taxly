import { render, screen, fireEvent, act, renderHook, within } from "@testing-library/react";
import { beforeEach, it, expect, vi } from "vitest";
import { useTheme } from "./theme";
import { ThemeToggle } from "./components";

function mockMatchMedia(dark: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const media = {
    matches: dark,
    addEventListener: (name: string, listener: (event: { matches: boolean }) => void) => {
      if (name === "change") listeners.add(listener);
    },
    removeEventListener: (_name: string, listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    },
  };
  vi.stubGlobal("matchMedia", () => media);
  return {
    fire(next: boolean) {
      media.matches = next;
      listeners.forEach((listener) => listener({ matches: next }));
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

it("starts in system mode and leaves the attribute unset so CSS media queries decide", () => {
  mockMatchMedia(false);
  const { result } = renderHook(() => useTheme());
  expect(result.current.mode).toBe("system");
  expect(result.current.theme).toBe("light");
  expect(document.documentElement.dataset.theme).toBeUndefined();
});

it("applies and persists an explicit theme choice", () => {
  mockMatchMedia(false);
  const { result } = renderHook(() => useTheme());
  act(() => result.current.setTheme("dark"));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(localStorage.getItem("taxly-theme")).toBe("dark");
  act(() => result.current.setTheme("light"));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("taxly-theme")).toBe("light");
});

it("follows the OS colour scheme while still in system mode", () => {
  const media = mockMatchMedia(false);
  const { result } = renderHook(() => useTheme());
  act(() => media.fire(true));
  expect(result.current.theme).toBe("dark");
  act(() => media.fire(false));
  expect(result.current.theme).toBe("light");
});

it("restores a stored explicit choice on load even when the OS disagrees", () => {
  localStorage.setItem("taxly-theme", "dark");
  mockMatchMedia(false);
  const { result } = renderHook(() => useTheme());
  expect(result.current.theme).toBe("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("toggles between light and dark from the button", () => {
  mockMatchMedia(false);
  render(<ThemeToggle />);
  const button = screen.getByRole("button", { name: "เปิดธีมมืด" });
  fireEvent.click(button);
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("taxly-theme")).toBe("dark");
  fireEvent.click(screen.getByRole("button", { name: "เปิดธีมสว่าง" }));
  expect(document.documentElement.dataset.theme).toBe("light");
});

it("keeps the toggle in every area on the same choice", () => {
  mockMatchMedia(false);
  const { container } = render(
    <>
      <ThemeToggle />
      <ThemeToggle />
    </>,
  );
  const view = within(container);
  fireEvent.click(view.getAllByRole("button", { name: "เปิดธีมมืด" })[0]);
  // The other area's toggle must now offer the way back, not "dark" again.
  expect(view.getAllByRole("button", { name: "เปิดธีมสว่าง" })).toHaveLength(2);
  fireEvent.click(view.getAllByRole("button", { name: "เปิดธีมสว่าง" })[1]);
  expect(document.documentElement.dataset.theme).toBe("light");
});
