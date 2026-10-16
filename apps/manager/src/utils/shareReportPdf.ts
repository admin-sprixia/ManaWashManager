import ReactNativeBlobUtil from 'react-native-blob-util';
import Share from 'react-native-share';
import { SHOP } from '../config/shop';
import {
  buildReportPdf,
  reportFilename,
  type ReportExportPayload,
  type ReportShopMeta,
} from './reportPdf';

/** Encode PDF bytes to base64 without relying on Hermes `btoa` (not always present). */
function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...slice);
  }
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(binary);
  }
  return ReactNativeBlobUtil.base64.encode(binary);
}

/** Write the report PDF to cache and open the native share sheet. */
export async function shareReportPdf(
  data: ReportExportPayload,
  shop?: ReportShopMeta,
): Promise<void> {
  const meta: ReportShopMeta = {
    name: shop?.name?.trim() || SHOP.name,
    city: shop?.city ?? null,
    code: shop?.code ?? null,
    generatedBy: shop?.generatedBy ?? null,
    rewards: shop?.rewards ?? null,
  };
  const bytes = await buildReportPdf(data, meta);
  const filename = reportFilename(data, meta.name);
  const path = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/${filename}`;

  const base64 = bytesToBase64(bytes);
  await ReactNativeBlobUtil.fs.writeFile(path, base64, 'base64');

  await Share.open({
    url: `file://${path}`,
    type: 'application/pdf',
    filename,
    title: `Export ${meta.name} report`,
    failOnCancel: false,
  });
}
