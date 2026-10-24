import { describe, expect, it } from "vitest";
import {
  statusAfterApproval,
  statusAfterConfirmedReply,
} from "../supabase/functions/_shared/provenance/board.ts";
import { classifyReply } from "../supabase/functions/_shared/provenance/classify.ts";
import { SAMPLE_EMAILS } from "../supabase/functions/_shared/provenance/fixtures.ts";
import { gateScores, macroF1 } from "../supabase/functions/_shared/provenance/metrics.ts";
import { containsPhrase, numericTokens } from "../supabase/functions/_shared/provenance/normalize.ts";

describe("reply classifier", () => {
  it("labels the synthetic emails and holds weak or mixed notes for review", () => {
    for (const email of SAMPLE_EMAILS) {
      const result = classifyReply(email.text);
      expect(result.label, email.name).toBe(email.label);
      expect(result.needsReview, email.name).toBe(email.needsReview);
    }
    expect(classifyReply("").needsReview).toBe(true);
    expect(classifyReply(SAMPLE_EMAILS[0].text).confidence).toBe(0.92);
    expect(classifyReply(SAMPLE_EMAILS[6].text).confidence).toBe(0.45);
    expect(classifyReply(SAMPLE_EMAILS[7].text).confidence).toBe(0.72);
  });

  it("does not count the short interview word inside a longer phrase twice", () => {
    const result = classifyReply("We invite you to interview next week.");
    expect(result.label).toBe("interview");
    expect(result.confidence).toBe(0.92);
    expect(result.hits).toEqual(["invite you to interview"]);
  });
});

describe("board transitions", () => {
  it("lets a person confirm a status without moving a withdrawn or rejected card backward", () => {
    expect(statusAfterApproval("draft")).toBe("approved");
    expect(statusAfterApproval("interview")).toBe("interview");
    expect(statusAfterConfirmedReply("withdrawn", "rejected")).toBe("withdrawn");
    expect(statusAfterConfirmedReply("offer", "rejected")).toBe("rejected");
    expect(statusAfterConfirmedReply("rejected", "interview")).toBe("rejected");
    expect(statusAfterConfirmedReply("offer", "interview")).toBe("offer");
    expect(statusAfterConfirmedReply("interview", "acknowledgement")).toBe("interview");
    expect(statusAfterConfirmedReply("draft", "acknowledgement")).toBe("applied");
    expect(statusAfterConfirmedReply("approved", "not_applicable")).toBe("approved");
  });
});

describe("metric helpers", () => {
  it("computes block rates and macro-F1 from counted cells", () => {
    const actual = gateScores([
      { expectedBlock: true, blocked: true },
      { expectedBlock: true, blocked: true },
      { expectedBlock: false, blocked: false },
      { expectedBlock: false, blocked: true },
    ]);
    expect(actual.truePositive).toBe(2);
    expect(actual.falsePositive).toBe(1);
    expect(actual.falseNegative).toBe(0);
    expect(actual.trueNegative).toBe(1);
    expect(actual.blockRate).toBe(1);
    expect(actual.falseBlockRate).toBe(0.5);
    expect(actual.precision).toBeCloseTo(2 / 3);
    expect(actual.recall).toBe(1);
    expect(macroF1(
      [
        { expected: "A", predicted: "A" },
        { expected: "B", predicted: "A" },
      ],
      ["A", "B"],
    )).toBeCloseTo(1 / 3);
  });

  it("does not treat a letter-glued digit or a prefix as its own claim", () => {
    expect(numericTokens("p95 latency by 12%")).toEqual([{ raw: "12%", core: "12" }]);
    expect(containsPhrase("JavaScript services", "Java")).toBe(false);
    expect(containsPhrase("Built internal Python services.", "Python services")).toBe(true);
  });
});
