import { useState, type FormEvent } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { DemoStorageStatus } from "../lib/demoStore.ts";

export function SetupScreen(props: {
  client: SupabaseClient | null;
  demoStatus: DemoStorageStatus;
  error: string | null;
  onDemo: () => void;
  onResetDemo: () => void;
  onSession: (session: Session) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!props.client) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await props.client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    if (!result.data.session) {
      setMessage("No session came back. If email confirmation is required, open that message, then sign in.");
      return;
    }
    props.onSession(result.data.session);
  }

  async function signUp() {
    if (!props.client) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await props.client.auth.signUp({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    if (result.data.session) {
      props.onSession(result.data.session);
      return;
    }
    setMessage("Account created. If confirmation is on, open the email, then sign in. No session was stored.");
  }

  async function sendReset() {
    if (!props.client || email.trim().length === 0) {
      setError("Enter your email first.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await props.client.auth.resetPasswordForEmail(email.trim());
    setBusy(false);
    if (result.error) setError(result.error.message);
    else setMessage("If that address has an account, a recovery email is on its way. Redirect settings are configured in the host project.");
  }

  const blockedDemo = props.demoStatus === "incompatible" || props.demoStatus === "legacy_only";

  return (
    <div className="shell">
      <h1>Job Hunt Copilot</h1>
      <p className="muted">
        Keep approved career facts, review a pasted job posting, choose the evidence that supports each requirement, and approve a packet
        whose every line traces to your approved sentences or a fixed template. Nothing is submitted for you, and no model is called.
      </p>
      {props.error ? <p className="error" role="alert">{props.error}</p> : null}
      <section className="panel stack">
        <h2>Synthetic demo</h2>
        <p className="muted">
          An invented profile (Avery Example) and posting (Northwind Traders). Everything stays in this browser under the key
          job-hunt-copilot-demo-v2 and never touches a database or provider. Choosing the demo ignores any signed-in session.
        </p>
        {blockedDemo ? (
          <p className="notice">
            {props.demoStatus === "legacy_only"
              ? "Demo data from an older version of this app is stored in this browser. It cannot be migrated."
              : "Stored demo data is from an incompatible version."}{" "}
            Reset it to start the current demo. Only this app's demo keys are removed.
          </p>
        ) : null}
        <div className="row">
          {props.demoStatus !== "incompatible" ? (
            <button type="button" onClick={props.onDemo}>
              {props.demoStatus === "ok" ? "Continue demo" : "Start demo"}
            </button>
          ) : null}
          {confirmReset ? (
            <>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  setConfirmReset(false);
                  props.onResetDemo();
                }}
              >
                Confirm reset
              </button>
              <button type="button" className="quiet" onClick={() => setConfirmReset(false)}>Cancel</button>
            </>
          ) : props.demoStatus !== "empty" && props.demoStatus !== "unavailable" ? (
            <button type="button" className="quiet" onClick={() => setConfirmReset(true)}>Reset demo data</button>
          ) : null}
        </div>
        {props.demoStatus === "unavailable" ? (
          <p className="muted">Browser storage is unavailable, so the demo will not survive a reload.</p>
        ) : null}
      </section>
      <section className="panel stack">
        <h2>Your private workspace</h2>
        {props.client ? (
          <form className="stack" onSubmit={signIn}>
            <label>
              Email
              <input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <div className="row">
              <button type="submit" disabled={busy}>Sign in</button>
              <button type="button" className="quiet" disabled={busy} onClick={() => void signUp()}>Create account</button>
              <button type="button" className="quiet" disabled={busy} onClick={() => void sendReset()}>Forgot password</button>
            </div>
          </form>
        ) : (
          <p className="muted">
            Not configured. A signed-in workspace needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (public values only) and a provisioned
            database. Until then the synthetic demo is the path that runs.
          </p>
        )}
        {error ? <p className="error" role="alert">{error}</p> : null}
        {message ? <p className="notice">{message}</p> : null}
      </section>
    </div>
  );
}
