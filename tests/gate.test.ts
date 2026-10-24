import { describe, expect, it } from "vitest";
import {
  ADVERSARIAL_BULLETS,
  FACT_METRIC,
  SAMPLE_FACTS,
} from "../supabase/functions/_shared/provenance/fixtures.ts";
import { gateClaim, gateMaterials, isApprovable, salvageDraft } from "../supabase/functions/_shared/provenance/gate.ts";
import { gateScores } from "../supabase/functions/_shared/provenance/metrics.ts";

describe("provenance gate", () => {
  it("passes, reverts, and drops the synthetic adversarial bullets", () => {
    const scored = ADVERSARIAL_BULLETS.map((bullet) => {
      const result = gateClaim({ text: bullet.text, factIds: bullet.factIds }, SAMPLE_FACTS, 0);
      expect(result.action, bullet.name).toBe(bullet.expectedAction);
      expect(result.action !== "pass", bullet.name).toBe(bullet.expectedBlock);
      return { expectedBlock: bullet.expectedBlock, blocked: result.action !== "pass" };
    });
    const scores = gateScores(scored);
    expect(scores.falsePositive).toBe(0);
    expect(scores.falseNegative).toBe(0);
    expect(scores.blockRate).toBe(1);
    expect(scores.falseBlockRate).toBe(0);
  });

  it("reverts an unbacked percent and the saved wording passes", () => {
    const original = gateClaim(
      {
        text: `Cut p95 latency by 40% on the billing API. [[fact:${FACT_METRIC}]]`,
        factIds: [FACT_METRIC],
      },
      SAMPLE_FACTS,
      0,
    );
    expect(original.action).toBe("revert");
    expect(original.reasons).toContain("reverted_number");
    expect(original.text).not.toContain("40%");
    const report = gateMaterials(
      { bullets: [{ text: original.text, factIds: original.factIds }], cover: [] },
      SAMPLE_FACTS,
    );
    expect(isApprovable(report)).toBe(true);
  });

  it("drops an added tool instead of reverting it", () => {
    const result = gateClaim(
      {
        text: "Built internal Python services and Kubernetes.",
        factIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"],
      },
      SAMPLE_FACTS,
      0,
    );
    expect(result.action).toBe("drop");
    expect(result.reasons.some((reason) => reason.startsWith("unbacked_tool:Kubernetes"))).toBe(true);
    expect(result.text).toBe("");
  });

  it("salvage keeps reverted lines and removes dropped lines", () => {
    const report = gateMaterials(
      {
        bullets: [
          {
            text: `Cut p95 latency by 40% on the billing API. [[fact:${FACT_METRIC}]]`,
            factIds: [FACT_METRIC],
          },
          {
            text: "Built internal Python services and Kubernetes.",
            factIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"],
          },
        ],
        cover: [],
      },
      SAMPLE_FACTS,
    );
    const saved = salvageDraft(report);
    expect(saved.bullets).toHaveLength(1);
    expect(saved.bullets[0].text).not.toContain("40%");
    expect(saved.bullets[0].text).not.toContain("Kubernetes");
    expect(isApprovable(gateMaterials(saved, SAMPLE_FACTS))).toBe(true);
  });
});
