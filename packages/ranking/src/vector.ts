export class VectorDimensionMismatchError extends Error {
  constructor(leftDimension: number, rightDimension: number) {
    super(`Vector dimension mismatch: ${leftDimension} != ${rightDimension}`);
    this.name = "VectorDimensionMismatchError";
  }
}

export function assertSameDimension(left: readonly number[], right: readonly number[]): void {
  if (left.length !== right.length) {
    throw new VectorDimensionMismatchError(left.length, right.length);
  }
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  assertSameDimension(left, right);
  if (left.length === 0) {
    return 0;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

export function normalizeVector(vector: readonly number[]): number[] {
  let magnitude = 0;
  for (const value of vector) {
    magnitude += value * value;
  }

  if (magnitude === 0) {
    return Array.from(vector);
  }

  const scale = 1 / Math.sqrt(magnitude);
  return vector.map((value) => value * scale);
}

export function mergeCentroid(
  currentCentroid: readonly number[],
  nextVector: readonly number[],
  learningRate: number
): number[] {
  assertSameDimension(currentCentroid, nextVector);
  const clampedLearningRate = Math.min(Math.max(learningRate, 0), 1);
  const merged = currentCentroid.map(
    (value, index) => value * (1 - clampedLearningRate) + nextVector[index] * clampedLearningRate
  );
  return normalizeVector(merged);
}
