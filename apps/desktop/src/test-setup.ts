import "@testing-library/jest-dom/vitest";
import { beforeAll } from "vitest";

// jsdom implements <dialog> without the modal APIs; stub them so Modal renders
// in tests, marking the dialog open like showModal would.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});
