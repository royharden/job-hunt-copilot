import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDemoStore } from "../../src/lib/demoStore.ts";

const fake = vi.hoisted(() => ({
  emit: null as null | ((event: string, session: unknown) => void),
  getSession: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(), remote: vi.fn(), client: {} as object,
}));
vi.mock("../../src/lib/supabase.ts", () => ({ getSupabase: () => fake.client }));
vi.mock("../../src/lib/remoteStore.ts", () => ({ createRemoteStore: (...args: unknown[]) => fake.remote(...args) }));
import { App } from "../../src/App.tsx";

const session = { user: { id: "rv-synthetic-user" } };
let root: Root;
let host: HTMLDivElement;
async function mount() { await act(async () => root.render(createElement(App))); }
async function emit(event: string, value: unknown = session) { await act(async () => fake.emit!(event, value)); }
function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((item) => item.textContent === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function fill(index: number, value: string) {
  const input = host.querySelectorAll("input[type=password]")[index];
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function submit() { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

describe("RV recovery auth-event acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear(); sessionStorage.clear();
    fake.getSession.mockResolvedValue({ data: { session: null } });
    fake.updateUser.mockResolvedValue({ error: null });
    fake.signOut.mockResolvedValue({ error: null });
    fake.client = { auth: { getSession: fake.getSession, updateUser: fake.updateUser, signOut: fake.signOut,
      onAuthStateChange: (callback: typeof fake.emit) => { fake.emit = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } };
    fake.remote.mockReturnValue({ mode: "remote", load: vi.fn(async () => createDemoStore().load()) });
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  // what_bug_this_catches: recovery auth events activating private workspace before password reset.
  it("routes recovery, suppresses normal auth activation, and rejects mismatched confirmation", async () => {
    await mount(); await emit("PASSWORD_RECOVERY");
    expect(host.textContent).toContain("Set a new password");
    await emit("SIGNED_IN"); await emit("TOKEN_REFRESHED");
    expect(fake.remote).not.toHaveBeenCalled();
    await fill(0, "synthetic-password-1"); await fill(1, "different-value"); await submit();
    expect(fake.updateUser).not.toHaveBeenCalled();
    expect(host.querySelector("[role=alert]")?.textContent).toContain("same password twice");
  });

  // what_bug_this_catches: failed update claiming success, clearing form, or showing backend diagnostic text.
  it("keeps errors retryable and signs out only after successful update", async () => {
    await mount(); await emit("PASSWORD_RECOVERY");
    await fill(0, "synthetic-password-1"); await fill(1, "synthetic-password-1");
    fake.updateUser.mockResolvedValueOnce({ error: { message: "backend-detail-must-not-display" } });
    await submit();
    expect(host.textContent).toContain("Password could not be updated");
    expect(host.textContent).not.toContain("backend-detail-must-not-display");
    expect((host.querySelector("input") as HTMLInputElement).value).toBe("synthetic-password-1");
    expect(fake.signOut).not.toHaveBeenCalled();
    await submit();
    expect(fake.updateUser).toHaveBeenLastCalledWith({ password: "synthetic-password-1" });
    expect(host.textContent).toContain("Password updated");
    expect(host.querySelector("input")).toBeNull();
    await click("Return to sign in");
    expect(fake.signOut).toHaveBeenCalledOnce();
    expect(host.textContent).not.toContain("Set a new password");
    expect(fake.remote).not.toHaveBeenCalled();
  });

  // what_bug_this_catches: cancel or failed signout releasing the recovery session into normal workspace.
  it("does not leave recovery after failed signout, then allows cancellation", async () => {
    await mount(); await emit("PASSWORD_RECOVERY");
    fake.signOut.mockResolvedValueOnce({ error: { message: "synthetic failure" } });
    await click("Cancel recovery and sign out");
    expect(host.textContent).toContain("Could not sign out");
    expect(host.textContent).toContain("Set a new password");
    await click("Cancel recovery and sign out");
    expect(host.textContent).not.toContain("Set a new password");
    expect(fake.updateUser).not.toHaveBeenCalled(); expect(fake.remote).not.toHaveBeenCalled();
  });

  // what_bug_this_catches: delayed getSession winning a race against PASSWORD_RECOVERY routing.
  it("ignores a delayed initial session during recovery", async () => {
    let resolve!: (value: unknown) => void;
    fake.getSession.mockReturnValue(new Promise((done) => { resolve = done; }));
    await mount(); await emit("PASSWORD_RECOVERY");
    await act(async () => resolve({ data: { session } }));
    expect(host.textContent).toContain("Set a new password");
    expect(fake.remote).not.toHaveBeenCalled();
    await emit("SIGNED_OUT", null);
    expect(host.textContent).not.toContain("Set a new password");
  });

  // what_bug_this_catches: leftover real-auth events replacing an explicitly selected synthetic demo.
  it("remembered demo ignores recovery, token refresh and leftover initial session", async () => {
    sessionStorage.setItem("job-hunt-copilot-demo-chosen", "1");
    fake.getSession.mockResolvedValue({ data: { session } });
    await mount(); await emit("PASSWORD_RECOVERY"); await emit("TOKEN_REFRESHED");
    expect(host.textContent).toContain("Synthetic demo");
    expect(host.textContent).not.toContain("Set a new password");
    expect(fake.remote).not.toHaveBeenCalled(); expect(fake.updateUser).not.toHaveBeenCalled();
  });
});
