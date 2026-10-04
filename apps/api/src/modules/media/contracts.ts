import type { WorkspaceContext } from '../workspaces/domain/contracts.js';
export const maxImageBytes = 2 * 1024 * 1024;
export const maxUploadBodyBytes = 3 * 1024 * 1024;
export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp';
export type MediaAsset = { id: string; name: string; mime_type: ImageMime; byte_size: number; width: number; height: number; sha256: string; created_at: Date };
export type ValidatedImage = { name: string; mimeType: ImageMime; content: Buffer; width: number; height: number; sha256: string };
export class MediaInputError extends Error {
  constructor(readonly reason: 'invalid' | 'busy' = 'invalid') { super('Mídia indisponível.'); }
}
export interface MediaStore {
  authorizeUpload(context: WorkspaceContext): Promise<void>;
  create(context: WorkspaceContext, image: ValidatedImage): Promise<MediaAsset>;
  list(context: WorkspaceContext, offset: number): Promise<{ assets: MediaAsset[]; total: number }>;
  get(context: WorkspaceContext, id: string): Promise<{ asset: MediaAsset; content: Buffer } | null>;
}
