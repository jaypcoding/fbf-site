// Recordings shared on THEHAX Replay (https://replay.thehax.pl): a public link
// is only another source of the same .hbr2 file. This module validates the
// link and downloads the original file; the bytes then follow exactly the same
// path as a file chosen on the computer (local check, private upload,
// registration, server analysis).
//
// Runs on the server (Edge Function, Deno) and is tested in Node. Safety:
//   * only https://replay.thehax.pl/<uuid> links; the download address is
//     always built here from the validated id (the pasted text is never
//     fetched), so no arbitrary host, port or path can be requested;
//   * redirects are refused (no hop to another domain);
//   * timeout covering the whole transfer and a byte limit enforced while
//     reading (the declared Content-Length is not trusted either);
//   * the content must carry the HBR2 signature and a supported version
//     (Content-Type is ignored: THEHAX answers unknown ids with an HTML page
//     and status 200).
import { ReplayError } from './binary.ts';
import { readHeader, SUPPORTED_VERSIONS, type ReplayHeader } from './format.ts';

export const THEHAX_HOST = 'replay.thehax.pl';
export const THEHAX_TIMEOUT_MS = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type TheHaxErrorCode =
  | 'invalid_link' | 'not_found' | 'unavailable' | 'redirect' | 'timeout' | 'network' | 'too_large' | 'invalid_file' | 'unsupported_version';

export class TheHaxError extends Error {
  code: TheHaxErrorCode;
  constructor(code: TheHaxErrorCode, message: string) {
    super(message);
    this.name = 'TheHaxError';
    this.code = code;
  }
}

/** HTTP status the Edge Function answers for each failure. */
export const THEHAX_ERROR_STATUS: Record<TheHaxErrorCode, number> = {
  invalid_link: 400, not_found: 404, too_large: 413, invalid_file: 422, unsupported_version: 422,
  redirect: 502, unavailable: 502, network: 502, timeout: 504,
};

/** Validates a pasted THEHAX link and returns the replay id (lower case). */
export function parseTheHaxLink(input: string): string {
  const text = String(input ?? '').trim();
  if (!text) throw new TheHaxError('invalid_link', 'Cole o link do replay do THEHAX');
  if (text.length > 300) throw new TheHaxError('invalid_link', 'O link é longo demais para ser um replay do THEHAX');
  // a link copied without the scheme ("replay.thehax.pl/<id>") is accepted as https
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try { url = new URL(withScheme); } catch { throw new TheHaxError('invalid_link', 'Link inválido. Use o endereço do replay, por exemplo https://replay.thehax.pl/3e2441ec-fe87-4468-a857-d09ad580dce5'); }
  if (url.hostname.toLowerCase() !== THEHAX_HOST) throw new TheHaxError('invalid_link', `Somente links do THEHAX Replay (${THEHAX_HOST}) são aceitos`);
  if (url.protocol !== 'https:') throw new TheHaxError('invalid_link', 'O link precisa começar com https://');
  if (url.username || url.password || url.port) throw new TheHaxError('invalid_link', 'Link inválido: use o endereço do replay sem usuário, senha ou porta');
  const match = /^\/([^/]+)(?:\/download)?\/?$/.exec(url.pathname);
  const id = match ? match[1].toLowerCase() : '';
  if (!UUID.test(id)) throw new TheHaxError('invalid_link', 'O link não contém um identificador de replay válido (formato https://replay.thehax.pl/<id>)');
  return id;
}

export const theHaxPageUrl = (id: string) => `https://${THEHAX_HOST}/${id}`;
export const theHaxDownloadUrl = (id: string) => {
  if (!UUID.test(id)) throw new TheHaxError('invalid_link', 'Identificador de replay inválido');
  return `https://${THEHAX_HOST}/${id}/download`;
};

/** Original file name from Content-Disposition, reduced to safe characters. */
export function replayFileName(contentDisposition: string | null, id: string): string {
  const fallback = `thehax-${id}.hbr2`;
  if (!contentDisposition) return fallback;
  let name = '';
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(contentDisposition);
  if (star) { try { name = decodeURIComponent(star[1].trim()); } catch { name = ''; } }
  if (!name) {
    const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(contentDisposition);
    name = plain ? (plain[2] ?? plain[1]).trim() : '';
  }
  name = name.split(/[\\/]/).pop() ?? '';
  name = name.replace(/[^A-Za-z0-9._() -]/g, '_').replace(/^[.\s]+/, '').slice(0, 120);
  if (!/\.hbr2$/i.test(name)) return fallback;
  return name;
}

export type TheHaxDownload = { id: string; bytes: Uint8Array; name: string; lastModified: number | null; header: ReplayHeader };
export type TheHaxOptions = { maxBytes: number; timeoutMs?: number; fetchImpl?: typeof fetch };

/** Downloads and validates the original .hbr2 file of a THEHAX replay. */
export async function downloadTheHaxReplay(id: string, options: TheHaxOptions): Promise<TheHaxDownload> {
  const url = theHaxDownloadUrl(id);
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? THEHAX_TIMEOUT_MS);
  const limitMb = options.maxBytes >= 1024 * 1024 ? `${Math.round(options.maxBytes / 1024 / 1024)}` : (options.maxBytes / 1024 / 1024).toFixed(2);
  try {
    let response: Response;
    try {
      response = await doFetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { Accept: 'application/octet-stream' } });
    } catch {
      if (controller.signal.aborted) throw new TheHaxError('timeout', 'O THEHAX demorou demais para responder. Tente novamente em instantes.');
      throw new TheHaxError('network', 'Não foi possível conectar ao THEHAX. Tente novamente em instantes.');
    }
    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel().catch(() => {});
      throw new TheHaxError('redirect', 'O THEHAX respondeu com um redirecionamento, que não é seguido por segurança. Confira o link do replay.');
    }
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel().catch(() => {});
      throw new TheHaxError('not_found', 'Replay não encontrado no THEHAX (o link não existe ou o replay foi removido).');
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      throw new TheHaxError('unavailable', `O THEHAX não entregou o replay agora (resposta ${response.status}). Tente novamente mais tarde.`);
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new TheHaxError('too_large', `O replay é maior que ${limitMb} MB`);
    }
    const bytes = await readLimited(response, options.maxBytes, limitMb, controller.signal);
    if (bytes.byteLength === 0) throw new TheHaxError('invalid_file', 'O THEHAX entregou um arquivo vazio para este replay.');
    let header: ReplayHeader;
    try {
      header = readHeader(bytes);
    } catch (e) {
      // unknown ids come back as an HTML page with status 200
      const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart().toLowerCase();
      if (head.startsWith('<')) throw new TheHaxError('not_found', 'Replay não encontrado no THEHAX (o link não existe, foi removido ou não está disponível para download).');
      throw new TheHaxError('invalid_file', e instanceof ReplayError ? e.message : 'O conteúdo recebido não é uma gravação .hbr2 do HaxBall');
    }
    if (!(SUPPORTED_VERSIONS as readonly number[]).includes(header.version)) {
      if (header.version === 0 || header.version > 100) throw new TheHaxError('invalid_file', 'O arquivo recebido não é uma gravação .hbr2 válida (cabeçalho corrompido)');
      throw new TheHaxError('unsupported_version', `Versão de gravação não suportada (${header.version}); o FBF lê a versão 3 (.hbr2)`);
    }
    const lm = Date.parse(response.headers.get('last-modified') ?? '');
    return { id, bytes, name: replayFileName(response.headers.get('content-disposition'), id), lastModified: Number.isFinite(lm) ? lm : null, header };
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(response: Response, maxBytes: number, limitMb: string, signal: AbortSignal): Promise<Uint8Array> {
  const timeout = () => new TheHaxError('timeout', 'O download do replay no THEHAX demorou demais. Tente novamente em instantes.');
  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new TheHaxError('too_large', `O replay é maior que ${limitMb} MB`);
    return buf;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      let part: ReadableStreamReadResult<Uint8Array>;
      try { part = await reader.read(); } catch { throw signal.aborted ? timeout() : new TheHaxError('network', 'A conexão com o THEHAX caiu durante o download. Tente novamente.'); }
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new TheHaxError('too_large', `O replay é maior que ${limitMb} MB`); }
      chunks.push(part.value);
    }
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
  if (signal.aborted) throw timeout();
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.byteLength; }
  return out;
}
