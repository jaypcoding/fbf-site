// Raw DEFLATE decompression with a byte budget, using the platform
// DecompressionStream (browsers, Deno/Supabase Edge Functions and Node 18+), so
// the analyzer has no third-party dependency. The stream is cancelled as soon
// as the budget is exceeded: a small file holding a huge block of zeros cannot
// allocate gigabytes ("zip bomb").
import { ReplayError } from './binary.ts';

export type InflateBudget = { remaining: number };

export async function inflateRaw(data: Uint8Array, budget: InflateBudget): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      budget.remaining -= value.byteLength;
      if (budget.remaining < 0) {
        await reader.cancel().catch(() => {});
        throw new ReplayError('too_large', 'A gravação descompactada ultrapassa o limite de tamanho permitido');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ReplayError) throw error;
    throw new ReplayError('malformed', 'Os dados compactados da gravação estão corrompidos');
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
