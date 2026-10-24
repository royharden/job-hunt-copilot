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
