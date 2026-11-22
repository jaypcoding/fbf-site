// Analysis of one .hbr2 recording: decode, replay every frame and collect the
// statistics of each game played in the file (a file may hold several games or
// only part of one).
import { ReplayError } from './binary.ts';
import { decodeReplay, readHeader, DEFAULT_LIMITS, type DecodeLimits } from './format.ts';
import { runReplay } from './engine.ts';
import { createStatsCollector, STATS_DEFINITION, type Segment } from './stats.ts';

export const ANALYZER_VERSION = 'fbf-replay-1.1.0';
export const ANALYSIS_SCHEMA = 2; // 2: per-second timeline (stats.ts Timeline)

export type FileAnalysis = {
  schema: number;
  analyzer: string;
  stats: string;
  header: { version: number; totalFrames: number; bytes: number };
  durationSeconds: number;
  roomName: string | null;
  goalMarkers: { frame: number; kind: number }[];
  segments: Segment[];
  simulateMs: number;
};

export { ReplayError, readHeader, DEFAULT_LIMITS };

export async function analyzeReplay(bytes: Uint8Array, options: { limits?: DecodeLimits; onProgress?: (fraction: number) => void } = {}): Promise<FileAnalysis> {
  const decoded = await decodeReplay(bytes, options.limits ?? DEFAULT_LIMITS);
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const stats = createStatsCollector();
  const room = decoded.room;
  stats.openInitial(room);
  const total = decoded.header.totalFrames;
  const step = Math.max(1, Math.floor(total / 50));
  stats.setFrame(0);
  runReplay(room, decoded.events, total, stats.listener, (frame) => {
    stats.setFrame(frame);
    if (options.onProgress && frame % step === 0) options.onProgress(frame / total);
  });
  const segments = stats.finish(room);
  options.onProgress?.(1);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    schema: ANALYSIS_SCHEMA,
    analyzer: ANALYZER_VERSION,
    stats: STATS_DEFINITION,
    header: { version: decoded.header.version, totalFrames: total, bytes: decoded.header.bytes },
    durationSeconds: Math.round((total / 60) * 10) / 10,
    roomName: decoded.room.name,
    goalMarkers: decoded.markers,
    segments,
    simulateMs: Math.round(t1 - t0),
  };
}
