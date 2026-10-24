// Frozen synthetic reply pilot, edition 1 (PLAN section 12): 10 messages per label, all invented, all for the
// selected application "Senior Frontend Engineer" at "Northwind Traders". Authored 2026-10-23; NOT YET RUN.
// Label convention: `expectedLabel` is what the CURRENT (unquoted, unsigned) message itself says. Quoted-only,
// signature-only, negated, and vague or general hints of an outcome (rejection/interview/offer) carry
// `unknown`. Courtesy receipts ("thanks for your interest", "we'll be in touch") stay `acknowledgement` and
// are expected to go to review. `expectReview` follows PLAN section 8 only (explicit current-message
// evidence, application named when an outcome is claimed, no conflicting or negated label), never the
// classifier's own rule tiers. Plain job alerts and newsletters are clearly not about the application, so
// no review is expected for them. A message about another company keeps its
// content label (it really is, say, a rejection) and is marked `expectReview`, because it must not be
// confirmed against the selected application. `expectReview` is reported separately from label accuracy
// (PLAN section 8: needs_review is separate from the label).
import type { ReplyLabel } from "../supabase/functions/_shared/provenance/types.ts";

export interface ReplyCase {
  id: string;
  origin: "authored-synthetic";
  category: string;
  body: string;
  expectedLabel: ReplyLabel;
  expectReview: boolean;
  whatBugThisCatches: string;
}

export const REPLY_CONTEXT = { organisation: "Northwind Traders", title: "Senior Frontend Engineer" };

function c(id: string, category: string, expectedLabel: ReplyLabel, expectReview: boolean, body: string, bug: string): ReplyCase {
  return { id, origin: "authored-synthetic", category, body, expectedLabel, expectReview, whatBugThisCatches: bug };
}

export const REPLY_CASES: ReplyCase[] = [
  // rejection
  c("r-rej01", "clear", "rejection", false, "Thank you for applying to Northwind Traders. Unfortunately, we will not be moving forward with your application.", "Courtesy phrase competing with a clear rejection."),
  c("r-rej02", "clear", "rejection", false, "We regret to inform you that the Senior Frontend Engineer position has been filled.", "Missing a standard rejection phrase."),
  c("r-rej03", "clear", "rejection", false, "After careful review, Northwind Traders has decided to move forward with other candidates.", "Missing 'other candidates' decision wording."),
  c("r-rej04", "clear", "rejection", false, "Hi Avery, we won't be moving forward with the Senior Frontend Engineer role at this time.", "Contraction 'won't' not recognized."),
  c("r-rej05", "clear", "rejection", false, "Northwind Traders will not be proceeding with your application.", "Formal 'not proceeding' wording missed."),
  c("r-rej06", "wrong_context", "rejection", true, "Thank you for applying to Contoso. We will not be moving forward.", "A rejection for another company auto-confirmed."),
  c("r-unk11", "quoted_only", "unknown", true, "Any update?\n\nOn Tue, Oct 21, 2026, Northwind Recruiting wrote:\n> We will not be moving forward with your application.", "An old quoted rejection read as new."),
  c("r-unk12", "vague", "unknown", true, "Unfortunately the team is busy this week.", "A weak word treated as strong evidence."),
  c("r-rej09", "clear", "rejection", false, "We are unable to offer you the Senior Frontend Engineer role.", "'unable to offer' read as an offer."),
  c("r-rej10", "contrast", "rejection", true, "Northwind Traders will not be moving forward with this role, but we would like to schedule a call about another.", "Contrast with an interview signal auto-confirmed."),
  c("r-rej11", "clear", "rejection", false, "We have decided to pursue other candidates for the Senior Frontend Engineer role.", "Missing 'pursue other candidates' decision wording."),
  c("r-rej12", "clear", "rejection", false, "We regret to inform you that Northwind Traders will not be proceeding with your application.", "Two rejection phrases double-counted into a conflict."),
  // interview
  c("r-int01", "clear", "interview", false, "We would like to invite you to interview for the Senior Frontend Engineer role at Northwind Traders.", "Missing a standard invitation."),
  c("r-int02", "clear", "interview", false, "Can we schedule a call next week to discuss the Senior Frontend Engineer position?", "Missing scheduling wording."),
  c("r-int03", "clear", "interview", false, "Northwind Traders would like to move you to the next round.", "Missing 'next round'."),
  c("r-int04", "clear", "interview", false, "Please use this link to schedule your phone screen with Northwind Traders.", "Missing phone screen scheduling."),
  c("r-int05", "clear", "interview", false, "We'd like to invite you to an onsite for the Senior Frontend Engineer role.", "Missing onsite invitation."),
  c("r-unk20", "signature_only", "unknown", true, "Quick question about your availability.\n--\nNorthwind Recruiting | interview scheduling team", "A signature line read as an invitation."),
  c("r-unk13", "quoted_only", "unknown", true, "Following up.\n\nOn Mon, Oct 20, 2026, Northwind wrote:\n> We would like to invite you to interview.", "A quoted old invitation read as new."),
  c("r-int08", "wrong_context", "interview", true, "Contoso would like to schedule a call with you.", "Another company's invitation auto-confirmed."),
  c("r-unk14", "general", "unknown", true, "Interviews for several roles are happening soon.", "A bare word treated as an invitation."),
  c("r-unk15", "negated", "unknown", true, "There is no interview scheduled yet for the Senior Frontend Engineer role.", "A negated interview mention confirmed."),
  c("r-int11", "clear", "interview", false, "Northwind Traders would like to schedule an interview with you.", "Missing 'schedule an interview'."),
  c("r-int12", "clear", "interview", false, "Could we schedule a video call about the Senior Frontend Engineer role?", "Missing video-call scheduling."),
  c("r-int13", "wrong_context", "interview", true, "Contoso would like to invite you to interview.", "Another company's invitation auto-confirmed."),
  c("r-int14", "clear", "interview", false, "We'd like to schedule a phone screen for the Senior Frontend Engineer role.", "Missing phone-screen scheduling."),
  // offer
  c("r-off01", "clear", "offer", false, "Northwind Traders is pleased to offer you the Senior Frontend Engineer position.", "Missing a standard offer."),
  c("r-off02", "clear", "offer", false, "Please find attached your offer of employment from Northwind Traders.", "Missing 'offer of employment'."),
  c("r-off03", "clear", "offer", false, "We are pleased to extend you an offer for the Senior Frontend Engineer role.", "Missing 'extend an offer'."),
  c("r-off04", "attached", "offer", false, "Your offer letter for Northwind Traders is attached.", "An explicit attached offer letter missed or sent to review."),
  c("r-unk16", "negated", "unknown", true, "To be clear, this is not an offer for the Senior Frontend Engineer role.", "A negated offer confirmed."),
  c("r-unk17", "quoted_only", "unknown", true, "Following up on the note below.\n\nOn Mon, Oct 20, 2026, Northwind Recruiting wrote:\n> We are pleased to offer you the Senior Frontend Engineer role.", "A quoted offer read as new."),
  c("r-off07", "wrong_context", "offer", true, "Contoso is pleased to offer you the position.", "Another company's offer auto-confirmed."),
  c("r-off08", "clear", "offer", false, "Congratulations! Northwind Traders is pleased to offer you the role.", "Missing an offer with a greeting."),
  c("r-off09", "contrast", "offer", true, "We are pleased to offer you the Senior Frontend Engineer role, but we regret to inform you the start date moved.", "Mixed offer/rejection wording auto-confirmed."),
  c("r-off11", "clear", "offer", false, "Northwind Traders is pleased to extend an offer for the Senior Frontend Engineer role.", "Missing 'extend an offer' without 'you'."),
  c("r-off12", "clear", "offer", false, "Your offer of employment from Northwind Traders is enclosed.", "Missing an enclosed offer of employment."),
  c("r-off13", "wrong_context", "offer", true, "Fabrikam is pleased to offer you a role.", "Another company's offer auto-confirmed."),
  // acknowledgement
  c("r-ack01", "clear", "acknowledgement", false, "Thank you for applying to Northwind Traders. We have received your application.", "Missing a standard acknowledgement."),
  c("r-ack02", "clear", "acknowledgement", false, "We've received your application for the Senior Frontend Engineer role.", "Contraction 'We've' missed."),
  c("r-ack03", "clear", "acknowledgement", false, "Thank you for applying for the Senior Frontend Engineer position.", "Missing 'thank you for applying'."),
  c("r-ack04", "courtesy", "acknowledgement", true, "Thanks for your interest. We'll be in touch.", "Vague courtesy auto-confirmed."),
  c("r-ack05", "wrong_context", "acknowledgement", true, "Thank you for applying to Contoso.", "Another company's acknowledgement auto-confirmed."),
  c("r-ack06", "clear", "acknowledgement", false, "Northwind Traders received your application and will review it soon.", "Bare 'received your application' missed."),
  c("r-unk19", "quoted_only", "unknown", true, "Checking in.\n\nOn Sun, Oct 19, 2026, Northwind wrote:\n> We have received your application.", "A quoted acknowledgement read as new."),
  c("r-ack08", "courtesy", "acknowledgement", true, "Thanks for your interest in Northwind Traders.", "Interest courtesy treated as receipt."),
  c("r-ack09", "clear", "acknowledgement", false, "Hello Avery, thank you for applying to the Senior Frontend Engineer opening.", "Missing acknowledgement with a greeting."),
  c("r-ack10", "courtesy", "acknowledgement", true, "We will be in touch soon.", "A vague follow-up promise auto-confirmed."),
  c("r-ack11", "clear", "acknowledgement", false, "Northwind Traders: application received for Senior Frontend Engineer.", "Terse 'application received' subject-line style missed."),
  // not_applicable
  c("r-na01", "newsletter", "not_applicable", false, "Click here to unsubscribe from this newsletter.", "Newsletter not recognized."),
  c("r-na02", "account", "not_applicable", false, "Use this link for your password reset.", "Account email not recognized."),
  c("r-na03", "newsletter", "not_applicable", false, "The Northwind Traders monthly newsletter is here.", "Company newsletter mistaken for a reply."),
  c("r-na04", "alert", "not_applicable", false, "Recommended jobs for you this week.", "A job alert mistaken for an application reply."),
  c("r-na05", "alert", "not_applicable", false, "Your daily job alert: 12 new roles.", "A job alert mistaken for an application reply."),
  c("r-na06", "newsletter", "not_applicable", false, "You can unsubscribe at any time using the link below.", "Unsubscribe footer missed."),
  c("r-na07", "mixed", "not_applicable", true, "Newsletter: we would like to invite you to interview at our open house. Unsubscribe below.", "Marketing mixed with interview wording auto-confirmed."),
  c("r-na08", "account", "not_applicable", false, "Your password reset request was received.", "Account email not recognized."),
  c("r-na09", "alert", "not_applicable", false, "Jobs you may like at Contoso and Fabrikam.", "A job alert mistaken for an application reply."),
  c("r-na10", "newsletter", "not_applicable", false, "Read our newsletter for hiring tips.", "Newsletter not recognized."),
  // unknown
  c("r-unk07", "quoted_only", "unknown", true, "See below.\n\nOn Fri, Oct 17, 2026, Northwind wrote:\n> Thank you for applying.", "A quoted-only courtesy assigned a label."),
];
