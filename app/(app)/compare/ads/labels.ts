import { OWNED_PERFORMANCE_STATUSES } from '../../../../lib/owned-ads/performance.ts';

/**
 * Thai words for the codes the compare screen shows, in one place. Codes that
 * are not listed are shown as they came, so nothing silently disappears.
 */

const FORMAT: Record<string, string> = {
  VIDEO: 'วิดีโอ', IMAGE: 'ภาพ', MULTI_IMAGES: 'ภาพหลายรูป', CAROUSEL: 'ภาพเลื่อน (carousel)',
  DCO: 'แอดหลายแบบ (DCO)', DPA: 'แอดแคตตาล็อก', PAGE_LIKE: 'แอดกดถูกใจเพจ', TEXT: 'ข้อความล้วน',
};
export const formatLabel = (value: string | null | undefined) => value ? FORMAT[value.toUpperCase()] ?? value : 'ไม่ระบุรูปแบบ';
/** AI sometimes repeats the Ad Library code it was given ("IMAGE รูปสินค้า…"); show it in Thai. */
export const thaiCodes = (text: string) => text.replace(/\b(MULTI_IMAGES|CAROUSEL|PAGE_LIKE|IMAGE|VIDEO|TEXT|DCO|DPA)\b/g, code => FORMAT[code]);

const STATUS = new Map<string, string>(OWNED_PERFORMANCE_STATUSES.map(([value, label]) => [value, label]));
export const ownedStatus = (value: string | null | undefined) => value ? STATUS.get(value.toUpperCase()) ?? value : 'ไม่ทราบสถานะ';

const CTA: Record<string, string> = {
  SEND_MESSAGE: 'ส่งข้อความ', MESSAGE_PAGE: 'ส่งข้อความ', SEND_WHATSAPP_MESSAGE: 'ส่ง WhatsApp', WHATSAPP_MESSAGE: 'ส่ง WhatsApp',
  LEARN_MORE: 'ดูเพิ่มเติม', SHOP_NOW: 'ซื้อเลย', BUY_NOW: 'ซื้อเลย', ORDER_NOW: 'สั่งซื้อเลย', GET_OFFER: 'รับข้อเสนอ',
  BOOK_NOW: 'จองเลย', BOOK_TRAVEL: 'จองเลย', CALL_NOW: 'โทรเลย', CONTACT_US: 'ติดต่อเรา', SIGN_UP: 'สมัคร',
  SUBSCRIBE: 'ติดตาม', APPLY_NOW: 'สมัครเลย', DOWNLOAD: 'ดาวน์โหลด', WATCH_MORE: 'ดูเพิ่ม', GET_QUOTE: 'ขอใบเสนอราคา',
  LIKE_PAGE: 'ถูกใจเพจ', INSTALL_MOBILE_APP: 'ติดตั้งแอป', NO_BUTTON: 'ไม่มีปุ่ม',
};
/** Ad Library sends the button as a code ("SEND_MESSAGE") or as English text ("SEND MESSAGE"). */
export function ctaLabel(text: string | null | undefined, type: string | null | undefined): string {
  for (const value of [text, type]) {
    if (!value?.trim()) continue;
    const key = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
    return CTA[key] ?? value;
  }
  return 'ไม่มีปุ่ม';
}

const PLATFORM: Record<string, string> = {
  FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram', MESSENGER: 'Messenger', AUDIENCE_NETWORK: 'Audience Network',
  THREADS: 'Threads', WHATSAPP: 'WhatsApp',
};
export const platformLabel = (values: string[] | null | undefined) =>
  (values ?? []).map(value => PLATFORM[value.toUpperCase()] ?? value).join(' · ') || '—';
