// Independent frozen-edition/report verification. Run: node --experimental-strip-types evals/verify-pilot.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { GUARD_CASES } from "../eval/guard-cases.ts";
import { REPLY_CASES } from "../eval/reply-cases.ts";

const normalize = (text) => text.replace(/\r\n/g, "\n").trim();
const manifest = JSON.parse(fs.readFileSync("eval/manifest.json", "utf8"));
for (const [file, record] of Object.entries(manifest.files)) {
  const bytes = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), record.sha256, `frozen hash: ${file}`);
}
assert.equal(GUARD_CASES.length, 60); assert.equal(REPLY_CASES.length, 60);
function counts(cases, category) {
  const result = {};
  for (const label of new Set(cases.map(category))) {
    const sorted = cases.filter((item) => category(item) === label).sort((left, right) => {
      const hash = (item) => crypto.createHash("sha256").update(manifest.seed + item.id).digest("hex");
      return hash(left).localeCompare(hash(right));
    });
    const dev = Math.round(sorted.length * 0.7);
    result[label] = { dev, heldout: sorted.length - dev, total: sorted.length };
  }
  return result;
}
const guard = counts(GUARD_CASES, (item) => item.expectBlock ? "adversarial" : "supported");
const replies = counts(REPLY_CASES, (item) => item.expectedLabel);
assert.deepEqual(guard, { supported: { dev: 21, heldout: 9, total: 30 }, adversarial: { dev: 21, heldout: 9, total: 30 } });
assert.equal(Object.keys(replies).length, 6);
for (const count of Object.values(replies)) assert.deepEqual(count, { dev: 7, heldout: 3, total: 10 });
const actual = execFileSync(process.execPath, ["--experimental-strip-types", "scripts/eval.ts"], { encoding: "utf8", timeout: 60000 });
const report = fs.readFileSync("results/results.md", "utf8");
const start = report.indexOf("# S15 pilot evaluation output");
assert.ok(start >= 0);
assert.equal(normalize(report.slice(start)), normalize(actual), "recorded report must equal complete fresh runner output");
console.log(JSON.stringify({ manifestHashes: 4, guard, replies, reportMatchesFreshExecution: true,
  residuals: "heuristic dev 20/21 unsupported + 1/21 supported blocked; verified 30/30 unsupported refused and 15/30 supported withheld; reply dev 0.926 / heldout 1.000, synthetic only" }, null, 2));
