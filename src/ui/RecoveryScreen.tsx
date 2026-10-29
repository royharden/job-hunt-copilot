import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

export function RecoveryScreen(props: { client: SupabaseClient; onDone: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < 8 || password !== confirmation) {
      setError("Use at least 8 characters and enter the same password twice.");
      return;
    }
    setBusy(true);
    try {
      const result = await props.client.auth.updateUser({ password });
      if (result.error) { setError("Password could not be updated. Reopen a recovery link and try again."); return; }
      setPassword("");
      setConfirmation("");
      setSaved(true);
    } catch {
      setError("Password could not be updated. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try { await props.onDone(); }
    catch { setError("Could not sign out. Try again before leaving recovery."); }
    finally { setBusy(false); }
  }

  return (
    <main className="shell">
      <h1>Set a new password</h1>
      <section className="panel stack">
        {saved ? <>
          <p role="status">Password updated. Sign out of recovery, then sign in with your new password.</p>
          <button type="button" disabled={busy} onClick={() => void finish()}>Return to sign in</button>
        </> : <form className="stack" onSubmit={submit}>
          <label>New password<input type="password" autoComplete="new-password" minLength={8} required
            value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <label>Confirm new password<input type="password" autoComplete="new-password" minLength={8} required
            value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
          <div className="row">
            <button type="submit" disabled={busy}>Update password</button>
            <button type="button" className="quiet" disabled={busy} onClick={() => void finish()}>Cancel recovery and sign out</button>
          </div>
        </form>}
        {error ? <p role="alert" className="error">{error}</p> : null}
      </section>
    </main>
  );
}
