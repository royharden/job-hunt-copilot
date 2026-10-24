// Synthetic demo and regression fixtures. Every person, employer and posting here is invented.
// Fixed UUIDs stay in the demo and tests; they never reach live rows.
import { sha256Hex } from "./hash.ts";
import type {
  FactVersion,
  PostingVersion,
  Profile,
  RoleVersion,
  SkillEvidence,
  SourceDocumentVersion,
} from "./types.ts";

const T0 = "2026-10-01T12:00:00.000Z";
const T1 = "2026-10-05T12:00:00.000Z";

export const DOC_RESUME = "d0000000-0000-4000-8000-000000000001";
export const DOC_RESUME_V1 = "d0000000-0000-4000-8000-0000000000a1";

export const ROLE_CONTOSO = "e0000000-0000-4000-8000-000000000001";
export const ROLE_CONTOSO_V1 = "e0000000-0000-4000-8000-0000000000a1";
export const ROLE_FABRIKAM = "e0000000-0000-4000-8000-000000000002";
export const ROLE_FABRIKAM_V1 = "e0000000-0000-4000-8000-0000000000a2";

export const FACT_PYTHON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const FACT_LATENCY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
export const FACT_MIGRATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
export const FACT_REACT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
export const FACT_LEDGER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
export const FACT_DEGREE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
export const FACT_HYBRID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
export const UNKNOWN_FACT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

const v = (n: number) => `ffffffff-ffff-4fff-8fff-${String(n).padStart(12, "0")}`;
export const FACT_PYTHON_V1 = v(1);
export const FACT_LATENCY_V1 = v(2);
export const FACT_MIGRATION_V1 = v(3);
export const FACT_REACT_V1 = v(4);
export const FACT_REACT_V2 = v(14);
export const FACT_LEDGER_V1 = v(5);
export const FACT_DEGREE_V1 = v(6);
export const FACT_HYBRID_V1 = v(7);

export const SKILL_PYTHON = "c0000000-0000-4000-8000-000000000001";
export const SKILL_REACT = "c0000000-0000-4000-8000-000000000002";
export const SKILL_TYPESCRIPT = "c0000000-0000-4000-8000-000000000003";

export const RESUME_BODY = [
  "Avery Example (synthetic profile)",
  "Contoso Ltd, Billing Engineer, 2019-03 to 2022-06",
  "- Built internal Python services for the billing platform.",
  "- Cut p95 latency by 12% on the billing API.",
  "Fabrikam Inc, Senior Software Engineer, 2022-07 to present",
  "- Contributed to the migration of the payments API to TypeScript.",
  "- Built React dashboards used by 40 support agents.",
  "- Reduced nightly reconciliation time from 6 hours to 90 minutes on the Ledger project.",
  "Education",
  "- B.S. in Computer Science, Example State University, 2018.",
].join("\n");

const RESUME: SourceDocumentVersion = {
  documentId: DOC_RESUME,
  versionId: DOC_RESUME_V1,
  title: "Synthetic resume (Avery Example)",
  body: RESUME_BODY,
  sha256: sha256Hex(RESUME_BODY),
  createdAt: T0,
};

function spanOf(quote: string) {
  const start = RESUME_BODY.indexOf(quote);
  if (start < 0) throw new Error(`fixture quote not in resume: ${quote}`);
  return {
    type: "source_span" as const,
    documentId: DOC_RESUME,
    documentVersionId: DOC_RESUME_V1,
    documentSha256: RESUME.sha256,
    start,
    end: start + quote.length,
    quote,
  };
}

const ROLES: RoleVersion[] = [
  {
    roleId: ROLE_CONTOSO,
    versionId: ROLE_CONTOSO_V1,
    employer: "Contoso Ltd",
    title: "Billing Engineer",
    start: "2019-03",
    end: "2022-06",
    current: false,
    asOf: "2026-10",
    status: "approved",
    approvedAt: T0,
    createdAt: T0,
  },
  {
    roleId: ROLE_FABRIKAM,
    versionId: ROLE_FABRIKAM_V1,
    employer: "Fabrikam Inc",
    title: "Senior Software Engineer",
    start: "2022-07",
    end: null,
    current: true,
    asOf: "2026-10",
    status: "approved",
    approvedAt: T0,
    createdAt: T0,
  },
];

function fact(
  factId: string,
  versionId: string,
  text: string,
  extra: Partial<FactVersion> & Pick<FactVersion, "kind">,
): FactVersion {
  return {
    factId,
    versionId,
    text,
    roleRef: null,
    projectLabel: null,
    status: "approved",
    origin: spanOf(text),
    approvedAt: T0,
    withdrawnAt: null,
    createdAt: T0,
    ...extra,
  };
}

const contoso = { roleId: ROLE_CONTOSO, roleVersionId: ROLE_CONTOSO_V1 };
const fabrikam = { roleId: ROLE_FABRIKAM, roleVersionId: ROLE_FABRIKAM_V1 };

const FACTS: FactVersion[] = [
  fact(FACT_PYTHON, FACT_PYTHON_V1, "Built internal Python services for the billing platform.", { kind: "accomplishment", roleRef: contoso }),
  fact(FACT_LATENCY, FACT_LATENCY_V1, "Cut p95 latency by 12% on the billing API.", { kind: "accomplishment", roleRef: contoso }),
  fact(FACT_MIGRATION, FACT_MIGRATION_V1, "Contributed to the migration of the payments API to TypeScript.", {
    kind: "accomplishment",
    roleRef: fabrikam,
  }),
  // Older React wording, approved from a user statement and later superseded by the source-backed version.
  {
    factId: FACT_REACT,
    versionId: FACT_REACT_V1,
    kind: "accomplishment",
    text: "Built React dashboards for support agents.",
    roleRef: fabrikam,
    projectLabel: null,
    status: "approved",
    origin: { type: "user_attestation", statement: "I built React dashboards for support agents.", attestedAt: T0 },
    approvedAt: T0,
    withdrawnAt: null,
    createdAt: T0,
  },
  fact(FACT_REACT, FACT_REACT_V2, "Built React dashboards used by 40 support agents.", {
    kind: "accomplishment",
    roleRef: fabrikam,
    createdAt: T1,
    approvedAt: T1,
  }),
  fact(FACT_LEDGER, FACT_LEDGER_V1, "Reduced nightly reconciliation time from 6 hours to 90 minutes on the Ledger project.", {
    kind: "project",
    roleRef: fabrikam,
    projectLabel: "Ledger",
  }),
  fact(FACT_DEGREE, FACT_DEGREE_V1, "B.S. in Computer Science, Example State University, 2018.", { kind: "education" }),
  {
    factId: FACT_HYBRID,
    versionId: FACT_HYBRID_V1,
    kind: "preference",
    text: "Open to hybrid work in the Seattle area.",
    roleRef: null,
    projectLabel: null,
    status: "approved",
    origin: { type: "user_attestation", statement: "Open to hybrid work in the Seattle area.", attestedAt: T0 },
    approvedAt: T0,
    withdrawnAt: null,
    createdAt: T0,
  },
];

// The React link still cites the superseded wording: the demo's selected-evidence health issue to repair.
const SKILL_EVIDENCE: SkillEvidence[] = [
  { skillId: SKILL_PYTHON, factId: FACT_PYTHON, factVersionId: FACT_PYTHON_V1, usage: [], attestedMonths: null },
  { skillId: SKILL_REACT, factId: FACT_REACT, factVersionId: FACT_REACT_V1, usage: [], attestedMonths: null },
  { skillId: SKILL_TYPESCRIPT, factId: FACT_MIGRATION, factVersionId: FACT_MIGRATION_V1, usage: [], attestedMonths: null },
];

export function sampleProfile(): Profile {
  return structuredCloneSafe({
    sources: [RESUME],
    roles: ROLES,
    facts: FACTS,
    skills: [
      { skillId: SKILL_PYTHON, canonical: "Python", aliases: [{ alias: "python3", approved: true }] },
      {
        skillId: SKILL_REACT,
        canonical: "React",
        aliases: [
          { alias: "React.js", approved: true },
          { alias: "ReactJS", approved: true },
        ],
      },
      { skillId: SKILL_TYPESCRIPT, canonical: "TypeScript", aliases: [{ alias: "TS", approved: true }] },
    ],
    skillEvidence: SKILL_EVIDENCE,
  });
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const SAMPLE_POSTING_ID = "b0000000-0000-4000-8000-000000000001";
export const SAMPLE_POSTING_V1 = "b0000000-0000-4000-8000-0000000000a1";

export const SAMPLE_JOB_POSTING = [
  "Senior Frontend Engineer",
  "Northwind Traders (synthetic posting)",
  "",
  "About the role:",
  "You will build tools for our support organisation.",
  "",
  "Requirements:",
  "- Strong React experience",
  "- 5+ years building production web applications",
  "- Experience building Python services",
  "- Kubernetes administration",
  "- TypeScript and GraphQL",
  "",
  "Nice to have:",
  "- Experience reducing API latency",
  "",
  "Benefits:",
  "- Health insurance and 401k matching",
].join("\n");

export function samplePosting(): PostingVersion {
  return {
    postingId: SAMPLE_POSTING_ID,
    versionId: SAMPLE_POSTING_V1,
    kind: "job",
    organisation: "Northwind Traders",
    title: "Senior Frontend Engineer",
    body: SAMPLE_JOB_POSTING,
    sha256: sha256Hex(SAMPLE_JOB_POSTING),
    url: null,
    createdAt: T1,
  };
}

// Labelled fabrications for the demo lab (journey step 5). Each must be blocked or reverted.
export interface FabricationCase {
  id: string;
  label: string;
  text: string;
  cites: { factId: string; versionId: string }[];
  expectedCode: string;
  whatBugThisCatches: string;
}

export const FABRICATIONS: FabricationCase[] = [
  {
    id: "fab-kubernetes",
    label: "Added tool",
    text: "Administered Kubernetes clusters for the billing platform.",
    cites: [{ factId: FACT_PYTHON, versionId: FACT_PYTHON_V1 }],
    expectedCode: "unbacked_tool",
    whatBugThisCatches: "A tool from the posting's gap list inserted into an unrelated cited sentence.",
  },
  {
    id: "fab-unit-swap",
    label: "Unit swap",
    text: "Built React dashboards used by 40% of support agents.",
    cites: [{ factId: FACT_REACT, versionId: FACT_REACT_V2 }],
    expectedCode: "unit_swap",
    whatBugThisCatches: "A people count re-expressed as a percentage passes a digits-only check.",
  },
  {
    id: "fab-wrong-project",
    label: "Wrong-project metric",
    text: "Cut p95 latency by 12% on the Ledger project.",
    cites: [{ factId: FACT_LATENCY, versionId: FACT_LATENCY_V1 }],
    expectedCode: "wrong_project",
    whatBugThisCatches: "A real metric moved onto a different project.",
  },
  {
    id: "fab-led",
    label: "Contributed-to became led",
    text: "Led the migration of the payments API to TypeScript.",
    cites: [{ factId: FACT_MIGRATION, versionId: FACT_MIGRATION_V1 }],
    expectedCode: "verb_escalation",
    whatBugThisCatches: "Authorship escalation from 'contributed to' to 'led' with every other word unchanged.",
  },
  {
    id: "fab-led-unrelated",
    label: "Unsupported leadership (relabelled Grok fixture)",
    text: "Led the migration.",
    cites: [{ factId: FACT_PYTHON, versionId: FACT_PYTHON_V1 }],
    expectedCode: "verb_escalation",
    whatBugThisCatches: "Grok's original fixture let 'Led the migration' pass with an employer-only citation.",
  },
];

export const SAMPLE_REPLIES = {
  vague: "Thanks for your interest. We'll be in touch.",
  quoted: [
    "Following up on the note below.",
    "",
    "On Mon, Oct 20, 2026, Northwind Recruiting wrote:",
    "> We are pleased to offer you the Senior Frontend Engineer role.",
  ].join("\n"),
  rejection:
    "Thank you for applying to the Senior Frontend Engineer role at Northwind Traders. Unfortunately, we will not be moving forward with your application.",
};
