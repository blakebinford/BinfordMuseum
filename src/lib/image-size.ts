/** Dimension sniffing for admin uploads (JPEG and PNG only). */

export interface Dimensions {
  width: number;
  height: number;
}

export function jpegSize(buf: Buffer): Dimensions | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  while (off < buf.length - 9) {
    if (buf[off] !== 0xff) return null;
    const marker = buf[off + 1];
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      off += 2;
      continue;
    }
    const len = buf.readUInt16BE(off + 2);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function pngSize(buf: Buffer): Dimensions | null {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_MAGIC)) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function sniffImage(buf: Buffer): (Dimensions & { ext: 'jpg' | 'png'; contentType: string }) | null {
  const jpeg = jpegSize(buf);
  if (jpeg) return { ...jpeg, ext: 'jpg', contentType: 'image/jpeg' };
  const png = pngSize(buf);
  if (png) return { ...png, ext: 'png', contentType: 'image/png' };
  return null;
}
