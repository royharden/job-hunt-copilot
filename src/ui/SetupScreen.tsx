import { useState, type FormEvent } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { errorMessage } from "../lib/format.ts";

export function SetupScreen(props: {
  client: SupabaseClient | null;
  onDemo: () => void;
  onSession: (session: Session) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  async function signUp(event: FormEvent) {
    event.preventDefault();
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

  return (
    <div className="shell">
      <h1>Job Hunt Copilot</h1>
      <p className="muted">
        Paste a posting, match it to approved facts, and approve a draft only when every claim traces to one of those facts.
        Nothing is submitted for you.
      </p>
      <section className="panel stack">
        <h2>Local demo</h2>
        <p className="muted">
          The demo stays in this browser under the key job-hunt-copilot-demo-v1. It uses a synthetic Contoso profile and does not call a model.
        </p>
        <button type="button" onClick={props.onDemo}>Use local demo</button>
      </section>
      <section className="panel stack">
        <h2>Signed-in project</h2>
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
              <button type="button" className="quiet" disabled={busy} onClick={signUp}>Create account</button>
            </div>
          </form>
        ) : (
          <p className="muted">
            Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server. Server secret XAI_API_KEY stays off the client.
            Until those public values exist, the local demo is the path that runs.
          </p>
        )}
        {error ? <p className="error">{errorMessage(new Error(error))}</p> : null}
        {message ? <p className="notice">{message}</p> : null}
      </section>
    </div>
  );
}
