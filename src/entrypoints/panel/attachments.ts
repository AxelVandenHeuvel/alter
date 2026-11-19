import type { AreaSelection } from '../../content/select-area';
import { sendToPage } from '../../lib/page-client';

/** A screenshot attached to a message: a selected area of the page, or a pasted image. */
export interface Attachment {
  id: string;
  /** Data URL of the image, shown in the chat and sent to the model. */
  dataUrl: string;
  mediaType: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
  /** For areas selected on the page: what's inside them, so "this" is unambiguous. */
  selection: AreaSelection | null;
}

export const MAX_ATTACHMENTS = 3;
/** Long side of the image sent to the model: plenty for reading UI text, small to send. */
const MAX_SIDE = 1200;
/** A little context around the selection. */
const MARGIN = 8;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Draw part of an image at most MAX_SIDE on its long side, as a PNG data URL. */
async function render(
  source: ImageBitmap,
  crop: { x: number; y: number; width: number; height: number },
): Promise<Pick<Attachment, 'dataUrl' | 'mediaType' | 'width' | 'height'>> {
  const scale = Math.min(1, MAX_SIDE / Math.max(crop.width, crop.height));
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d')!;
  context.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { dataUrl: await blobToDataUrl(blob), mediaType: 'image/png', width, height };
}

/** Crop a full-tab screenshot to the selected area (CSS pixels scaled by the device pixel ratio). */
export async function cropToSelection(screenshot: string, selection: AreaSelection): Promise<Attachment> {
  const bitmap = await createImageBitmap(await (await fetch(screenshot)).blob());
  const { rect, devicePixelRatio: dpr } = selection;
  const x = Math.max(0, Math.floor((rect.x - MARGIN) * dpr));
  const y = Math.max(0, Math.floor((rect.y - MARGIN) * dpr));
  const right = Math.min(bitmap.width, Math.ceil((rect.x + rect.width + MARGIN) * dpr));
  const bottom = Math.min(bitmap.height, Math.ceil((rect.y + rect.height + MARGIN) * dpr));
  const image = await render(bitmap, { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) });
  bitmap.close();
  return { id: crypto.randomUUID(), ...image, selection };
}

/**
 * Let the user select an area of the page and screenshot it. Alter's panel hides while
 * they select and while the screenshot is taken. Null if they cancel.
 */
export async function captureArea(tabId: number): Promise<Attachment | null> {
  const { selection } = await sendToPage(tabId, { type: 'alter:selectArea' });
  try {
    if (!selection) return null;
    const tab = await chrome.tabs.get(tabId);
    let screenshot: string;
    try {
      screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    } catch (error) {
      // Chrome allows screenshots only for a while after Alter is opened from its icon, menu, or shortcut.
      if (error instanceof Error && /activeTab|all_urls/.test(error.message)) {
        throw new Error('Chrome needs you to open Alter again first. Click the Alter icon (or press ⌘⇧Y twice), then select the area.', {
          cause: error,
        });
      }
      throw error;
    }
    return await cropToSelection(screenshot, selection);
  } finally {
    await sendToPage(tabId, { type: 'alter:widget', action: 'reveal', tabId }).catch(() => undefined);
  }
}

/** A pasted or dropped image, scaled down like a selection. */
export async function imageFileToAttachment(file: Blob): Promise<Attachment> {
  const bitmap = await createImageBitmap(file);
  const image = await render(bitmap, { x: 0, y: 0, width: bitmap.width, height: bitmap.height });
  bitmap.close();
  return { id: crypto.randomUUID(), ...image, selection: null };
}

/** The base64 payload of a data URL, as the model API expects it. */
export function base64Of(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
