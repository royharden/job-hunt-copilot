import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
vi.mock("../../src/lib/supabase.ts", () => ({ getSupabase: () => null }));
import { App } from "../../src/App.tsx";

// DOM integration, intentionally reported separately from a real browser/keyboard/clipboard walk.
it("RV walks profile, review, coverages, fabrications, approval, board, history and recorded results in isolated DOM", async () => {
  localStorage.clear(); sessionStorage.clear();
  const forbiddenFetch = vi.fn(() => { throw new Error("No network allowed in synthetic demo"); });
  vi.stubGlobal("fetch", forbiddenFetch);
  const copied: string[] = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { copied.push(text); } } });
  const host = document.createElement("div"); document.body.append(host); let root = createRoot(host);
  const buttons = (container: ParentNode, label: string) => [...container.querySelectorAll("button")].filter((item) => item.textContent === label);
  async function click(label: string, container: ParentNode = host) {
    const button = buttons(container, label)[0]; if (!button) throw new Error(`Missing ${label}`);
    expect(button.disabled, `${label} enabled`).toBe(false); await act(async () => button.click());
  }
  const section = (id: string) => host.querySelector(`section[aria-labelledby='${id}']`)!;
  const state = () => JSON.parse(localStorage.getItem("job-hunt-copilot-demo-v2")!);
  try {
    await act(async () => root.render(createElement(App)));
    expect(host.textContent).toContain("Start demo");
    await click("Start demo"); await click("Re-link to the current version");
    expect(section("health-heading").textContent).toContain("No problems");
    await click("Postings & packets"); await click("Paste sample job (synthetic)");
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const review = section("review-heading");
    const benefit = [...review.querySelectorAll("tbody tr")].find((row) => row.textContent?.includes("benefit"))!;
    await click("Remove", benefit);
    const mixed = [...review.querySelectorAll("tbody tr")].find((row) => row.textContent?.includes("mixed"))!;
    await click("Split", mixed); await click("Split", mixed);
    await click("Mark all retained as reviewed"); await click("Save review");
    for (const pattern of [/React/, /Python/, /^TypeScript$/, /latency/, /Kubernetes/, /GraphQL/]) {
      const row = [...section("evidence-heading").querySelectorAll("li.card")].find((item) => pattern.test(item.querySelector("strong")?.textContent ?? ""))!;
      expect(row, pattern.source).toBeTruthy();
      if (/Kubernetes|GraphQL/.test(pattern.source)) await click("Mark reviewed gap", row);
      else {
        const input = row.querySelector("input[type=checkbox]") as HTMLInputElement;
        expect(input).not.toBeNull(); await act(async () => input.click());
        await click(pattern.source.includes("latency") ? "Confirm partial" : "Confirm direct", row);
      }
    }
    const confirmed = state().mappings.at(-1).evidence;
    expect(confirmed.filter((item: { confirmed: unknown }) => item.confirmed)).toHaveLength(6);
    expect(section("evidence-heading").textContent).toContain("50");
    await click("Assemble packet");
    const packetSection = section("packet-heading");
    const python = [...packetSection.querySelectorAll("ol.packet > li")].find((row) => row.textContent?.includes("Built internal Python"))!;
    await click("Inspect", python); expect(python.textContent).toContain("Exact output:"); expect(python.textContent).toContain("fact source");
    await click("Remove", python);
    expect(packetSection.textContent).toContain("34.6");
    expect(section("evidence-heading").textContent).toContain("50");
    for (const label of ["Added tool", "Unit swap", "Wrong-project metric", "Contributed-to became led"]) {
      await click(label, packetSection);
      const bad = packetSection.querySelector("ol.packet > li.grade-reverted,ol.packet > li.grade-blocked")!;
      expect(bad, label).not.toBeNull();
      expect(buttons(packetSection, "Validate, approve and export")[0].disabled).toBe(true);
      await click("Add a true statement instead", bad);
      const form = bad.querySelector("form[aria-label='New statement']")!;
      expect((form.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
      await click("Cancel", form); await click("Remove", bad);
    }
    await click("Validate, approve and export");
    expect(packetSection.textContent).toContain("no server receipt");
    await click("Copy plain text"); expect(copied).toHaveLength(1); expect(copied[0]).toContain("React dashboards");
    expect(state().applications[0].stage).toBe("approved");
    await click("Board");
    const appButton = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes("Senior Frontend Engineer"))!;
    await act(async () => appButton.click());
    const detail = section("detail-heading");
    const select = detail.querySelector("select")!;
    await act(async () => { select.value = "applied"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => (detail.querySelector("input[type=checkbox]") as HTMLInputElement).click());
    await click("Record move"); expect(state().applications[0].stage).toBe("applied");
    await click("Sample: vague"); await click("Check reply");
    await click("Sample: quoted offer"); await click("Check reply");
    expect(state().replies.slice(0, 2).every((reply: { prediction: { needsReview: boolean } }) => reply.prediction.needsReview)).toBe(true);
    await click("Sample: clear rejection"); await click("Check reply");
    const rejection = [...detail.querySelectorAll("li.card")].at(-1)!;
    await click("Confirm", rejection); expect(state().applications[0].stage).toBe("rejected");
    await act(async () => root.unmount()); root = createRoot(host); await act(async () => root.render(createElement(App)));
    await click("Board"); expect(host.textContent).toContain("rejected"); expect(state().events).toHaveLength(3);
    await click("Results"); expect(host.textContent).toContain("Synthetic pilot edition 1 was run locally");
    expect(host.textContent).toContain("unsupported blocked"); expect(host.textContent).toContain("Synthetic demo");
    expect(forbiddenFetch).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
}, 30000);
