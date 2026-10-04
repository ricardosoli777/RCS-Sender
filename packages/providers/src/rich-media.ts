import type {Media,ProviderContext} from './contracts.js';
import {VendorHttpError} from './vendor-http.js';
/** Only host-resolved, pinned images are exposed to vendor APIs. */
export async function imageUrl(context:ProviderContext,media:Media){
  if(!context.resolveMedia || !['image/png','image/jpeg'].includes(media.mimeType))throw new VendorHttpError(400);
  const resolved=await context.resolveMedia(media);const url=new URL(resolved.url);
  if(url.protocol!=='https:' || url.username || url.password || resolved.mimeType!==media.mimeType || resolved.byteSize<1 || resolved.byteSize>2*1024*1024)throw new VendorHttpError(400);
  return url.href;
}
