import { useState, type FormEvent } from "react";
import { FACT_KINDS } from "../../supabase/functions/_shared/provenance/types.ts";
import type { FactKind } from "../../supabase/functions/_shared/provenance/types.ts";
import { errorMessage } from "../lib/format.ts";
import type { FactRecord, HuntRepository } from "../lib/repository.ts";

export function ProfileScreen(props: {
  repo: HuntRepository;
  facts: FactRecord[];
  onChanged: () => Promise<void>;
}) {
  const [kind, setKind] = useState<FactKind>("accomplishment");
  const [surface, setSurface] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await props.onChanged();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function addFact(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await props.repo.createFact({ kind, surface, text });
      setSurface("");
      setText("");
    });
  }

  return (
    <div className="stack">
      <section className="panel stack">
        <h2>Approved facts</h2>
        <p className="muted">
          A surface is the claim the gate looks for, such as Contoso, Engineer, or Python. The sentence is the only wording a local draft is allowed to use.
        </p>
        <div className="row">
          <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => props.repo.loadSampleFacts())}>
            Load synthetic example
          </button>
          <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => props.repo.removeSampleFacts())}>
            Remove synthetic example
          </button>
          {props.repo.mode === "demo" ? (
            confirmClear ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  localStorage.removeItem("job-hunt-copilot-demo-v1");
                  window.location.reload();
                }}
              >
                Confirm clear
              </button>
            ) : (
              <button type="button" className="quiet" onClick={() => setConfirmClear(true)}>Clear demo data</button>
            )
          ) : null}
        </div>
        {error ? <p className="error">{error}</p> : null}
        {props.facts.length === 0 ? <p className="muted">No facts yet.</p> : null}
        <ul className="list">
          {props.facts.map((fact) => (
            <li key={fact.id} className="card">
              <div className="row">
                <span className="tag">{fact.kind}</span>
                <strong>{fact.surface}</strong>
                <span className="muted">{fact.id.slice(0, 8)}</span>
                <button type="button" className="quiet" disabled={busy} onClick={() => void run(() => props.repo.deleteFact(fact.id))}>
                  Delete
                </button>
              </div>
              <p>{fact.text}</p>
            </li>
          ))}
        </ul>
      </section>
      <form className="panel stack" onSubmit={addFact}>
        <h2>Add a fact</h2>
        <label>
          Kind
          <select value={kind} onChange={(event) => setKind(event.target.value as FactKind)}>
            {FACT_KINDS.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Surface
          <input value={surface} onChange={(event) => setSurface(event.target.value)} required minLength={2} maxLength={200} />
        </label>
        <label>
          Approved sentence
          <textarea value={text} onChange={(event) => setText(event.target.value)} required maxLength={2000} />
        </label>
        <button type="submit" disabled={busy}>Save fact</button>
      </form>
    </div>
  );
}
