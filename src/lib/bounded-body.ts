/** Read a request body with an actual byte limit, including chunked requests without Content-Length. */
export async function boundedBody(request: Pick<Request, "body">, limit: number): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new RangeError("Request body is too large"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
