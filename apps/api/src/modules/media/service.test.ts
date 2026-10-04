import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe,expect,it,vi } from 'vitest';
import { maxImageBytes,type ImageMime,type MediaStore,type MediaAsset } from './contracts.js';
import { MediaService,validateImage } from './service.js';
import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
const context: WorkspaceContext = { user_id: 'owner',workspace_id: 'workspace',role: 'owner',permissions: ['messages.manage'] };
async function image(format: 'png'|'jpeg'|'webp' = 'png',width = 12,height = 8) {
  return sharp({ create: { width,height,channels: 3,background: '#a855f7' } }).toFormat(format).toBuffer();
}
describe('validated image processing', () => {
  it.each(['png','jpeg','webp'] as const)('decodes and reencodes %s with trustworthy dimensions and digest', async (format) => {
    const bytes = await image(format); const mimeType: ImageMime = format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
    const result = await validateImage({ name: ' Banner ',mimeType,dataBase64: bytes.toString('base64') });
    expect(result.name).toBe('Banner'); expect(result.width).toBe(12); expect(result.height).toBe(8);
    expect((await sharp(result.content).metadata()).format).toBe(format);
    expect(result.sha256).toBe(createHash('sha256').update(result.content).digest('hex'));
  });
  it('drops EXIF and original metadata and preserves orientation', async () => {
    const input = await sharp(await image('jpeg')).withMetadata({ orientation: 6 }).withExif({ IFD0: { Artist: 'private-author' } }).toBuffer();
    const result = await validateImage({ name: 'Photo',mimeType: 'image/jpeg',dataBase64: input.toString('base64') });
    const metadata = await sharp(result.content).metadata();
    expect(metadata.exif).toBeUndefined(); expect(metadata.orientation).toBeUndefined();
    expect(result.width).toBe(8); expect(result.height).toBe(12);
    expect(result.content.includes(Buffer.from('private-author'))).toBe(false);
  });
  it('rejects malformed/noncanonical base64, mismatched types, SVG and corrupt images', async () => {
    const png = await image(); const input = { name: 'Banner',mimeType: 'image/png' as const,dataBase64: png.toString('base64') };
    for (const dataBase64 of ['!!!!','AAAA=','data:image/png;base64,'+input.dataBase64,'<svg/>',Buffer.from('<svg><script/></svg>').toString('base64'),png.subarray(0,20).toString('base64')]) await expect(validateImage({ ...input,dataBase64 })).rejects.toThrow('Mídia indisponível.');
    await expect(validateImage({ ...input,mimeType: 'image/jpeg' })).rejects.toThrow();
    for (const name of ['', ' ', '../photo', 'bad\\name','line\nname']) await expect(validateImage({ ...input,name })).rejects.toThrow();
  });
  it('rejects excessive byte sizes and dimensions and accepts large base64 without regex stack failure', async () => {
    await expect(validateImage({ name: 'Big',mimeType: 'image/png',dataBase64: Buffer.alloc(maxImageBytes+1).toString('base64') })).rejects.toThrow();
    await expect(validateImage({ name: 'Wide',mimeType: 'image/png',dataBase64: (await image('png',4097,1)).toString('base64') })).rejects.toThrow();
    const bytes = await image();
    // A valid image with trailing padding is fully reencoded; originals are never returned.
    const padded = Buffer.concat([bytes,Buffer.alloc(1024*1024)]);
    const result = await validateImage({ name: 'Padded',mimeType: 'image/png',dataBase64: padded.toString('base64') });
    expect(result.content.length).toBeLessThan(1024);
  });
  it('rejects animated WebP instead of silently storing its first frame', async () => {
    const pixels = Buffer.concat([Buffer.alloc(4*4*3,0),Buffer.alloc(4*4*3,255)]);
    const animated = await sharp(pixels,{ raw: { width: 4,height: 8,channels: 3,pageHeight: 4 } }).webp({ loop: 0,delay: [100,100] }).toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(2);
    await expect(validateImage({ name: 'Animated',mimeType: 'image/webp',dataBase64: animated.toString('base64') })).rejects.toThrow();
  });
  it('rejects PNG animation control even when the decoder reports only a static first frame', async () => {
    const png = await image(); const chunk = Buffer.alloc(20); chunk.writeUInt32BE(8,0); chunk.write('acTL',4); chunk.writeUInt32BE(2,8);
    let crc = 0xffffffff;
    for (const byte of chunk.subarray(4,16)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0,16);
    const animated = Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)]);
    await expect(validateImage({ name: 'APNG',mimeType: 'image/png',dataBase64: animated.toString('base64') })).rejects.toThrow();
  });
  it('authorizes before decoding, does not persist cancelled requests and limits concurrent processing', async () => {
    let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void; const ready = new Promise<void>((resolve) => { entered = resolve; }); let calls = 0;
    const store = { authorizeUpload: vi.fn<MediaStore['authorizeUpload']>(async () => undefined),create: vi.fn<MediaStore['create']>(async () => { if (++calls === 2) entered(); await gate; return {} as MediaAsset; }),list: vi.fn(),get: vi.fn() } satisfies MediaStore;
    const service = new MediaService(store); const input = { name: 'Banner',mimeType: 'image/png' as const,dataBase64: (await image()).toString('base64') };
    const first = service.upload(context,input,new AbortController().signal); const second = service.upload(context,input,new AbortController().signal);
    await ready;
    await expect(service.upload(context,input,new AbortController().signal)).rejects.toMatchObject({ reason: 'busy' });
    release(); await Promise.all([first,second]);
    store.create.mockClear();
    await expect(service.upload(context,input,AbortSignal.abort())).rejects.toThrow(); expect(store.create).not.toHaveBeenCalled();
    store.authorizeUpload.mockRejectedValueOnce(new Error('revoked'));
    await expect(service.upload(context,input,new AbortController().signal)).rejects.toThrow('revoked'); expect(store.create).not.toHaveBeenCalled();
  });
});
