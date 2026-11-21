/**
 * Edge Read Aloud 的 Sec-MS-GEC v2 令牌（纯函数，可离线测试）。
 *
 * 2026-10 起微软把该令牌从「纯 SHA-256」升级为 v2：`<16 hex CS64>-<64 hex SHA256>`，
 * 且哈希常数被刻意改动，不能替换成标准 SHA-256 实现。旧令牌会被 401/403 拒绝。
 * 算法参照 edge-tts 的 drm.py，本文件逐位移植（含 CS64 哈希）。
 *
 * 全部运算显式截断到 32 位无符号，避免 JS 位运算的符号扩展差异。
 */

/** Edge 官方客户端令牌（公开常量，非密钥） */
export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';

/** Edge 内核版本：必须与 User-Agent 主版本一致，否则令牌校验失败 */
export const CHROMIUM_FULL_VERSION = '143.0.3650.75';
export const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
export const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;

const WIN_EPOCH_SECONDS = 11_644_473_600;
const TICK_WINDOW_SECONDS = 300;

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];
const SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab,
  0xfeb0a7e4, 0x03effbd2,
];
const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491,
  0xc0dd25a0, 0xf9e70ab6, 0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33,
  0xd258b060, 0x72766564,
];
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA256_ADJUSTMENT = 0xc9dc06a7;
const SHA256_BLOCK_CONSTANTS = [
  ...SHA256_ROUND_CONSTANTS.slice(0, 14),
  SHA256_ADJUSTMENT,
  ...SHA256_ROUND_CONSTANTS.slice(15),
];
const SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

const CS64_COEFFICIENTS: readonly (readonly [number, number])[] = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

function u32(value: number): number {
  return value >>> 0;
}

function imul32(a: number, b: number): number {
  return Math.imul(a, b) >>> 0;
}

function add32(...values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum >>> 0;
}

function rol16(value: number): number {
  return ((value << 16) | (value >>> 16)) >>> 0;
}

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function sigma0(value: number): number {
  return ((value >>> 7) ^ (value << 25) ^ (value >>> 18) ^ (value << 14) ^ (value >>> 3)) >>> 0;
}

function sigma1(value: number): number {
  return ((value >>> 17) ^ (value << 15) ^ (value >>> 19) ^ (value << 13) ^ (value >>> 10)) >>> 0;
}

function sha256Rounds(state: number[], words: number[], firstRound = 0): number[] {
  let [a, b, c, d, e, f, g, h] = state;
  const constants = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  for (let index = firstRound; index < 64; index++) {
    const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
    const ch = ((e & f) ^ (~e & g)) >>> 0;
    const t1 = add32(h, s1, ch, constants[index], words[index]);
    const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
    const maj = ((a & b) | (c & (a | b))) >>> 0;
    const t2 = add32(s0, maj);
    h = g;
    g = f;
    f = e;
    e = add32(d, t1);
    d = c;
    c = b;
    b = a;
    a = add32(t1, t2);
  }
  return [a, b, c, d, e, f, g, h];
}

function expandSchedule(words: number[], firstWord = 16): void {
  for (let index = firstWord; index < 64; index++) {
    const x = words[index - 2];
    const y = words[index - 15];
    words.push(add32(sigma1(x), words[index - 7], sigma0(y), words[index - 16]));
  }
}

function readUintBE(bytes: Uint8Array, start: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) value = u32(value * 256 + bytes[start + i]);
  return value;
}

function sha256Init(data: Uint8Array): number[] {
  const words: number[] = new Array(14).fill(0);
  words.push(readUintBE(data, 0, 3));
  words.push(readUintBE(data, 3, 4));
  for (let index = 16; index <= 29; index++) {
    let value = SHA256_SCHEDULE[index - 16];
    if (index - 2 >= 14) {
      const s1 = sigma1(words[index - 2]);
      value += index === 16 ? (s1 ^ SHA256_SIGMA1_ADJUSTMENT) >>> 0 : s1;
    }
    if (index - 7 >= 14) value += words[index - 7];
    if (index - 15 >= 14) {
      const s0 = sigma0(words[index - 15]);
      value += index === 29 ? (s0 ^ SHA256_SIGMA0_ADJUSTMENT) >>> 0 : s0;
    }
    words.push(u32(value));
  }
  words.push(
    add32(
      sigma1(words[28]),
      words[23],
      sigma0(words[15]),
      words[14],
      SHA256_ADJUSTMENT,
      -SHA256_ROUND_CONSTANTS[14],
    ),
  );
  expandSchedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((value, index) => add32(value, working[index]));
}

function sha256Digest(data: Uint8Array): Uint8Array {
  if (data.length < 7) throw new Error('Edge 令牌盐至少需要 7 字节');
  const length = 57 + data.length;
  const padLength = (((55 - length) % 64) + 64) % 64;
  const tail = data.subarray(7);
  const total = tail.length + 1 + padLength + 8;
  const padded = new Uint8Array(total);
  padded.set(tail, 0);
  padded[tail.length] = 0x80;
  const bitLength = BigInt(length) * 8n;
  for (let i = 0; i < 8; i++) {
    padded[total - 1 - i] = Number((bitLength >> BigInt(8 * i)) & 0xffn);
  }

  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let i = 0; i < 16; i++) words.push(readUintBE(padded, offset + i * 4, 4));
    expandSchedule(words);
    const working = sha256Rounds(state, words);
    state = state.map((value, index) => add32(value, working[index]));
  }

  const digest = new Uint8Array(32);
  state.forEach((value, index) => {
    digest[index * 4] = (value >>> 24) & 0xff;
    digest[index * 4 + 1] = (value >>> 16) & 0xff;
    digest[index * 4 + 2] = (value >>> 8) & 0xff;
    digest[index * 4 + 3] = value & 0xff;
  });
  return digest;
}

function wordsLe4Even(data: Uint8Array): number[] {
  const paddedLength = data.length + ((4 - (data.length % 4)) % 4);
  const words: number[] = [];
  for (let offset = 0; offset < paddedLength; offset += 4) {
    words.push(
      u32(
        (data[offset] ?? 0) |
          ((data[offset + 1] ?? 0) << 8) |
          ((data[offset + 2] ?? 0) << 16) |
          ((data[offset + 3] ?? 0) << 24),
      ),
    );
  }
  if (words.length % 2 === 1) words.push(0);
  return words;
}

function cs64Digest(data: Uint8Array, digest: Uint8Array): [number, number] {
  const keyA = ((digest[0] | (digest[1] << 8) | (digest[2] << 16) | (digest[3] << 24)) | 1) >>> 0;
  const keyB = ((digest[4] | (digest[5] << 8) | (digest[6] << 16) | (digest[7] << 24)) | 1) >>> 0;
  const factors = [imul32(keyA, CS64_FACTOR), imul32(keyB, CS64_FACTOR)];

  const terms: number[] = CS64_COEFFICIENTS.map(([coefficient], index) =>
    imul32(coefficient, factors[index % 2]),
  );
  const offsets: number[] = CS64_COEFFICIENTS.map(([, offset]) => offset);
  const indexed = wordsLe4Even(new Uint8Array([0, ...data]));
  indexed.forEach((word, index) => {
    let term = imul32(word, index % 2 === 0 ? keyA : keyB);
    let offset = imul32(rol16(word), index % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (index === 0) {
      term = add32(term, imul32(CS64_ADJUSTMENT0, factors[0]));
      offset = add32(offset, CS64_ADJUSTMENT1);
    }
    terms.push(term);
    offsets.push(offset);
  });

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index];
    const y = terms[index + 1];

    let t = rol16(add32(offsets[index], x));
    let q = imul32(t, 0x76f50f34);
    swapAcc = add32(swapAcc, add32(imul32(rol16(q), 0xc3efea97), q));
    t = rol16(add32(offsets[index + 1], y));
    q = imul32(t, 0x1881ce3c);
    swapLast = add32(imul32(rol16(q), 0x35bd1ec9), q);
    swapAcc = add32(swapAcc, swapLast);

    state = add32(imul32(state, keyA), x);
    state = imul32(rol16(state), 0xcf98b111);
    state = imul32(rol16(state), 0x87085b9f);
    state = imul32(rol16(state), 0x12ceb96d);
    state = imul32(rol16(state), 0x257e1d83);
    acc = add32(acc, state);

    let t2 = add32(imul32(state, keyB), y);
    t2 = imul32(rol16(t2), 0xa27416f5);
    t2 = imul32(rol16(t2), 0xd38396ff);
    state = imul32(rol16(imul32(rol16(t2), 0x7c932b89)), 0xbfa49f69);
    acc = add32(acc, state);
  }

  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

function toHexUpper(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0').toUpperCase();
  return out;
}

function tokenHash(data: Uint8Array): [string, string] {
  const digest = sha256Digest(data);
  const [a, b] = cs64Digest(data, digest);
  const cs64 = toHexUpper(
    new Uint8Array([
      a & 0xff,
      (a >>> 8) & 0xff,
      (a >>> 16) & 0xff,
      (a >>> 24) & 0xff,
      b & 0xff,
      (b >>> 8) & 0xff,
      (b >>> 16) & 0xff,
      (b >>> 24) & 0xff,
    ]),
  );
  return [cs64, toHexUpper(digest)];
}

/**
 * 生成 Sec-MS-GEC v2 令牌：`<16 hex>-<64 hex>`。
 * 时间窗口 5 分钟取整；系统时钟偏移会导致 401/403，需要调用方按响应 Date 校准后重试。
 */
export function generateSecMsGecV2(unixSeconds: number = Date.now() / 1000): string {
  // 秒 → Windows 纪元秒 → 5 分钟窗口取整
  let windowSeconds = Math.floor(unixSeconds) + WIN_EPOCH_SECONDS;
  windowSeconds -= windowSeconds % TICK_WINDOW_SECONDS;
  // 参考实现是 ticks *= 1e7（100 纳秒单位）；十进制下等价于补 7 个零，
  // 这样既逐字节一致，又不需要 BigInt（Hermes 兼容性更稳）。
  const salt = `${windowSeconds}0000000${TRUSTED_CLIENT_TOKEN}`;
  const [cs64, digest] = tokenHash(new TextEncoder().encode(salt));
  return `${cs64}-${digest}`;
}
