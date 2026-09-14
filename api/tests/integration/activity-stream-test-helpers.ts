export async function withTestTimeout<T>(promise: Promise<T>, timeoutMs = 2_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out waiting for streamed Activity event")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function readSseEventFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  let body = "";
  while (true) {
    let boundary = body.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = body.slice(0, boundary);
      body = body.slice(boundary + 2);
      if (/^id:/m.test(frame) && /^data:/m.test(frame)) return frame;
      boundary = body.indexOf("\n\n");
    }
    const chunk = await withTestTimeout(reader.read());
    if (chunk.done) throw new Error("Activity SSE stream ended before an event frame arrived");
    body += decoder.decode(chunk.value, { stream: true });
  }
}
