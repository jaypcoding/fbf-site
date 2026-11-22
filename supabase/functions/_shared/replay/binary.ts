// Binary reader for HaxBall replay data (big-endian, LEB128-style varints,
// UTF-8 strings). Independent FBF implementation; every read is bounds-checked
// so a truncated or malformed file fails with a ReplayError instead of reading
// past the buffer.

export type ReplayErrorCode =
  | 'empty_file'
  | 'bad_signature'
  | 'unsupported_version'
  | 'truncated'
  | 'malformed'
  | 'too_large'
  | 'too_long'
  | 'too_many_events'
  | 'unsupported_feature';

export class ReplayError extends Error {
  code: ReplayErrorCode;
  constructor(code: ReplayErrorCode, message: string) {
    super(message);
    this.name = 'ReplayError';
    this.code = code;
  }
}

const decoder = new TextDecoder('utf-8', { fatal: false });

export class Reader {
  view: DataView;
  pos: number;

  constructor(bytes: Uint8Array, start = 0) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = start;
  }

  get remaining(): number {
    return this.view.byteLength - this.pos;
  }

  private need(n: number): void {
    if (n < 0 || this.pos + n > this.view.byteLength) {
      throw new ReplayError('truncated', `Gravação incompleta: faltam dados na posição ${this.pos}`);
    }
  }

  u8(): number { this.need(1); return this.view.getUint8(this.pos++); }
  i8(): number { this.need(1); return this.view.getInt8(this.pos++); }
  bool(): boolean { return this.u8() !== 0; }
  u16(): number { this.need(2); const v = this.view.getUint16(this.pos); this.pos += 2; return v; }
  i16(): number { this.need(2); const v = this.view.getInt16(this.pos); this.pos += 2; return v; }
  u32(): number { this.need(4); const v = this.view.getUint32(this.pos); this.pos += 4; return v; }
  i32(): number { this.need(4); const v = this.view.getInt32(this.pos); this.pos += 4; return v; }
  f32(): number { this.need(4); const v = this.view.getFloat32(this.pos); this.pos += 4; return v; }
  f64(): number { this.need(8); const v = this.view.getFloat64(this.pos); this.pos += 8; return v; }

  bytes(n: number): Uint8Array {
    this.need(n);
    const out = new Uint8Array(this.view.buffer, this.view.byteOffset + this.pos, n);
    this.pos += n;
    return out;
  }

  rest(): Uint8Array {
    return this.bytes(this.remaining);
  }

  /** Unsigned varint (7 bits per byte, at most 5 bytes), returned as a signed 32-bit int like the game does. */
  varint(): number {
    let result = 0;
    let i = 0;
    for (;;) {
      const byte = this.u8();
      if (i < 5) result |= (byte & 127) << (7 * i) >>> 0;
      i++;
      if ((byte & 128) === 0) break;
      if (i > 10) throw new ReplayError('malformed', 'Número codificado inválido na gravação');
    }
    return result | 0;
  }

  /**
   * Text as written by the game: UTF-8 where each UTF-16 code unit is encoded
   * on its own (emoji are stored as two encoded surrogates, which strict UTF-8
   * decoders reject). Plain ASCII takes the fast path.
   */
  string(length: number): string {
    const bytes = this.bytes(length);
    let ascii = true;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 128) { ascii = false; break; }
    if (ascii) return decoder.decode(bytes);
    let out = '';
    let i = 0;
    while (i < bytes.length) {
      const c = bytes[i];
      let code: number;
      let size: number;
      if ((c & 128) === 0) { code = c; size = 1; }
      else if ((c & 224) === 192) { code = c & 31; size = 2; }
      else if ((c & 240) === 224) { code = c & 15; size = 3; }
      else if ((c & 248) === 240) { code = c & 7; size = 4; }
      else if ((c & 252) === 248) { code = c & 3; size = 5; }
      else if ((c & 254) === 252) { code = c & 1; size = 6; }
      else throw new ReplayError('malformed', 'Texto inválido na gravação');
      if (i + size > bytes.length) throw new ReplayError('malformed', 'Texto inválido na gravação');
      for (let k = 1; k < size; k++) code = (code << 6) | (bytes[i + k] & 63);
      out += code > 0x10ffff || code < 0 ? '�' : String.fromCodePoint(code);
      i += size;
    }
    return out;
  }

  /** String with varint length. */
  str(): string {
    const n = this.varint();
    if (n < 0) throw new ReplayError('malformed', 'Tamanho de texto inválido');
    return this.string(n);
  }

  /** Nullable string: varint length + 1, zero means null. */
  nstr(): string | null {
    const n = this.varint();
    return n <= 0 ? null : this.string(n - 1);
  }
}
