export function float32VectorToBuffer(values: readonly number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer);
}

export function vectorToJson(values: readonly number[]): string {
  return JSON.stringify(values);
}

export function toVectorBlob(vector: Buffer | readonly number[]): Buffer {
  return Buffer.isBuffer(vector) ? vector : float32VectorToBuffer(vector);
}

export function fromVectorBlob(blob: Buffer): number[] {
  if (blob.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error("Vector blob byte length must be divisible by 4");
  }

  const view = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  return Array.from(view);
}

export function toVectorMatchValue(vector: Buffer | readonly number[]): Buffer | string {
  return Buffer.isBuffer(vector) ? vector : vectorToJson(vector);
}
