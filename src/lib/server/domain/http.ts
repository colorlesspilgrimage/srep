export async function readBytesLimited(request: Request, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    return null;
  }
  if (request.body === null) {
    return Buffer.alloc(0);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
