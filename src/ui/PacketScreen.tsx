import { useState } from "react";
import { acceptFallback, assemblePacket, moveLine, removeLine, replaceLineText } from "../../supabase/functions/_shared/provenance/draft.ts";
import { FABRICATIONS } from "../../supabase/functions/_shared/provenance/fixtures.ts";
import { proposeEvidence } from "../../supabase/functions/_shared/provenance/match.ts";
import { packetCoverage } from "../../supabase/functions/_shared/provenance/score.ts";
import type { PacketLine, PostingVersion, RenderedLine } from "../../supabase/functions/_shared/provenance/types.ts";
import { findFactVersion } from "../../supabase/functions/_shared/provenance/versions.ts";
import { labelFor } from "../demo/capabilities.ts";
import { newId } from "../lib/demoStore.ts";
import { copyText, errorMessage } from "../lib/format.ts";
import { packetStatus } from "../lib/packetStatus.ts";
import type { ApproveResult, HuntRepository, Workspace } from "../lib/repository.ts";
import { latestMapping, latestRequirementSet } from "../lib/workspace.ts";
import { EmptyFactForm } from "./EmptyFactForm.tsx";
import { CoverageView } from "./CoverageView.tsx";

interface Props {
  repo: HuntRepository;
  workspace: Workspace;
  onChanged: () => Promise<void>;
  applicationId: string;
  posting: PostingVersion;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}

export function PacketScreen(props: Props) {
  const { workspace, posting } = props;
  const status = packetStatus(workspace, props.applicationId);
  const set = latestRequirementSet(workspace, posting.versionId);
  const mapping = latestMapping(workspace, posting.versionId);
  const [inspect, setInspect] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ lineId: string; text: string } | null>(null);
  const [gapForm, setGapForm] = useState<string | null>(null);
  const [exported, setExported] = useState<ApproveResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  if (!status || !set || !mapping) return null;
  const { packet, gate } = status;

  // Every edit is a new revision; the current revision is never changed in place.
  const saveLines = (lines: PacketLine[]) =>
    props.run(() => props.repo.savePacketRevision(props.applicationId, packet?.packetId ?? null, packet?.revision ?? null, lines));

  const assemble = () => saveLines(assemblePacket(mapping.evidence, workspace.profile, posting, newId));

  async function approve() {
    if (!packet || !status?.binding) return;
    setApproveError(null);
    try {
      const result = await props.repo.approvePacket(packet.packetId, packet.revision, status.binding.renderedSha256, newId());
      setExported(result);
    } catch (caught) {
      setApproveError(errorMessage(caught));
    }
    await props.onChanged();
  }

  const availableFabrications = FABRICATIONS.filter((item) => item.cites.every((ref) => findFactVersion(workspace.profile, ref)));
  const coverage = gate ? packetCoverage(set.requirements, proposeEvidence(set.requirements, workspace.profile, mapping.evidence), gate.lines) : null;
  const approvalLabel = labelFor("packet.approve", props.repo.mode);
  const exportReady = exported && status.approvalCurrent && exported.approval.bindingSha256 === status.approval?.bindingSha256;

  return (
    <section className="panel stack" aria-labelledby="packet-heading">
      <h2 id="packet-heading">3. Packet</h2>
      <p className="muted">
        Assembly selects your approved sentences for confirmed requirements and adds fixed templates. No wording is generated. Only
        verified lines can be approved and exported.
      </p>
      <div className="row">
        <button type="button" disabled={props.busy} onClick={() => void assemble()}>
          {packet ? "Re-assemble as a new revision" : "Assemble packet"}
        </button>
        {packet ? <span className="muted">Revision {packet.revision} ({packet.lines.length} lines)</span> : null}
      </div>
      {packet && gate ? (
        <>
          <ol className="list packet">
            {gate.lines.map((line, index) => (
              <li key={line.lineId} className={`card stack grade-${line.grade}`}>
                <LineView line={line} />
                <div className="row">
                  <button type="button" className="quiet" aria-label="Move up" disabled={props.busy || index === 0}
                    onClick={() => void saveLines(moveLine(packet.lines, line.lineId, -1))}>Up</button>
                  <button type="button" className="quiet" aria-label="Move down" disabled={props.busy || index === gate.lines.length - 1}
                    onClick={() => void saveLines(moveLine(packet.lines, line.lineId, 1))}>Down</button>
                  <button type="button" className="quiet" disabled={props.busy} onClick={() => void saveLines(removeLine(packet.lines, line.lineId))}>
                    Remove
                  </button>
                  <button type="button" className="quiet" onClick={() => setEditing({ lineId: line.lineId, text: line.proposalText })}>Edit</button>
                  <button type="button" className="quiet" aria-expanded={inspect === line.lineId}
                    onClick={() => setInspect(inspect === line.lineId ? null : line.lineId)}>Inspect</button>
                  {line.fallback ? (
                    <button type="button" disabled={props.busy}
                      onClick={() => void saveLines(acceptFallback(packet.lines, line.lineId, line.fallback!))}>
                      {line.fallback.fact ? "Use the original sentence (new revision)" : "Reset template (new revision)"}
                    </button>
                  ) : null}
                  {line.grade !== "verified" ? (
                    <button type="button" className="quiet" onClick={() => setGapForm(line.lineId)}>Add a true statement instead</button>
                  ) : null}
                </div>
                {editing?.lineId === line.lineId ? (
                  <div className="stack">
                    <label>
                      Proposed wording (saved as an unchecked proposal; the MVP exports approved sentences only)
                      <textarea value={editing.text} maxLength={500} onChange={(event) => setEditing({ ...editing, text: event.target.value })} />
                    </label>
                    <div className="row">
                      <button type="button" disabled={props.busy}
                        onClick={() => void saveLines(replaceLineText(packet.lines, line.lineId, editing.text)).then((ok) => ok && setEditing(null))}>
                        Save as new revision
                      </button>
                      <button type="button" className="quiet" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  </div>
                ) : null}
                {inspect === line.lineId ? <Inspector line={line} workspace={workspace} requirementClauses={set.requirements} /> : null}
                {gapForm === line.lineId ? (
                  <EmptyFactForm repo={props.repo} onDone={() => { setGapForm(null); void props.onChanged(); }} onCancel={() => setGapForm(null)} />
                ) : null}
              </li>
            ))}
          </ol>
          <p className="muted">
            verified {gate.counts.verified}, unchecked {gate.counts.unchecked}, reverted {gate.counts.reverted}, blocked {gate.counts.blocked}
          </p>
          {coverage ? <CoverageView title="Packet coverage (verified lines only)" coverage={coverage} /> : null}

          {availableFabrications.length > 0 ? (
            <details className="card">
              <summary>Fabrication lab: insert a labelled fabricated line</summary>
              <p className="muted">
                Each button adds a deliberately false line citing a real statement, as a new revision, so you can watch the guard block
                it and offer the original sentence. These are synthetic test lines, not suggestions.
              </p>
              <div className="row">
                {availableFabrications.map((fabrication) => (
                  <button
                    key={fabrication.id}
                    type="button"
                    className="quiet"
                    disabled={props.busy}
                    title={fabrication.whatBugThisCatches}
                    onClick={() =>
                      void saveLines([
                        ...packet.lines.slice(0, -1),
                        {
                          lineId: newId(),
                          section: "experience",
                          kind: "fact",
                          fact: fabrication.cites[0],
                          proposalText: fabrication.text,
                          requirementIds: [],
                        },
                        ...packet.lines.slice(-1),
                      ])
                    }
                  >
                    {fabrication.label}
                  </button>
                ))}
              </div>
            </details>
          ) : null}

          <div className="card stack">
            <strong>Approval</strong>
            {status.approval ? (
              status.approvalCurrent ? (
                <p className="notice">
                  Approved {status.approval.source === "demo_local" ? "locally in the demo (no server receipt)" : "by the server"} for revision{" "}
                  {status.approval.revision}. Approval means ready to send yourself; it does not mark the application as applied.
                </p>
              ) : (
                <p className="notice">
                  An earlier approval exists but is no longer current (changed: {status.staleBecause.join(", ") || "inputs"}). It stays in
                  history and does not authorize export.
                </p>
              )
            ) : (
              <p className="muted">Not approved.</p>
            )}
            {!gate.approvable ? <p className="muted">{gate.refusal}</p> : null}
            <div className="row">
              <button type="button" disabled={props.busy || !gate.approvable} onClick={() => void approve()}>
                {status.approvalCurrent ? "Re-validate and export" : "Validate, approve and export"}
              </button>
              <span className="tag">{approvalLabel}</span>
            </div>
            {approveError ? <p className="error" role="alert">{approveError}</p> : null}
            {exportReady ? (
              <div className="stack">
                <div className="row">
                  <button type="button" className="quiet"
                    onClick={() => void copyText(exported.export.plainText).then((ok) => setCopied(ok ? "Plain text copied." : "Copy failed; select the text below."))}>
                    Copy plain text
                  </button>
                  <button type="button" className="quiet"
                    onClick={() => void copyText(exported.export.markdown).then((ok) => setCopied(ok ? "Markdown copied." : "Copy failed; select the text below."))}>
                    Copy Markdown
                  </button>
                  {copied ? <span className="muted" role="status">{copied}</span> : null}
                </div>
                <pre className="export">{exported.export.plainText}</pre>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function LineView({ line }: { line: RenderedLine }) {
  return (
    <div className="stack">
      <div>
        <span className={`tag tag-${line.grade}`}>{line.grade}</span> <span className="tag">{line.section}</span>{" "}
        {line.grade === "verified" ? line.text : <span className="proposal">{line.proposalText}</span>}
      </div>
      {line.findings.length > 0 ? (
        <ul className="warnings">
          {line.findings.map((finding, index) => (
            <li key={index}>
              <code>{finding.code}</code> {finding.detail}
            </li>
          ))}
        </ul>
      ) : null}
      {line.fallback ? <p className="muted">Offered replacement: {line.fallback.text}</p> : null}
    </div>
  );
}

function Inspector(props: { line: RenderedLine; workspace: Workspace; requirementClauses: Array<{ requirementId: string; clause: string }> }) {
  const { line } = props;
  return (
    <div className="inspector stack">
      <p>
        <strong>Exact output:</strong> {line.grade === "verified" ? <q>{line.text}</q> : "none (not verified)"}
      </p>
      <p>
        <strong>Proposal:</strong> <q>{line.proposalText}</q>
      </p>
      {line.sources.length === 0 ? <p className="muted">No career source (fixed closing).</p> : null}
      {line.sources.map((source) => (
        <p key={`${source.kind}-${source.versionId}`}>
          <strong>{source.kind} source</strong> {source.id.slice(0, 8)} version {source.versionId.slice(0, 8)}:{" "}
          <q className="source-quote">{source.quote}</q>
          {source.kind === "posting" ? <span className="muted"> (target details from the posting, not career evidence)</span> : null}
        </p>
      ))}
      {line.requirementIds.length > 0 ? (
        <p>
          <strong>Requirements:</strong>{" "}
          {line.requirementIds
            .map((id) => props.requirementClauses.find((item) => item.requirementId === id)?.clause ?? id)
            .join("; ")}
        </p>
      ) : null}
    </div>
  );
}
