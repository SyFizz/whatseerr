export interface FetchImageOptions {
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}

/** Downloads an image (the TMDB poster) into memory, with a timeout and a size cap. */
export async function fetchImage(url: string, options: FetchImageOptions = {}): Promise<Buffer> {
  const { timeoutMs = 10_000, maxBytes = 5 * 1024 * 1024, fetchImpl = fetch } = options;

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`Image download failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Unexpected image content type: ${contentType || 'none'}`);
  }
  if (Number(response.headers.get('content-length')) > maxBytes) {
    throw new Error(`Image exceeds ${maxBytes} bytes`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new Error(`Image exceeds ${maxBytes} bytes`);
  }
  return buffer;
}
