// Browser side of the match sheet from recordings: local checks in a Web
// Worker, upload to the private bucket, registration and server processing.
import { supabase, supabaseProject } from './supabase';
import type { WorkerRequest, WorkerResponse } from './replay/replay.worker';
import type { MatchSheet, ReviewDecisions } from './replay/consolidate';

export const MAX_REPLAY_BYTES = 20 * 1024 * 1024;
export const REPLAY_BUCKET = 'match-replays';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (r: WorkerResponse) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./replay/replay.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const resolve = pending.get(event.data.id);
      if (resolve) { pending.delete(event.data.id); resolve(event.data); }
    };
  }
  return worker;
}

/** Local check: signature, version, structure and summary (does not upload anything). */
export async function inspectReplayFile(file: File): Promise<WorkerResponse> {
  if (file.size === 0) return { id: 0, ok: false, sha256: null, code: 'empty_file', message: 'O arquivo está vazio' };
  if (file.size > MAX_REPLAY_BYTES) return { id: 0, ok: false, sha256: null, code: 'too_large', message: 'O arquivo é maior que 20 MB' };
  const bytes = await file.arrayBuffer();
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const request: WorkerRequest = { id, bytes };
    getWorker().postMessage(request, [bytes]);
  });
}

function uploadWithProgress(path: string, file: File, token: string, onProgress: (fraction: number) => void): Promise<'uploaded' | 'exists'> {
  const url = `${supabaseProject.url.replace(/\/+$/, '')}/storage/v1/object/${REPLAY_BUCKET}/${path}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', supabaseProject.anonKey);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { onProgress(1); resolve('uploaded'); return; }
      // the same file (same hash) was stored before: the stored copy is identical
      if (xhr.status === 409 || /already exists|Duplicate/i.test(xhr.responseText)) { onProgress(1); resolve('exists'); return; }
      reject(new Error(xhr.status === 403 ? 'Sem permissão para enviar gravações desta partida' : 'Falha no envio do arquivo'));
    };
    xhr.onerror = () => reject(new Error('Falha de conexão durante o envio'));
    xhr.send(file);
  });
}

export type UploadStep = 'checking' | 'uploading' | 'registering' | 'analyzing' | 'done' | 'error';

export async function uploadReplay(matchId: string, file: File, sha256: string, onStep: (step: UploadStep, progress?: number) => void): Promise<{ replayId: string; usedInOtherMatch: boolean }> {
  const { data: session } = await supabase.auth.getSession();
  const token = session.session?.access_token;
  if (!token) throw new Error('Entre na sua conta para enviar gravações');
  const path = `${matchId}/${sha256}.hbr2`;
  onStep('uploading', 0);
  await uploadWithProgress(path, file, token, (p) => onStep('uploading', p));
  onStep('registering');
  const { data, error } = await supabase.rpc('register_match_replay', {
    p_match_id: matchId,
    p_storage_path: path,
    p_original_name: file.name,
    p_size_bytes: file.size,
    p_sha256: sha256,
    p_file_last_modified: file.lastModified ? new Date(file.lastModified).toISOString() : null,
  });
  if (error) throw new Error(error.message || 'Não foi possível registrar a gravação');
  const result = data as { replay_id: string; used_in_other_match: boolean };
  onStep('analyzing');
  await processReplay({ action: 'analyze', replay_id: result.replay_id });
  onStep('done');
  return { replayId: result.replay_id, usedInOtherMatch: result.used_in_other_match };
}

type ProcessResult = { sheet: (MatchSheet & { analyzer?: string }) | null; hash: string | null; stale?: boolean; error?: string };

export async function processReplay(body: { action: 'analyze'; replay_id: string } | { action: 'build'; match_id: string }): Promise<ProcessResult> {
  const { data, error } = await supabase.functions.invoke('replay-process', { body });
  if (error) {
    let message = 'O servidor não conseguiu processar a gravação';
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === 'function') {
        const parsed = await ctx.json();
        if (parsed?.stale) return { sheet: null, hash: null, stale: true };
        if (parsed?.error) message = parsed.error;
      }
    } catch { /* keep default message */ }
    throw new Error(message);
  }
  return data as ProcessResult;
}

/** Rebuilds the sheet; retries when decisions changed during processing. */
export async function rebuildSheet(matchId: string): Promise<ProcessResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await processReplay({ action: 'build', match_id: matchId });
    if (!result.stale) return result;
  }
  throw new Error('A súmula mudou várias vezes durante o processamento; tente novamente');
}

export async function saveDecisions(matchId: string, decisions: ReviewDecisions): Promise<void> {
  const { error } = await supabase.rpc('save_match_replay_decisions', { p_match_id: matchId, p_decisions: decisions });
  if (error) throw new Error(error.message || 'Não foi possível salvar a decisão');
}

export async function removeReplay(replayId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('remove_match_replay', { p_replay_id: replayId, p_reason: reason });
  if (error) throw new Error(error.message || 'Não foi possível remover a gravação');
}

export async function cancelReview(matchId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_match_replay_review', { p_match_id: matchId, p_reason: reason });
  if (error) throw new Error(error.message || 'Não foi possível cancelar a análise');
}

export async function confirmReview(matchId: string, hash: string): Promise<{ home_score: number; away_score: number; goals: number }> {
  const { data, error } = await supabase.rpc('confirm_match_replay_review', { p_match_id: matchId, p_sheet_hash: hash });
  if (error) throw new Error(error.message || 'Não foi possível confirmar a súmula');
  return data as { home_score: number; away_score: number; goals: number };
}

/** Temporary link (5 minutes) to download a private recording. */
export async function replayDownloadUrl(storagePath: string, name: string): Promise<string> {
  const { data, error } = await supabase.storage.from(REPLAY_BUCKET).createSignedUrl(storagePath, 300, { download: name });
  if (error || !data) throw new Error('Não foi possível gerar o link da gravação');
  return data.signedUrl;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
