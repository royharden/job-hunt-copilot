import type { Fact } from "./types.ts";

export const FACT_EMPLOYER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
export const FACT_TITLE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
export const FACT_PYTHON = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
export const FACT_METRIC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
export const FACT_DATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
export const FACT_ELIGIBILITY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
export const FACT_CPP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
export const UNKNOWN_FACT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";

export const SAMPLE_FACTS: Fact[] = [
  {
    id: FACT_EMPLOYER,
    kind: "employer",
    surface: "Contoso",
    text: "Worked at Contoso on the billing team.",
  },
  {
    id: FACT_TITLE,
    kind: "title",
    surface: "Engineer",
    text: "Held the title Engineer.",
  },
  {
    id: FACT_PYTHON,
    kind: "tool",
    surface: "Python",
    text: "Built internal Python services.",
  },
  {
    id: FACT_METRIC,
    kind: "metric",
    surface: "latency",
    text: "Cut p95 latency by 12% on the billing API.",
  },
  {
    id: FACT_DATE,
    kind: "date",
    surface: "2019",
    text: "Joined the billing team in 2019.",
  },
  {
    id: FACT_ELIGIBILITY,
    kind: "eligibility",
    surface: "accredited university",
    text: "Enrolled at an accredited university through 2027.",
  },
  {
    id: FACT_CPP,
    kind: "tool",
    surface: "C++",
    text: "Shipped an internal C++ helper used by the billing tests.",
  },
];

export const SAMPLE_JOB_POSTING = [
  "Billing Engineer",
  "",
  "Requirements:",
  "- Python services",
  "- Kubernetes administration",
  "- Engineer",
].join("\n");

export const SAMPLE_FELLOWSHIP_POSTING = [
  "Summer fellowship",
  "",
  "Eligibility:",
  "- Enrolled at an accredited university",
  "- 3.9 GPA",
].join("\n");

export interface BulletCase {
  name: string;
  text: string;
  factIds: string[];
  expectedBlock: boolean;
  expectedAction?: "pass" | "revert" | "drop";
}

export const ADVERSARIAL_BULLETS: BulletCase[] = [
  {
    name: "verbatim python fact",
    text: `Built internal Python services. [[fact:${FACT_PYTHON}]]`,
    factIds: [FACT_PYTHON],
    expectedBlock: false,
    expectedAction: "pass",
  },
  {
    name: "verbatim metric",
    text: `Cut p95 latency by 12% on the billing API. [[fact:${FACT_METRIC}]]`,
    factIds: [FACT_METRIC],
    expectedBlock: false,
    expectedAction: "pass",
  },
  {
    name: "ordinary verb is not a claim",
    text: `Led the migration. [[fact:${FACT_EMPLOYER}]]`,
    factIds: [FACT_EMPLOYER],
    expectedBlock: false,
    expectedAction: "pass",
  },
  {
    name: "verbatim c++ fact",
    text: `Shipped an internal C++ helper used by the billing tests. [[fact:${FACT_CPP}]]`,
    factIds: [FACT_CPP],
    expectedBlock: false,
    expectedAction: "pass",
  },
  {
    name: "added kubernetes",
    text: `Built internal Python services and Kubernetes. [[fact:${FACT_PYTHON}]]`,
    factIds: [FACT_PYTHON],
    expectedBlock: true,
    expectedAction: "drop",
  },
  {
    name: "replaced percent",
    text: `Cut p95 latency by 40% on the billing API. [[fact:${FACT_METRIC}]]`,
    factIds: [FACT_METRIC],
    expectedBlock: true,
    expectedAction: "revert",
  },
  {
    name: "invented employer",
    text: `Worked at Initech in 2019. [[fact:${FACT_DATE}]]`,
    factIds: [FACT_DATE],
    expectedBlock: true,
    expectedAction: "drop",
  },
  {
    name: "invented title",
    text: `Served as Staff Engineer on the billing API. [[fact:${FACT_TITLE}]]`,
    factIds: [FACT_TITLE],
    expectedBlock: true,
    expectedAction: "drop",
  },
  {
    name: "missing citation",
    text: "Built internal Python services.",
    factIds: [],
    expectedBlock: true,
    expectedAction: "drop",
  },
  {
    name: "unknown fact id",
    text: `Built internal Python services. [[fact:${UNKNOWN_FACT}]]`,
    factIds: [UNKNOWN_FACT],
    expectedBlock: true,
    expectedAction: "drop",
  },
  {
    name: "python cited only to the employer",
    text: `Built internal Python services. [[fact:${FACT_EMPLOYER}]]`,
    factIds: [FACT_EMPLOYER],
    expectedBlock: true,
    expectedAction: "drop",
  },
  {
    name: "c++ cited only to the python fact",
    text: `Shipped an internal C++ helper used by the billing tests. [[fact:${FACT_PYTHON}]]`,
    factIds: [FACT_PYTHON],
    expectedBlock: true,
    expectedAction: "drop",
  },
];

export interface EmailCase {
  name: string;
  text: string;
  label: "rejected" | "offer" | "interview" | "acknowledgement" | "not_applicable" | "unknown";
  needsReview: boolean;
}

export const SAMPLE_EMAILS: EmailCase[] = [
  {
    name: "clear rejection",
    text: "We regret to inform you that we are not moving forward with your application.",
    label: "rejected",
    needsReview: false,
  },
  {
    name: "clear offer",
    text: "We are pleased to offer you the role, including a compensation package.",
    label: "offer",
    needsReview: false,
  },
  {
    name: "clear interview",
    text: "Can we schedule a call for a phone screen next week?",
    label: "interview",
    needsReview: false,
  },
  {
    name: "clear acknowledgement",
    text: "Thank you for applying. Your application received our attention.",
    label: "acknowledgement",
    needsReview: false,
  },
  {
    name: "newsletter",
    text: "Use the link to unsubscribe from this newsletter.",
    label: "not_applicable",
    needsReview: false,
  },
  {
    name: "no signal",
    text: "Hello, just checking in about the weather.",
    label: "unknown",
    needsReview: true,
  },
  {
    name: "mixed rejection and interview",
    text: "We regret the delay, and we would still like to schedule a call.",
    label: "interview",
    needsReview: true,
  },
  {
    name: "weak interview word",
    text: "Please interview with us when you can.",
    label: "interview",
    needsReview: true,
  },
];
