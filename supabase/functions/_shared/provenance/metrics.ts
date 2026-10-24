export interface GateScore {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  trueNegative: number;
  blockRate: number | null;
  falseBlockRate: number | null;
  precision: number | null;
  recall: number | null;
}

export function gateScores(cases: Array<{ expectedBlock: boolean; blocked: boolean }>): GateScore {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  for (const item of cases) {
    if (item.expectedBlock && item.blocked) truePositive += 1;
    else if (!item.expectedBlock && item.blocked) falsePositive += 1;
    else if (item.expectedBlock && !item.blocked) falseNegative += 1;
    else trueNegative += 1;
  }
  const expectedBlock = truePositive + falseNegative;
  const expectedPass = trueNegative + falsePositive;
  const predictedBlock = truePositive + falsePositive;
  return {
    truePositive,
    falsePositive,
    falseNegative,
    trueNegative,
    blockRate: expectedBlock === 0 ? null : truePositive / expectedBlock,
    falseBlockRate: expectedPass === 0 ? null : falsePositive / expectedPass,
    precision: predictedBlock === 0 ? null : truePositive / predictedBlock,
    recall: expectedBlock === 0 ? null : truePositive / expectedBlock,
  };
}

export function macroF1(
  cases: Array<{ expected: string; predicted: string }>,
  labels: string[],
): number | null {
  if (cases.length === 0) return null;
  let sum = 0;
  let counted = 0;
  for (const label of labels) {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    for (const item of cases) {
      if (item.predicted === label && item.expected === label) truePositive += 1;
      else if (item.predicted === label && item.expected !== label) falsePositive += 1;
      else if (item.predicted !== label && item.expected === label) falseNegative += 1;
    }
    const support = truePositive + falseNegative;
    if (support === 0) continue;
    counted += 1;
    const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
    const recall = truePositive / support;
    sum += precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  }
  return counted === 0 ? null : sum / counted;
}

// Reply evaluation (PLAN section 12). Rates are null when their denominator is zero (reported as "n/a").
export interface ReplyClassMetric {
  label: string;
  support: number;
  precision: number | null;
  recall: number | null;
}

export interface ReplyMetrics {
  total: number;
  perClass: ReplyClassMetric[];
  macroF1: number | null;
  reviewRate: number | null;
  nonReviewCount: number;
  nonReviewAccuracy: number | null;
}

export function replyMetrics(
  cases: Array<{ expected: string; predicted: string; needsReview: boolean }>,
  labels: string[],
): ReplyMetrics {
  const perClass = labels.map((label) => {
    const truePositive = cases.filter((item) => item.predicted === label && item.expected === label).length;
    const predicted = cases.filter((item) => item.predicted === label).length;
    const support = cases.filter((item) => item.expected === label).length;
    return {
      label,
      support,
      precision: predicted === 0 ? null : truePositive / predicted,
      recall: support === 0 ? null : truePositive / support,
    };
  });
  const nonReview = cases.filter((item) => !item.needsReview);
  return {
    total: cases.length,
    perClass,
    macroF1: macroF1(cases, labels),
    reviewRate: cases.length === 0 ? null : (cases.length - nonReview.length) / cases.length,
    nonReviewCount: nonReview.length,
    nonReviewAccuracy: nonReview.length === 0 ? null : nonReview.filter((item) => item.expected === item.predicted).length / nonReview.length,
  };
}

// Guard aggregate: original rejection and accepted replacement are reported separately.
export interface GuardAggregate {
  unsupportedTotal: number;
  unsupportedBlocked: number;
  supportedTotal: number;
  supportedBlocked: number;
  recoveryOffered: number;
  confusion: GateScore;
}

export function guardAggregate(
  cases: Array<{ expectedBlock: boolean; blocked: boolean; recoveryOffered: boolean }>,
): GuardAggregate {
  return {
    unsupportedTotal: cases.filter((item) => item.expectedBlock).length,
    unsupportedBlocked: cases.filter((item) => item.expectedBlock && item.blocked).length,
    supportedTotal: cases.filter((item) => !item.expectedBlock).length,
    supportedBlocked: cases.filter((item) => !item.expectedBlock && item.blocked).length,
    recoveryOffered: cases.filter((item) => item.blocked && item.recoveryOffered).length,
    confusion: gateScores(cases),
  };
}
