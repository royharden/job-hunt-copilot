// Finite tool list the gate can see without a profile fact.
// Ordinary English words that collide with product names (excel, spark, react, rust, helm, go)
// are left off. Those claims are enforced only when the person saves them as fact surfaces.
export const TOOL_LEXICON = [
  "Amazon Web Services",
  "Google Cloud",
  "Elasticsearch",
  "JavaScript",
  "TypeScript",
  "PostgreSQL",
  "Kubernetes",
  "TensorFlow",
  "Salesforce",
  "Databricks",
  "Snowflake",
  "Terraform",
  "BigQuery",
  "DynamoDB",
  "MongoDB",
  "GraphQL",
  "Supabase",
  "Firebase",
  "OpenShift",
  "PowerBI",
  "Redshift",
  "Next.js",
  "Node.js",
  "FastAPI",
  "Ansible",
  "Jenkins",
  "Airflow",
  "Looker",
  "Tableau",
  "Django",
  "Docker",
  "GitHub",
  "GitLab",
  "Figma",
  "Kafka",
  "Linux",
  "Azure",
  "Nginx",
  "Redis",
  "Pandas",
  "NumPy",
  "Python",
  "Kotlin",
  "Scala",
  "Swift",
  "Ruby",
  "Rails",
  "Java",
  "PyTorch",
  "C++",
  "C#",
  ".NET",
  "SQL",
  "AWS",
  "GCP",
  "SAP",
] as const;

const ORDERED = [...TOOL_LEXICON].sort((left, right) => right.length - left.length);

const LEXICON_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${ORDERED.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
);

export function findLexiconTerms(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(LEXICON_RE.source, LEXICON_RE.flags);
  for (const match of text.matchAll(re)) {
    const raw = match[0];
    const canonical = ORDERED.find((term) => term.toLowerCase() === raw.toLowerCase());
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    found.push(canonical);
  }
  return found;
}
