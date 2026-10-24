import type { BoardStatus, ReplyLabel } from "./types.ts";

export function statusAfterApproval(current: BoardStatus): BoardStatus {
  if (current === "draft") return "approved";
  return current;
}

export function statusAfterConfirmedReply(current: BoardStatus, label: ReplyLabel): BoardStatus {
  if (current === "withdrawn") return current;
  if (label === "not_applicable" || label === "unknown") return current;
  if (label === "rejected") return "rejected";
  if (current === "rejected") return current;
  if (label === "offer") return "offer";
  if (label === "interview") {
    if (current === "offer") return current;
    return "interview";
  }
  if (label === "acknowledgement") {
    if (current === "draft" || current === "approved") return "applied";
    return current;
  }
  return current;
}

export function shouldReplaceDraftLink(linkedIsApproved: boolean): boolean {
  return !linkedIsApproved;
}
