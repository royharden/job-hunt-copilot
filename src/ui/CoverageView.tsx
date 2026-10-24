import type { Coverage } from "../../supabase/functions/_shared/provenance/score.ts";
import { percentText } from "../lib/format.ts";

export function CoverageView(props: { title: string; coverage: Coverage }) {
  const { coverage } = props;
  return (
    <div className="card stack">
      <strong>{props.title}</strong>
      <p>
        {coverage.percent === null ? (
          <>Percentage withheld: {coverage.withheldReason}</>
        ) : (
          <>
            {percentText(coverage.percent)} = 100 x {coverage.numerator} / {coverage.denominator}
          </>
        )}
      </p>
      <p className="muted">
        direct {coverage.counts.direct}, partial {coverage.counts.partial}, gap {coverage.counts.gap}, unconfirmed {coverage.counts.unconfirmed},
        unreviewed {coverage.counts.unreviewed}
        {coverage.counts.not_in_packet > 0 ? `, not in packet ${coverage.counts.not_in_packet}` : ""}. Formula: {coverage.formula}. This is
        not a hiring probability or an ATS score.
      </p>
    </div>
  );
}
