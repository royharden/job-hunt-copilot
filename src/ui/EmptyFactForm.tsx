import { useState, type FormEvent } from "react";
import { FACT_KINDS, type FactKind } from "../../supabase/functions/_shared/provenance/types.ts";
import { errorMessage } from "../lib/format.ts";
import type { HuntRepository } from "../lib/repository.ts";

// Gap / blocked-line action (PLAN section 7): an EMPTY statement form. It is never prefilled with posting
// wording or a failed line. Saving creates a draft personal statement that still needs explicit approval and
// is not linked to any requirement; the earlier gap or failure stays in history.
export function EmptyFactForm(props: { repo: HuntRepository; onDone: () => void; onCancel: () => void }) {
  const [statement, setStatement] = useState("");
  const [kind, setKind] = useState<FactKind>("accomplishment");
  const [attest, setAttest] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await props.repo.saveFact({
        factId: null,
        kind,
        text: statement,
        roleRef: null,
        projectLabel: null,
        origin: { type: "user_attestation", statement },
      });
      props.onDone();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={(event) => void submit(event)} aria-label="New statement">
      <p className="muted">
        Write only something true in your own words. It is saved as a draft; approve it on the Profile view, then confirm it as evidence.
        Cancelling leaves the gap as it is.
      </p>
      <label>
        Statement
        <textarea value={statement} required maxLength={500} onChange={(event) => setStatement(event.target.value)} />
      </label>
      <label>
        Kind
        <select value={kind} onChange={(event) => setKind(event.target.value as FactKind)}>
          {FACT_KINDS.map((item) => (
            <option key={item} value={item}>{item.replace("_", " ")}</option>
          ))}
        </select>
      </label>
      <label className="inline">
        <input type="checkbox" checked={attest} onChange={(event) => setAttest(event.target.checked)} /> I attest this is accurate.
      </label>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="row">
        <button type="submit" disabled={busy || !attest}>Save draft statement</button>
        <button type="button" className="quiet" onClick={props.onCancel}>Cancel</button>
      </div>
    </form>
  );
}
