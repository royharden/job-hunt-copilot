import { useMemo, useState, type FormEvent } from "react";
import { representedRoleSpan } from "../../supabase/functions/_shared/provenance/aliases.ts";
import { validateProfile, type RepairAction } from "../../supabase/functions/_shared/provenance/health.ts";
import { normalizeWhitespace } from "../../supabase/functions/_shared/provenance/normalize.ts";
import { FACT_KINDS, type FactKind, type FactVersion, type RoleVersion } from "../../supabase/functions/_shared/provenance/types.ts";
import { currentFactVersion, currentFacts, currentRoleVersion, roleDates } from "../../supabase/functions/_shared/provenance/versions.ts";
import { errorMessage } from "../lib/format.ts";
import type { HuntRepository, Workspace } from "../lib/repository.ts";

interface Props {
  repo: HuntRepository;
  workspace: Workspace;
  onChanged: () => Promise<void>;
}

function useRunner(onChanged: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await onChanged();
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run };
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function repairLabel(repair: RepairAction): string {
  switch (repair.type) {
    case "relink_to_current":
      return "Re-link to the current version";
    case "remove_link":
      return "Remove this link";
    case "remove_alias":
      return `Remove alias "${repair.alias}"`;
    default:
      return "Open editor below";
  }
}

export function ProfileScreen(props: Props) {
  const { profile } = props.workspace;
  const health = useMemo(() => validateProfile(profile), [profile]);
  const { error, busy, run } = useRunner(props.onChanged);
  const factIds = [...new Set(profile.facts.map((fact) => fact.factId))];
  const roleIds = [...new Set(profile.roles.map((role) => role.roleId))];
  const approvedRoles = roleIds.map((id) => currentRoleVersion(profile.roles, id)).filter((role): role is RoleVersion => role !== null);

  return (
    <div className="stack">
      {error ? <p className="error" role="alert">{error}</p> : null}

      <section className="panel stack" aria-labelledby="health-heading">
        <h2 id="health-heading">Profile health</h2>
        {health.problems.length === 0 ? <p className="notice">No problems in selected-evidence links, spans, dates or aliases.</p> : null}
        <ul className="list">
          {health.problems.map((problem, index) => (
            <li key={`p-${index}`} className="card">
              <span className="tag tag-blocked">{problem.code}</span> {problem.reason}
              <div className="row">
                {problem.repairs.map((repair, repairIndex) =>
                  repair.type.startsWith("edit_") ? (
                    <span key={repairIndex} className="muted">
                      Fix it with "Edit (new version)" or "Withdraw" on the item in the{" "}
                      {repair.type === "edit_role" ? "Roles" : repair.type === "edit_skill" ? "Skills" : "Approved statements"} section below.
                    </span>
                  ) : (
                    <button
                      key={repairIndex}
                      type="button"
                      className="quiet"
                      disabled={busy}
                      onClick={() => void run(() => props.repo.applyRepair(repair))}
                    >
                      {repairLabel(repair)}
                    </button>
                  ),
                )}
              </div>
            </li>
          ))}
          {health.notes.map((note, index) => (
            <li key={`n-${index}`} className="card muted">
              <span className="tag">note</span> {note.reason}
            </li>
          ))}
        </ul>
      </section>

      <SourcesPanel {...props} busy={busy} run={run} approvedRoles={approvedRoles} />
      <RolesPanel {...props} busy={busy} run={run} roleIds={roleIds} />
      <FactsPanel {...props} busy={busy} run={run} factIds={factIds} approvedRoles={approvedRoles} />
      <SkillsPanel {...props} busy={busy} run={run} />
    </div>
  );
}

interface PanelProps extends Props {
  busy: boolean;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}

function FactFields(props: {
  kind: FactKind;
  setKind: (kind: FactKind) => void;
  roleKey: string;
  setRoleKey: (key: string) => void;
  project: string;
  setProject: (value: string) => void;
  approvedRoles: RoleVersion[];
}) {
  return (
    <div className="row">
      <label>
        Kind
        <select value={props.kind} onChange={(event) => props.setKind(event.target.value as FactKind)}>
          {FACT_KINDS.map((kind) => (
            <option key={kind} value={kind}>{kind.replace("_", " ")}</option>
          ))}
        </select>
      </label>
      <label>
        Role (optional)
        <select value={props.roleKey} onChange={(event) => props.setRoleKey(event.target.value)}>
          <option value="">No role</option>
          {props.approvedRoles.map((role) => (
            <option key={role.versionId} value={`${role.roleId}|${role.versionId}`}>{role.title} at {role.employer}</option>
          ))}
        </select>
      </label>
      <label>
        Project (optional)
        <input value={props.project} maxLength={80} onChange={(event) => props.setProject(event.target.value)} />
      </label>
    </div>
  );
}

function roleRefFrom(key: string) {
  if (!key) return null;
  const [roleId, roleVersionId] = key.split("|");
  return { roleId, roleVersionId };
}

function SourcesPanel(props: PanelProps & { approvedRoles: RoleVersion[] }) {
  const { profile } = props.workspace;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [selection, setSelection] = useState<{ docKey: string; start: number; end: number } | null>(null);
  const [kind, setKind] = useState<FactKind>("accomplishment");
  const [roleKey, setRoleKey] = useState("");
  const [project, setProject] = useState("");

  function addSource(event: FormEvent) {
    event.preventDefault();
    void props.run(async () => {
      await props.repo.addSource(title, body);
      setTitle("");
      setBody("");
    });
  }

  return (
    <section className="panel stack" aria-labelledby="sources-heading">
      <h2 id="sources-heading">Source documents</h2>
      <p className="muted">
        Paste plain text (for example your resume). Select one sentence to turn it into a draft statement with an exact source span.
        Offsets are recorded against this exact version; editing a source creates a new version.
      </p>
      {profile.sources.map((doc) => {
        const docKey = `${doc.documentId}|${doc.versionId}`;
        const selected = selection && selection.docKey === docKey ? doc.body.slice(selection.start, selection.end) : "";
        return (
          <div key={docKey} className="card stack">
            <strong>{doc.title}</strong>
            <span className="muted">Version {doc.versionId.slice(0, 8)}, sha256 {doc.sha256.slice(0, 12)}...</span>
            <textarea
              readOnly
              aria-label={`Source text of ${doc.title}`}
              value={doc.body}
              onSelect={(event) => {
                const target = event.currentTarget;
                if (target.selectionEnd > target.selectionStart) {
                  setSelection({ docKey, start: target.selectionStart, end: target.selectionEnd });
                }
              }}
            />
            {selected ? (
              <div className="stack">
                <p>
                  Selected: <q>{normalizeWhitespace(selected)}</q>
                </p>
                <FactFields
                  kind={kind}
                  setKind={setKind}
                  roleKey={roleKey}
                  setRoleKey={setRoleKey}
                  project={project}
                  setProject={setProject}
                  approvedRoles={props.approvedRoles}
                />
                <button
                  type="button"
                  disabled={props.busy}
                  onClick={() =>
                    void props.run(async () => {
                      await props.repo.saveFact({
                        factId: null,
                        kind,
                        text: normalizeWhitespace(selected),
                        roleRef: roleRefFrom(roleKey),
                        projectLabel: project || null,
                        origin: { type: "source_span", documentId: doc.documentId, documentVersionId: doc.versionId, start: selection!.start, end: selection!.end },
                      });
                      setSelection(null);
                    })
                  }
                >
                  Save as draft statement
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
      <form className="stack" onSubmit={addSource}>
        <label>
          Title
          <input value={title} required maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label>
          Text
          <textarea value={body} required maxLength={30000} onChange={(event) => setBody(event.target.value)} />
        </label>
        <button type="submit" disabled={props.busy}>Add source</button>
      </form>
    </section>
  );
}

function RolesPanel(props: PanelProps & { roleIds: string[] }) {
  const { profile } = props.workspace;
  const empty = { roleId: null as string | null, employer: "", title: "", start: "", end: "", current: false, asOf: thisMonth() };
  const [form, setForm] = useState(empty);

  function save(event: FormEvent) {
    event.preventDefault();
    void props.run(async () => {
      await props.repo.saveRole({ ...form, end: form.current ? null : form.end });
      setForm(empty);
    });
  }

  return (
    <section className="panel stack" aria-labelledby="roles-heading">
      <h2 id="roles-heading">Roles</h2>
      <ul className="list">
        {props.roleIds.map((roleId) => {
          const versions = profile.roles.filter((role) => role.roleId === roleId);
          const current = currentRoleVersion(profile.roles, roleId);
          const drafts = versions.filter((role) => role.status === "draft");
          const latest = current ?? versions[versions.length - 1];
          return (
            <li key={roleId} className="card stack">
              <div>
                <strong>{latest.title}</strong> at {latest.employer}, {roleDates(latest)}{" "}
                <span className={`tag ${current ? "tag-verified" : "tag-blocked"}`}>{current ? "approved" : "not current"}</span>
              </div>
              {drafts.map((draft) => (
                <div key={draft.versionId} className="row">
                  <span className="tag tag-unchecked">draft</span> {draft.title} at {draft.employer}, {roleDates(draft)}
                  <button type="button" disabled={props.busy} onClick={() => void props.run(() => props.repo.approveRole(roleId, draft.versionId))}>
                    Approve version
                  </button>
                </div>
              ))}
              <div className="row">
                {current ? (
                  <>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() =>
                        setForm({
                          roleId,
                          employer: current.employer,
                          title: current.title,
                          start: current.start,
                          end: current.end ?? "",
                          current: current.current,
                          asOf: thisMonth(),
                        })
                      }
                    >
                      Edit (new version)
                    </button>
                    <button type="button" className="quiet" disabled={props.busy} onClick={() => void props.run(() => props.repo.withdrawRole(roleId))}>
                      Withdraw
                    </button>
                  </>
                ) : null}
                <span className="muted">{versions.length} version(s); history is kept.</span>
              </div>
            </li>
          );
        })}
      </ul>
      <form className="stack" onSubmit={save}>
        <h3>{form.roleId ? "New version of role" : "Add role"}</h3>
        <div className="row">
          <label>
            Employer
            <input required value={form.employer} onChange={(event) => setForm({ ...form, employer: event.target.value })} />
          </label>
          <label>
            Title
            <input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </label>
          <label>
            Start (YYYY-MM)
            <input required pattern="\d{4}-\d{2}" value={form.start} onChange={(event) => setForm({ ...form, start: event.target.value })} />
          </label>
          <label>
            End (YYYY-MM)
            <input
              pattern="\d{4}-\d{2}"
              disabled={form.current}
              value={form.end}
              onChange={(event) => setForm({ ...form, end: event.target.value })}
            />
          </label>
          <label className="inline">
            <input type="checkbox" checked={form.current} onChange={(event) => setForm({ ...form, current: event.target.checked })} /> Current
          </label>
          <label>
            As of (YYYY-MM)
            <input required pattern="\d{4}-\d{2}" value={form.asOf} onChange={(event) => setForm({ ...form, asOf: event.target.value })} />
          </label>
        </div>
        <div className="row">
          <button type="submit" disabled={props.busy}>Save draft role</button>
          {form.roleId ? <button type="button" className="quiet" onClick={() => setForm(empty)}>Cancel</button> : null}
        </div>
      </form>
    </section>
  );
}

function originText(fact: FactVersion): string {
  return fact.origin.type === "source_span"
    ? `Source span ${fact.origin.start}-${fact.origin.end} of version ${fact.origin.documentVersionId.slice(0, 8)}`
    : `Your statement, attested ${fact.origin.attestedAt.slice(0, 10)}`;
}

function FactsPanel(props: PanelProps & { factIds: string[]; approvedRoles: RoleVersion[] }) {
  const { profile } = props.workspace;
  const [statement, setStatement] = useState("");
  const [attest, setAttest] = useState(false);
  const [kind, setKind] = useState<FactKind>("accomplishment");
  const [roleKey, setRoleKey] = useState("");
  const [project, setProject] = useState("");
  const [editingFactId, setEditingFactId] = useState<string | null>(null);

  function save(event: FormEvent) {
    event.preventDefault();
    void props
      .run(() =>
        props.repo.saveFact({
          factId: editingFactId,
          kind,
          text: statement,
          roleRef: roleRefFrom(roleKey),
          projectLabel: project || null,
          origin: { type: "user_attestation", statement },
        }),
      )
      .then((ok) => {
        if (!ok) return;
        setStatement("");
        setAttest(false);
        setEditingFactId(null);
      });
  }

  return (
    <section className="panel stack" aria-labelledby="facts-heading">
      <h2 id="facts-heading">Approved statements</h2>
      <p className="muted">
        Only approved, current statements can be used as evidence or in a packet. Approved wording never changes: edits create a new
        draft version, and withdrawal stops future use while keeping history.
      </p>
      <ul className="list">
        {props.factIds.map((factId) => {
          const versions = profile.facts.filter((fact) => fact.factId === factId);
          const current = currentFactVersion(profile.facts, factId);
          const drafts = versions.filter((fact) => fact.status === "draft");
          const shown = current ?? versions[versions.length - 1];
          return (
            <li key={factId} className="card stack">
              <div>
                <span className={`tag ${current ? "tag-verified" : "tag-blocked"}`}>{current ? "approved" : shown.status}</span>{" "}
                <span className="tag">{shown.kind.replace("_", " ")}</span> {shown.text}
              </div>
              <span className="muted">
                {originText(shown)}
                {shown.projectLabel ? `; project ${shown.projectLabel}` : ""}; {versions.length} version(s)
              </span>
              {drafts.map((draft) => (
                <div key={draft.versionId} className="row">
                  <span className="tag tag-unchecked">draft</span> {draft.text}
                  <button type="button" disabled={props.busy} onClick={() => void props.run(() => props.repo.approveFact(factId, draft.versionId))}>
                    Approve
                  </button>
                </div>
              ))}
              {current ? (
                <div className="row">
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => {
                      setEditingFactId(factId);
                      setStatement(current.text);
                      setKind(current.kind);
                      setProject(current.projectLabel ?? "");
                      setRoleKey(current.roleRef ? `${current.roleRef.roleId}|${current.roleRef.roleVersionId}` : "");
                    }}
                  >
                    Edit (new version)
                  </button>
                  <button type="button" className="quiet" disabled={props.busy} onClick={() => void props.run(() => props.repo.withdrawFact(factId))}>
                    Withdraw
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <form className="stack" onSubmit={save} id="fact-form">
        <h3>{editingFactId ? "New version of statement" : "Add a personal statement"}</h3>
        <label>
          Statement
          <textarea value={statement} required maxLength={500} onChange={(event) => setStatement(event.target.value)} />
        </label>
        <FactFields
          kind={kind}
          setKind={setKind}
          roleKey={roleKey}
          setRoleKey={setRoleKey}
          project={project}
          setProject={setProject}
          approvedRoles={props.approvedRoles}
        />
        <label className="inline">
          <input type="checkbox" checked={attest} onChange={(event) => setAttest(event.target.checked)} /> I attest this statement is accurate.
          It is saved as a draft; approve it separately.
        </label>
        <div className="row">
          <button type="submit" disabled={props.busy || !attest}>Save draft</button>
          {editingFactId ? (
            <button type="button" className="quiet" onClick={() => { setEditingFactId(null); setStatement(""); }}>
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function SkillsPanel(props: PanelProps) {
  const { profile } = props.workspace;
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [linkSkill, setLinkSkill] = useState("");
  const [linkFact, setLinkFact] = useState("");
  const [months, setMonths] = useState("");
  const facts = currentFacts(profile);

  function addSkill(event: FormEvent) {
    event.preventDefault();
    const list = aliases
      .split(",")
      .map((alias) => alias.trim())
      .filter(Boolean)
      .map((alias) => ({ alias, approved: true }));
    void props.run(async () => {
      await props.repo.saveSkill(null, name, list);
      setName("");
      setAliases("");
    });
  }

  function link(event: FormEvent) {
    event.preventDefault();
    const fact = facts.find((item) => item.versionId === linkFact);
    if (!fact || !linkSkill) return;
    const attested = months.trim() === "" ? null : Number(months);
    void props.run(async () => {
      await props.repo.linkSkill(linkSkill, { factId: fact.factId, versionId: fact.versionId }, [], attested);
      setMonths("");
    });
  }

  return (
    <section className="panel stack" aria-labelledby="skills-heading">
      <h2 id="skills-heading">Skills and aliases</h2>
      <p className="muted">
        A skill supports a requirement only through an approved alias and a linked statement. Role span is the union of dated roles whose
        linked statements are current; it is not total experience. Years count only with an attested duration.
      </p>
      <ul className="list">
        {profile.skills.map((skill) => {
          const span = representedRoleSpan(profile, skill.skillId, thisMonth());
          const links = profile.skillEvidence.filter((item) => item.skillId === skill.skillId);
          return (
            <li key={skill.skillId} className="card stack">
              <div>
                <strong>{skill.canonical}</strong>{" "}
                {skill.aliases.map((alias) => (
                  <button
                    key={alias.alias}
                    type="button"
                    className={`tag ${alias.approved ? "tag-verified" : ""}`}
                    title={alias.approved ? "Approved alias (click to unapprove)" : "Unapproved alias (click to approve)"}
                    onClick={() =>
                      void props.run(() =>
                        props.repo.saveSkill(
                          skill.skillId,
                          skill.canonical,
                          skill.aliases.map((item) => (item.alias === alias.alias ? { ...item, approved: !item.approved } : item)),
                        ),
                      )
                    }
                  >
                    {alias.alias}
                  </button>
                ))}
              </div>
              <span className="muted">
                Represented role span: {span.months} month(s) as of {span.asOf ?? "?"}; attested duration:{" "}
                {span.attestedMonths === null ? "none (counts zero toward years)" : `${span.attestedMonths} month(s)`}
              </span>
              <ul className="list">
                {links.map((item) => {
                  const fact = profile.facts.find((candidate) => candidate.factId === item.factId && candidate.versionId === item.factVersionId);
                  return (
                    <li key={`${item.factId}-${item.factVersionId}`} className="row">
                      <span>{fact ? fact.text : "(missing statement)"}</span>
                      <button
                        type="button"
                        className="quiet"
                        disabled={props.busy}
                        onClick={() => void props.run(() => props.repo.unlinkSkill(item.skillId, item.factId, item.factVersionId))}
                      >
                        Unlink
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      <form className="row" onSubmit={addSkill}>
        <label>
          Skill
          <input required value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Approved aliases (comma separated)
          <input value={aliases} onChange={(event) => setAliases(event.target.value)} />
        </label>
        <button type="submit" disabled={props.busy}>Add skill</button>
      </form>
      <form className="row" onSubmit={link}>
        <label>
          Skill
          <select value={linkSkill} onChange={(event) => setLinkSkill(event.target.value)}>
            <option value="">Choose</option>
            {profile.skills.map((skill) => (
              <option key={skill.skillId} value={skill.skillId}>{skill.canonical}</option>
            ))}
          </select>
        </label>
        <label>
          Statement
          <select value={linkFact} onChange={(event) => setLinkFact(event.target.value)}>
            <option value="">Choose</option>
            {facts.map((fact) => (
              <option key={fact.versionId} value={fact.versionId}>{fact.text.slice(0, 80)}</option>
            ))}
          </select>
        </label>
        <label>
          Attested months (optional)
          <input inputMode="numeric" value={months} onChange={(event) => setMonths(event.target.value)} />
        </label>
        <button type="submit" disabled={props.busy || !linkSkill || !linkFact}>Link</button>
      </form>
    </section>
  );
}
