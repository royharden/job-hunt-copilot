import { afterAll } from "vitest";

// Tooling is deliberately separate from the pinned product install. See RV test README.
const jsdomModule = "../../.agent-work/rv-tooling/node_modules/jsdom/lib/api.js";
const { JSDOM } = await import(jsdomModule);
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://127.0.0.1/" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Event", "MouseEvent", "localStorage", "sessionStorage"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, writable: true, value: true });
afterAll(() => dom.window.close());
