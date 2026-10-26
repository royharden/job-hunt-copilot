import { CAPABILITIES } from "../demo/capabilities.ts";
import pilotReport from "../../results/results.md?raw";

// The recorded report is the single source for displayed measurements and limitations.
export function ResultsScreen(props: { mode: "demo" | "remote" }) {
  return (
    <div className="stack">
      <section className="panel stack" aria-labelledby="results-heading">
        <h2 id="results-heading">Results</h2>
        <p className="notice">
          Synthetic pilot edition 1 was run locally on 2026-10-26: 60 guard proposals and 60 replies.
          These small synthetic sets do not establish general accuracy. Coverage elsewhere is arithmetic over your confirmations.
        </p>
        <p className="muted">
          The report below records the tested revision, denominators, separate development and heldout results, and residual failures.
        </p>
        <details>
          <summary>Recorded pilot results and limitations</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{pilotReport}</pre>
        </details>
      </section>
      <section className="panel stack" aria-labelledby="caps-heading">
        <h2 id="caps-heading">What runs where</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Operation</th>
              <th scope="col">This mode</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>
                  <span className={`tag cap-${props.mode === "demo" ? item.demo : item.live}`}>{props.mode === "demo" ? item.demo : item.live}</span>
                </td>
                <td className="muted">{item.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
