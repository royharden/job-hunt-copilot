import { CAPABILITIES } from "../demo/capabilities.ts";

// Journey step 8: results stay "not yet measured" until a recorded evaluation run exists. No rate is shown from
// fixtures that have not been executed.
export function ResultsScreen(props: { mode: "demo" | "remote" }) {
  return (
    <div className="stack">
      <section className="panel stack" aria-labelledby="results-heading">
        <h2 id="results-heading">Results</h2>
        <p className="notice">
          Not yet measured. The guard and reply-rule pilot sets are authored but have not been run, so there are no accuracy, block or
          review rates to report. Coverage percentages elsewhere are arithmetic over your confirmations, not measured quality.
        </p>
        <p className="muted">
          When an authorized run records output in results/results.md, this page should show its counts, denominators and edition. It never
          shows rates for categories that were not run.
        </p>
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
