// Reading what the camera sees: a LOKYX ring, or a QR code with an address or payment link.

import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { base64 } from '@scure/base';
import * as jpeg from 'jpeg-js';
import { decodeGray, TYPE_CAPSULE } from './ring';
import { addressFromBytes } from './lokyx';
import { sunToChain } from './chain-sun';

export { parsePayload, type Found } from './scan-core';
import type { Found } from './scan-core';

const SIDE = 320;

/**
 * Crops the circle out of a photo and looks for a ring in it. The circle sits in the middle of the
 * screen, so the crop is the photo's centre whichever way the photo came out.
 */
export async function ringFromPhoto(photo: { uri: string; width: number; height: number }, view: { w: number; h: number; r: number }): Promise<Found | null> {
  const portraitView = view.h >= view.w;
  const portraitPhoto = photo.height >= photo.width;
  const [vw, vh] = portraitView === portraitPhoto ? [view.w, view.h] : [view.h, view.w];
  const scale = Math.max(vw / photo.width, vh / photo.height); // the preview covers the screen
  const side = Math.min(photo.width, photo.height, Math.round(((view.r * 2) / scale) * 1.08));
  const x = Math.max(0, Math.round((photo.width - side) / 2));
  const y = Math.max(0, Math.round((photo.height - side) / 2));

  const ctx = ImageManipulator.manipulate(photo.uri).crop({ originX: x, originY: y, width: side, height: side }).resize({ width: SIDE, height: SIDE });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  ctx.release?.();
  img.release?.();
  if (!out.base64) return null;
  const raw = jpeg.decode(base64.decode(out.base64.replace(/^data:.*?,/, '')), { useTArray: true, formatAsRGBA: true });
  const gray = new Uint8Array(raw.width * raw.height);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (raw.data[j] * 77 + raw.data[j + 1] * 150 + raw.data[j + 2] * 29) >> 8;
  const m = decodeGray(gray, raw.width, raw.height);
  if (!m) return null;
  const other = sunToChain(m[0], m.slice(1));
  if (other) return { address: other.address, how: 'ring', chain: other.chain };
  return { address: addressFromBytes(m.slice(1)), how: 'ring', capsule: m[0] === TYPE_CAPSULE };
}
