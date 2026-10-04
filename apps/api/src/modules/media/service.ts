import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
import { MediaInputError, maxImageBytes, type MediaStore, type ImageMime, type ValidatedImage } from './contracts.js';

export async function validateImage(input: { name: string; mimeType: ImageMime; dataBase64: string }): Promise<ValidatedImage> {
  const name = input.name.trim();
  if (!name || name.length > 100 || /[\x00-\x1f\x7f/\\]/.test(name)
    || !['image/png','image/jpeg','image/webp'].includes(input.mimeType)
    || !input.dataBase64.length || input.dataBase64.length > Math.ceil(maxImageBytes/3)*4
    || input.dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.dataBase64)) throw new MediaInputError();
  const bytes = Buffer.from(input.dataBase64,'base64');
  if (bytes.length > maxImageBytes || bytes.toString('base64') !== input.dataBase64) throw new MediaInputError();
  // Reject unsupported signatures before handing bytes to image decoders (e.g. SVG).
  const format = input.mimeType === 'image/png' ? 'png' : input.mimeType === 'image/jpeg' ? 'jpeg' : 'webp';
  const signatureValid = format === 'png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : format === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP';
  if (!signatureValid) throw new MediaInputError();
  if (format === 'png') {
    // libvips metadata does not report APNG frame counts; reject its animation control chunk.
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset); const type = bytes.subarray(offset+4,offset+8).toString('ascii');
      if (type === 'acTL') throw new MediaInputError();
      if (length > bytes.length-offset-12 || type === 'IEND') break;
      offset += length+12;
    }
  }
  try {
    const pipeline = sharp(bytes,{ failOn: 'warning',limitInputPixels: 4096*4096,limitInputChannels: 4 });
    const metadata = await pipeline.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096
      || (metadata.pages ?? 1) > 1) throw new MediaInputError();
    // Decode all pixels and encode a clean static image, dropping original metadata/trailing payloads.
    const { data,info } = await pipeline.rotate().toFormat(format).timeout({ seconds: 5 }).toBuffer({ resolveWithObject: true });
    if (data.length > maxImageBytes || info.width > 4096 || info.height > 4096) throw new MediaInputError();
    return { name,mimeType: input.mimeType,content: data,width: info.width,height: info.height,sha256: createHash('sha256').update(data).digest('hex') };
  } catch { throw new MediaInputError(); }
}
export class MediaService {
  private processing = 0;
  constructor(private readonly store: MediaStore) {}
  async upload(context: WorkspaceContext, input: { name: string; mimeType: ImageMime; dataBase64: string }, signal: AbortSignal) {
    signal.throwIfAborted(); await this.store.authorizeUpload(context); signal.throwIfAborted();
    if (this.processing >= 2) throw new MediaInputError('busy');
    this.processing++;
    try {
      const image = await validateImage(input); signal.throwIfAborted();
      return await this.store.create(context,image);
    } finally { this.processing--; }
  }
  list(context: WorkspaceContext, offset: number) { return this.store.list(context,offset); }
  get(context: WorkspaceContext, id: string) { return this.store.get(context,id); }
}
