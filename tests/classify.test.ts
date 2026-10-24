import { describe, expect, it } from "vitest";
import { classifyReply } from "../supabase/functions/_shared/provenance/classify.ts";
import { SAMPLE_REPLIES } from "../supabase/functions/_shared/provenance/fixtures.ts";

const context = { organisation: "Northwind Traders", title: "Senior Frontend Engineer" };

describe("reply rules", () => {
  it("confirms a clear rejection that names the application as strong rule evidence", () => {
    const result = classifyReply(SAMPLE_REPLIES.rejection, context);
    expect(result.label).toBe("rejection");
    expect(result.strength).toBe("strong");
    expect(result.needsReview).toBe(false);
    expect(result.hits.some((hit) => hit.ruleId === "rej.not_moving_forward" && hit.ignored === null)).toBe(true);
    const span = result.hits.find((hit) => hit.ruleId === "rej.not_moving_forward")!;
    expect(SAMPLE_REPLIES.rejection.slice(span.start, span.end)).toBe(span.text);
    // the courtesy "Thank you for applying" does not compete with the outcome
    expect(result.hits.find((hit) => hit.label === "acknowledgement")?.ignored).toBe("courtesy");
  });

  it("keeps a vague reply in review", () => {
    const result = classifyReply(SAMPLE_REPLIES.vague, context);
    expect(result.label).toBe("acknowledgement");
    expect(result.needsReview).toBe(true);
    expect(result.strength).toBe("weak");
  });

  // what_bug_this_catches: an offer quoted from earlier mail being read as a new offer.
  it("ignores phrases inside quoted mail", () => {
    const result = classifyReply(SAMPLE_REPLIES.quoted, context);
    expect(result.label).toBe("unknown");
    expect(result.needsReview).toBe(true);
    expect(result.hits.every((hit) => hit.ignored === "quoted")).toBe(true);
  });

  it("abstains on negation, contrast, missing context and the wrong organisation", () => {
    expect(classifyReply("To be clear, this is not an offer for the Senior Frontend Engineer role.", context).needsReview).toBe(true);
    const contrast = classifyReply(
      "Northwind Traders will not be moving forward with this role, but we would like to schedule a call about another.",
      context,
    );
    expect(contrast.needsReview).toBe(true);
    expect(contrast.reasons.join(" ")).toMatch(/Conflicting labels/);
    expect(classifyReply(SAMPLE_REPLIES.rejection, null).needsReview).toBe(true);
    const otherCompany = classifyReply("Thank you for applying to Contoso. We will not be moving forward.", context);
    expect(otherCompany.label).toBe("rejection");
    expect(otherCompany.needsReview).toBe(true);
  });

  it("covers every label", () => {
    expect(classifyReply("We would like to invite you to interview for the Senior Frontend Engineer role.", context).label).toBe("interview");
    expect(classifyReply("Northwind Traders is pleased to offer you the position.", context).label).toBe("offer");
    expect(classifyReply("We have received your application to Northwind Traders.", context).label).toBe("acknowledgement");
    expect(classifyReply("Click here to unsubscribe from this newsletter.", context).label).toBe("not_applicable");
    expect(classifyReply("Lovely weather today.", context).label).toBe("unknown");
    expect(classifyReply("", context).strength).toBe("none");
  });

  it("ignores phrases in the signature block", () => {
    const result = classifyReply("Quick question about your availability for Northwind Traders.\n--\nRecruiting | interview scheduling team", context);
    expect(result.hits.every((hit) => hit.ignored === "signature")).toBe(true);
  });
});
