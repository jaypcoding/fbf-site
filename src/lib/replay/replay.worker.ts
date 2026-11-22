// Web Worker: checks and pre-analyses a recording in the browser before upload
// (signature, version, size, SHA-256 and a quick summary) without freezing the
// page. The official analysis is always redone on the server.
import { analyzeReplay, ReplayError } from './analyze.ts';
import { sha256Hex } from './consolidate.ts';

export type WorkerRequest = { id: number; bytes: ArrayBuffer };
export type WorkerResponse =
  | { id: number; ok: true; sha256: string; durationSeconds: number; version: number; games: { clock: string; score: string; players: number }[] }
  | { id: number; ok: false; sha256: string | null; code: string; message: string };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, bytes } = event.data;
  const data = new Uint8Array(bytes);
  let sha: string | null = null;
  try {
    sha = await sha256Hex(data);
    const result = await analyzeReplay(data);
    const games = result.segments.filter((s) => s.playingTicks > 0).map((s) => ({
      clock: `${fmt(s.clockStart)}–${fmt(s.clockEnd)}`,
      score: `${s.score[0]} × ${s.score[1]}`,
      players: s.players.filter((p) => p.ticksRed + p.ticksBlue > 0).length,
    }));
    const reply: WorkerResponse = { id, ok: true, sha256: sha, durationSeconds: result.durationSeconds, version: result.header.version, games };
    (self as unknown as Worker).postMessage(reply);
  } catch (error) {
    const reply: WorkerResponse = {
      id, ok: false, sha256: sha,
      code: error instanceof ReplayError ? error.code : 'unexpected',
      message: error instanceof ReplayError ? error.message : 'Não foi possível ler a gravação',
    };
    (self as unknown as Worker).postMessage(reply);
  }
};
