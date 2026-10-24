import { useState } from "react";
import { stageAfterReply } from "../../supabase/functions/_shared/provenance/board.ts";
import { SAMPLE_REPLIES } from "../../supabase/functions/_shared/provenance/fixtures.ts";
import { REPLY_LABELS, STAGES, type Application, type Reply, type ReplyLabel, type Stage } from "../../supabase/functions/_shared/provenance/types.ts";
import { labelFor } from "../demo/capabilities.ts";
import { newId } from "../lib/demoStore.ts";
import { errorMessage, shortDate } from "../lib/format.ts";
import { packetStatus } from "../lib/packetStatus.ts";
import type { HuntRepository, Workspace } from "../lib/repository.ts";
import { latestPostingVersion } from "../lib/workspace.ts";

interface Props {
  repo: HuntRepository;
  workspace: Workspace;
  onChanged: () => Promise<void>;
  onOpenPacket: (applicationId: string) => void;
}

const COLUMNS = STAGES.filter((stage) => stage !== "withdrawn");

function readiness(workspace: Workspace, applicationId: string): { text: string; tone: string } {
  const status = packetStatus(workspace, applicationId);
  if (!status?.packet) return { text: "no packet", tone: "" };
  if (status.approvalCurrent) return { text: "packet ready", tone: "tag-verified" };
  if (status.approval) return { text: "approval stale", tone: "tag-unchecked" };
  return { text: "packet not approved", tone: "" };
}

export function BoardScreen(props: Props) {
  const { workspace } = props;
  const [selected, setSelected] = useState<string | null>(null);
  const app = workspace.applications.find((item) => item.applicationId === selected) ?? null;

  const card = (item: Application) => {
    const posting = latestPostingVersion(workspace, item.postingId);
    const ready = readiness(workspace, item.applicationId);
    return (
      <li key={item.applicationId}>
        <button
          type="button"
          className={`card board-card ${item.applicationId === selected ? "selected" : ""}`}
          onClick={() => setSelected(item.applicationId)}
        >
          <strong>{posting?.title ?? "(posting)"}</strong>
          <span className="muted">{posting?.organisation}</span>
          <span className={`tag ${ready.tone}`}>{ready.text}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="stack">
      <section className="panel" aria-labelledby="board-heading">
        <h2 id="board-heading">Board</h2>
        <p className="muted">
          Stages change only when you confirm them. Approval means a packet is ready; you record "applied" yourself after you submit.
        </p>
        <div className="board">
          {COLUMNS.map((stage) => (
            <div key={stage} className="column">
              <h3>{stage}</h3>
              <ul className="list">{workspace.applications.filter((item) => item.stage === stage).map(card)}</ul>
            </div>
          ))}
        </div>
        <h3>withdrawn</h3>
        <ul className="list row">{workspace.applications.filter((item) => item.stage === "withdrawn").map(card)}</ul>
      </section>
      {app ? <ApplicationDetail key={app.applicationId} {...props} app={app} /> : null}
    </div>
  );
}

function ApplicationDetail(props: Props & { app: Application }) {
  const { workspace, app } = props;
  const posting = latestPostingVersion(workspace, app.postingId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualStage, setManualStage] = useState<Stage>(app.stage);
  const [manualConfirm, setManualConfirm] = useState(false);
  const [notes, setNotes] = useState(app.notes);
  const [body, setBody] = useState("");
  const events = workspace.events
    .filter((event) => event.applicationId === app.applicationId)
    .sort((left, right) => left.revision - right.revision);
  const replies = workspace.replies.filter((reply) => reply.applicationId === app.applicationId);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      await props.onChanged();
    }
  }

  async function change(toStage: Stage, reply: Reply | null, label: ReplyLabel | null) {
    await run(async () => {
      const result = await props.repo.applyStageChange({
        applicationId: app.applicationId,
        expectedRevision: app.revision,
        toStage,
        replyId: reply?.replyId ?? null,
        chosenLabel: label,
        requestId: newId(),
      });
      if (!result.ok) throw new Error(result.message);
    });
  }

  return (
    <section className="panel stack" aria-labelledby="detail-heading">
      <h2 id="detail-heading">
        {posting?.title} at {posting?.organisation}: <span className="tag">{app.stage}</span>
      </h2>
      <p className="muted">Board revision {app.revision}. Capability: {labelFor("board.stage", props.repo.mode)}.</p>
      {error ? <p className="error" role="alert">{error} Reload happened; check the current stage and confirm again if still right.</p> : null}
      <div className="row">
        <button type="button" className="quiet" onClick={() => props.onOpenPacket(app.applicationId)}>Open packet</button>
      </div>

      <div className="card stack">
        <strong>Record a real-world change</strong>
        <div className="row">
          <label>
            Stage
            <select value={manualStage} onChange={(event) => setManualStage(event.target.value as Stage)}>
              {STAGES.map((stage) => (
                <option key={stage} value={stage}>{stage}</option>
              ))}
            </select>
          </label>
          <label className="inline">
            <input type="checkbox" checked={manualConfirm} onChange={(event) => setManualConfirm(event.target.checked)} /> This really happened
          </label>
          <button
            type="button"
            disabled={busy || !manualConfirm || manualStage === app.stage}
            onClick={() => void change(manualStage, null, null).then(() => setManualConfirm(false))}
          >
            Record move
          </button>
        </div>
      </div>

      <div className="card stack">
        <strong>Paste a reply</strong>
        <p className="muted">Rules suggest a label with the phrases they matched. Nothing is read from your inbox and nothing is sent.</p>
        <textarea aria-label="Reply text" value={body} maxLength={20000} onChange={(event) => setBody(event.target.value)} />
        <div className="row">
          <button type="button" disabled={busy || body.trim().length === 0}
            onClick={() => void run(async () => { await props.repo.addReply(app.applicationId, body); setBody(""); })}>
            Check reply
          </button>
          {props.repo.mode === "demo" ? (
            <>
              <button type="button" className="quiet" onClick={() => setBody(SAMPLE_REPLIES.vague)}>Sample: vague</button>
              <button type="button" className="quiet" onClick={() => setBody(SAMPLE_REPLIES.quoted)}>Sample: quoted offer</button>
              <button type="button" className="quiet" onClick={() => setBody(SAMPLE_REPLIES.rejection)}>Sample: clear rejection</button>
            </>
          ) : null}
        </div>
      </div>

      <ul className="list">
        {replies.map((reply) => (
          <ReplyCard key={reply.replyId} reply={reply} stage={app.stage} busy={busy} onConfirm={(label) => change(stageAfterReply(app.stage, label), reply, label)} />
        ))}
      </ul>

      <div className="card stack">
        <strong>Notes</strong>
        <textarea aria-label="Notes" value={notes} maxLength={4000} onChange={(event) => setNotes(event.target.value)} />
        <button type="button" className="quiet" disabled={busy || notes === app.notes}
          onClick={() => void run(() => props.repo.saveNotes(app.applicationId, notes))}>
          Save notes
        </button>
      </div>

      <div className="card stack">
        <strong>History</strong>
        {events.length === 0 ? <p className="muted">No stage changes yet.</p> : null}
        <ol>
          {events.map((event) => (
            <li key={event.eventId}>
              {shortDate(event.createdAt)}: {event.fromStage} to {event.toStage}
              {event.chosenLabel ? ` (confirmed ${event.chosenLabel} reply)` : ""}, revision {event.revision}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function highlight(body: string, reply: Reply) {
  const parts: Array<{ text: string; hit: boolean; ignored: string | null }> = [];
  let at = 0;
  for (const hit of [...reply.prediction.hits].sort((left, right) => left.start - right.start)) {
    if (hit.start < at) continue;
    parts.push({ text: body.slice(at, hit.start), hit: false, ignored: null });
    parts.push({ text: body.slice(hit.start, hit.end), hit: true, ignored: hit.ignored });
    at = hit.end;
  }
  parts.push({ text: body.slice(at), hit: false, ignored: null });
  return parts.map((part, index) =>
    part.hit ? (
      <mark key={index} className={part.ignored ? "ignored" : ""} title={part.ignored ? `not counted: ${part.ignored}` : "counted"}>
        {part.text}
      </mark>
    ) : (
      <span key={index}>{part.text}</span>
    ),
  );
}

function ReplyCard(props: { reply: Reply; stage: Stage; busy: boolean; onConfirm: (label: ReplyLabel) => Promise<void> }) {
  const { reply } = props;
  const [label, setLabel] = useState<ReplyLabel>(reply.prediction.label);
  const suggested = stageAfterReply(props.stage, label);
  return (
    <li className="card stack">
      <pre className="reply">{highlight(reply.body, reply)}</pre>
      <p>
        Suggested: <span className="tag">{reply.prediction.label}</span>{" "}
        <span className={`tag ${reply.prediction.needsReview ? "tag-unchecked" : "tag-verified"}`}>
          {reply.prediction.needsReview ? "needs review" : "strong rule evidence"}
        </span>{" "}
        <span className="muted">rules {reply.prediction.rulesVersion}; {reply.prediction.hits.filter((hit) => !hit.ignored).map((hit) => hit.ruleId).join(", ") || "no counted rule"}</span>
      </p>
      <ul className="warnings">
        {reply.prediction.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      {reply.confirmedAt ? (
        <p className="notice">Confirmed as {reply.chosenLabel} on {shortDate(reply.confirmedAt)}.</p>
      ) : (
        <div className="row">
          <label>
            Confirm as
            <select value={label} onChange={(event) => setLabel(event.target.value as ReplyLabel)}>
              {REPLY_LABELS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <span className="muted">Stage after confirming: {suggested}{suggested === props.stage ? " (unchanged)" : ""}</span>
          <button type="button" disabled={props.busy} onClick={() => void props.onConfirm(label)}>Confirm</button>
        </div>
      )}
    </li>
  );
}
