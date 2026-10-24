import { useEffect, useMemo, useState, type FormEvent } from "react";
import { proposeSplit, requirementFlags } from "../../supabase/functions/_shared/provenance/extract.ts";
import { SAMPLE_JOB_POSTING } from "../../supabase/functions/_shared/provenance/fixtures.ts";
import { confirmationWarnings, proposeEvidence } from "../../supabase/functions/_shared/provenance/match.ts";
import { profileCoverage } from "../../supabase/functions/_shared/provenance/score.ts";
import type { FactRef, PostingVersion, RequirementEvidence, RequirementVersion } from "../../supabase/functions/_shared/provenance/types.ts";
import { currentFacts } from "../../supabase/functions/_shared/provenance/versions.ts";
import { errorMessage } from "../lib/format.ts";
import type { HuntRepository, RequirementEdit, Workspace } from "../lib/repository.ts";
import { latestMapping, latestPostingVersion, latestRequirementSet } from "../lib/workspace.ts";
import { CoverageView } from "./CoverageView.tsx";
import { EmptyFactForm } from "./EmptyFactForm.tsx";
import { PacketScreen } from "./PacketScreen.tsx";

interface Props {
  repo: HuntRepository;
  workspace: Workspace;
  onChanged: () => Promise<void>;
  selectedApplicationId: string | null;
  onSelect: (applicationId: string | null) => void;
}

export function PostingScreen(props: Props) {
  const { workspace } = props;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await props.onChanged();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      await props.onChanged();
      return false;
    } finally {
      setBusy(false);
    }
  }

  const selected = workspace.applications.find((app) => app.applicationId === props.selectedApplicationId) ?? null;
  const posting = selected ? latestPostingVersion(workspace, selected.postingId) ?? null : null;

  return (
    <div className="stack">
      {error ? <p className="error" role="alert">{error}</p> : null}
      <section className="panel stack" aria-labelledby="postings-heading">
        <h2 id="postings-heading">Postings</h2>
        <ul className="list">
          {workspace.applications.map((app) => {
            const version = latestPostingVersion(workspace, app.postingId);
            return (
              <li key={app.applicationId} className="row">
                <button
                  type="button"
                  className={app.applicationId === props.selectedApplicationId ? "" : "quiet"}
                  onClick={() => props.onSelect(app.applicationId)}
                >
                  {version ? `${version.title} at ${version.organisation}` : "(missing posting)"}
                </button>
                <span className="tag">{app.stage}</span>
              </li>
            );
          })}
        </ul>
        <NewPostingForm busy={busy} onCreate={(input) => run(async () => props.onSelect((await props.repo.createPosting(input)).applicationId))} />
      </section>
      {selected && posting ? (
        <>
          <RequirementReview key={`req-${posting.versionId}`} {...props} posting={posting} busy={busy} run={run} />
          <EvidenceReview {...props} posting={posting} busy={busy} run={run} />
          <PacketScreen {...props} applicationId={selected.applicationId} posting={posting} busy={busy} run={run} />
        </>
      ) : null}
    </div>
  );
}

function NewPostingForm(props: { busy: boolean; onCreate: (input: { organisation: string; title: string; body: string; url: string | null }) => Promise<boolean> }) {
  const [organisation, setOrganisation] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    void props.onCreate({ organisation, title, body, url: url || null }).then((ok) => {
      if (!ok) return;
      setOrganisation("");
      setTitle("");
      setBody("");
      setUrl("");
    });
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h3>Paste a job posting</h3>
      <p className="muted">Paste the text yourself. Nothing is fetched from the URL; it is kept as a note only.</p>
      <div className="row">
        <label>
          Organisation
          <input required value={organisation} maxLength={200} onChange={(event) => setOrganisation(event.target.value)} />
        </label>
        <label>
          Role title
          <input required value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          URL (text only)
          <input value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
      </div>
      <label>
        Posting text
        <textarea required value={body} maxLength={20000} onChange={(event) => setBody(event.target.value)} />
      </label>
      <div className="row">
        <button type="submit" disabled={props.busy}>Save posting</button>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            setOrganisation("Northwind Traders");
            setTitle("Senior Frontend Engineer");
            setBody(SAMPLE_JOB_POSTING);
          }}
        >
          Paste sample job (synthetic)
        </button>
      </div>
    </form>
  );
}

interface SectionProps extends Props {
  posting: PostingVersion;
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}

function toEdits(requirements: RequirementVersion[]): RequirementEdit[] {
  return requirements.map((item) => ({
    requirementId: item.requirementId,
    quote: item.quote,
    clause: item.clause,
    priority: item.priority,
    flags: item.flags,
    reviewed: item.reviewed,
    removed: item.removed,
  }));
}

function RequirementReview(props: SectionProps) {
  const set = latestRequirementSet(props.workspace, props.posting.versionId);
  const [edits, setEdits] = useState<RequirementEdit[]>(() => toEdits(set?.requirements ?? []));
  const [splitting, setSplitting] = useState<number | null>(null);
  const [splitText, setSplitText] = useState("");

  useEffect(() => {
    setEdits(toEdits(set?.requirements ?? []));
  }, [set?.revision]);

  if (!set) return null;
  const dirty = JSON.stringify(edits) !== JSON.stringify(toEdits(set.requirements));
  const update = (index: number, patch: Partial<RequirementEdit>) =>
    setEdits(edits.map((edit, at) => (at === index ? { ...edit, ...patch } : edit)));

  function applySplit(index: number) {
    const parts = splitText.split("|").map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return;
    const original = edits[index];
    const replacement: RequirementEdit[] = parts.map((clause, at) => ({
      requirementId: at === 0 ? original.requirementId : null,
      quote: original.quote,
      clause,
      priority: original.priority,
      flags: requirementFlags(clause, original.flags.includes("benefit")),
      reviewed: false,
      removed: false,
    }));
    setEdits([...edits.slice(0, index), ...replacement, ...edits.slice(index + 1)]);
    setSplitting(null);
  }

  const unreviewed = edits.filter((edit) => !edit.removed && !edit.reviewed).length;

  return (
    <section className="panel stack" aria-labelledby="review-heading">
      <h2 id="review-heading">1. Review requirements: {props.posting.title} at {props.posting.organisation}</h2>
      <p className="muted">
        These are rule-based proposals. Original posting text is shown on the left and is never changed; your edited clause is what gets
        matched. Remove benefits and other non-requirements, split mixed clauses, set priority, then mark each as reviewed.
        Requirement set revision {set.revision}.
      </p>
      {edits.length === 0 ? (
        <p className="notice">No requirement lines found. Use bullet lines or lines that say required, experience or qualifications, or add one below.</p>
      ) : null}
      <table>
        <thead>
          <tr>
            <th scope="col">Original text</th>
            <th scope="col">Clause you review</th>
            <th scope="col">Priority</th>
            <th scope="col">Flags</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {edits.map((edit, index) => (
            <tr key={`${edit.requirementId ?? "new"}-${index}`} className={edit.removed ? "removed" : ""}>
              <td className="quote">{edit.quote ? <q>{edit.quote.text}</q> : <span className="muted">(added by you)</span>}</td>
              <td>
                {splitting === index ? (
                  <div className="stack">
                    <label>
                      Parts separated by |
                      <input value={splitText} onChange={(event) => setSplitText(event.target.value)} />
                    </label>
                    <div className="row">
                      <button type="button" onClick={() => applySplit(index)}>Split</button>
                      <button type="button" className="quiet" onClick={() => setSplitting(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <input
                    aria-label="Requirement clause"
                    value={edit.clause}
                    disabled={edit.removed}
                    onChange={(event) => update(index, { clause: event.target.value, reviewed: false })}
                  />
                )}
              </td>
              <td>
                <select
                  aria-label="Priority"
                  value={edit.priority}
                  disabled={edit.removed}
                  onChange={(event) => update(index, { priority: event.target.value as RequirementEdit["priority"] })}
                >
                  <option value="required">required</option>
                  <option value="preferred">preferred</option>
                </select>
              </td>
              <td>
                {edit.flags.map((flag) => (
                  <span key={flag} className={`tag ${flag === "benefit" || flag === "mixed" ? "tag-unchecked" : ""}`}>{flag}</span>
                ))}
              </td>
              <td>
                <div className="row">
                  {edit.removed ? (
                    <button type="button" className="quiet" onClick={() => update(index, { removed: false, reviewed: false })}>Restore</button>
                  ) : (
                    <>
                      <label className="inline">
                        <input type="checkbox" checked={edit.reviewed} onChange={(event) => update(index, { reviewed: event.target.checked })} /> Reviewed
                      </label>
                      <button type="button" className="quiet" onClick={() => update(index, { removed: true })}>Remove</button>
                      <button
                        type="button"
                        className="quiet"
                        onClick={() => {
                          setSplitting(index);
                          setSplitText(proposeSplit(edit.clause).join(" | "));
                        }}
                      >
                        Split
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button
          type="button"
          className="quiet"
          onClick={() =>
            setEdits([
              ...edits,
              { requirementId: null, quote: null, clause: "New requirement", priority: "required", flags: [], reviewed: false, removed: false },
            ])
          }
        >
          Add a clause
        </button>
        <button type="button" className="quiet" onClick={() => setEdits(edits.map((edit) => (edit.removed ? edit : { ...edit, reviewed: true })))}>
          Mark all retained as reviewed
        </button>
        <button
          type="button"
          disabled={props.busy || !dirty}
          onClick={() => void props.run(() => props.repo.saveRequirements(props.posting.versionId, set.revision, edits))}
        >
          Save review
        </button>
        <span className="muted">{unreviewed} retained clause(s) not reviewed.</span>
      </div>
    </section>
  );
}

function EvidenceReview(props: SectionProps) {
  const { workspace, posting } = props;
  const set = latestRequirementSet(workspace, posting.versionId);
  const mapping = latestMapping(workspace, posting.versionId);
  const facts = useMemo(() => currentFacts(workspace.profile), [workspace.profile]);
  const [gapFormFor, setGapFormFor] = useState<string | null>(null);
  if (!set || !mapping) return null;
  // Show coverage against the CURRENT profile: confirmations citing a since-withdrawn or superseded
  // statement drop out here immediately, before the refreshed mapping is saved.
  const liveEvidence = proposeEvidence(set.requirements, workspace.profile, mapping.evidence);
  const coverage = profileCoverage(set.requirements, liveEvidence);
  const staleConfirmations = mapping.evidence.filter((item) => item.confirmed).length - liveEvidence.filter((item) => item.confirmed).length;
  const retained = set.requirements.filter((item) => !item.removed);

  return (
    <section className="panel stack" aria-labelledby="evidence-heading">
      <h2 id="evidence-heading">2. Confirm evidence</h2>
      <p className="muted">
        Proposals come from exact phrases, approved aliases and word overlap. None of them counts until you confirm it. A match never proves
        years, credentials, proficiency or polarity. Reviewed gaps are a valid answer. Mapping revision {mapping.revision}.
      </p>
      <div className="row">
        <button type="button" className="quiet" disabled={props.busy} onClick={() => void props.run(() => props.repo.refreshProposals(posting.versionId))}>
          Refresh proposals from current profile
        </button>
      </div>
      {staleConfirmations > 0 ? (
        <p className="notice">
          {staleConfirmations} confirmation(s) cite a statement that is no longer current and no longer count. Refresh proposals to save that,
          then confirm again.
        </p>
      ) : null}
      <CoverageView title="Profile evidence coverage" coverage={coverage} />
      <ul className="list">
        {retained.map((requirement) => {
          // Show the live view so a confirmation citing a no-longer-current statement is not displayed as counted.
          const item = liveEvidence.find((entry) => entry.requirementId === requirement.requirementId);
          return (
            <li key={requirement.requirementId} className="card stack">
              <EvidenceRow
                {...props}
                requirement={requirement}
                evidence={item ?? null}
                mappingRevision={mapping.revision}
                facts={facts}
                onAddEvidence={() => setGapFormFor(requirement.requirementId)}
              />
              {gapFormFor === requirement.requirementId ? (
                <EmptyFactForm repo={props.repo} onDone={() => { setGapFormFor(null); void props.onChanged(); }} onCancel={() => setGapFormFor(null)} />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function EvidenceRow(
  props: SectionProps & {
    requirement: RequirementVersion;
    evidence: RequirementEvidence | null;
    mappingRevision: number;
    facts: ReturnType<typeof currentFacts>;
    onAddEvidence: () => void;
  },
) {
  const { requirement, evidence } = props;
  const [chosen, setChosen] = useState<string[]>(() => evidence?.confirmed?.facts.map((ref) => ref.versionId) ?? []);
  const warnings = confirmationWarnings(requirement);
  const confirmed = evidence?.confirmed ?? null;
  const refs = (): FactRef[] =>
    chosen
      .map((versionId) => props.facts.find((fact) => fact.versionId === versionId))
      .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact))
      .map((fact) => ({ factId: fact.factId, versionId: fact.versionId }));
  const decide = (tier: "direct" | "partial" | "gap" | null) =>
    props.run(() =>
      props.repo.confirmEvidence(
        props.posting.versionId,
        props.mappingRevision,
        requirement.requirementId,
        tier === null ? null : { tier, facts: tier === "gap" ? [] : refs(), reason: tier === "gap" ? "Reviewed: no supporting statement." : "Confirmed by you." },
      ),
    );

  return (
    <div className="stack">
      <div>
        <strong>{requirement.clause}</strong> <span className="tag">{requirement.priority}</span>{" "}
        <span className={`tag tag-${evidence?.proposedTier ?? "gap"}`}>proposed: {evidence?.proposedTier ?? "gap"}</span>{" "}
        {confirmed ? <span className={`tag tag-${confirmed.tier}`}>confirmed: {confirmed.tier}</span> : <span className="tag tag-unchecked">not confirmed</span>}
        {!requirement.reviewed ? <span className="tag tag-unchecked">not reviewed</span> : null}
      </div>
      {warnings.length > 0 ? (
        <ul className="warnings">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <fieldset className="stack">
        <legend className="muted">Supporting statements (proposals first)</legend>
        {(evidence?.proposals ?? []).map((proposal) => {
          const fact = props.facts.find((item) => item.versionId === proposal.fact.versionId);
          if (!fact) return null;
          return (
            <label key={proposal.fact.versionId} className="inline">
              <input
                type="checkbox"
                checked={chosen.includes(fact.versionId)}
                onChange={(event) =>
                  setChosen(event.target.checked ? [...chosen, fact.versionId] : chosen.filter((id) => id !== fact.versionId))
                }
              />{" "}
              <span className={`tag tag-${proposal.tier}`}>{proposal.tier}</span> {fact.text} <span className="muted">({proposal.reason})</span>
            </label>
          );
        })}
        <label>
          Other current statement
          <select
            value=""
            onChange={(event) => {
              if (event.target.value && !chosen.includes(event.target.value)) setChosen([...chosen, event.target.value]);
            }}
          >
            <option value="">Choose to add</option>
            {props.facts.map((fact) => (
              <option key={fact.versionId} value={fact.versionId}>{fact.text.slice(0, 90)}</option>
            ))}
          </select>
        </label>
        {chosen.length > 0 ? <p className="muted">Selected: {chosen.length} statement(s).</p> : null}
      </fieldset>
      <div className="row">
        <button type="button" disabled={props.busy || !requirement.reviewed || chosen.length === 0} onClick={() => void decide("direct")}>
          Confirm direct
        </button>
        <button type="button" className="quiet" disabled={props.busy || !requirement.reviewed || chosen.length === 0} onClick={() => void decide("partial")}>
          Confirm partial
        </button>
        <button type="button" className="quiet" disabled={props.busy || !requirement.reviewed} onClick={() => void decide("gap")}>
          Mark reviewed gap
        </button>
        {confirmed ? (
          <button type="button" className="quiet" disabled={props.busy} onClick={() => void decide(null)}>
            Clear confirmation
          </button>
        ) : null}
        {confirmed?.tier === "gap" || (!confirmed && (evidence?.proposals.length ?? 0) === 0) ? (
          <button type="button" className="quiet" onClick={props.onAddEvidence}>Add a statement for this gap</button>
        ) : null}
      </div>
    </div>
  );
}
