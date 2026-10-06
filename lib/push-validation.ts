/**
 * Web Push subscription validation.
 *
 * The server sends push messages to the endpoint inside a subscription. If that URL is user-supplied and
 * unchecked, the server becomes a request relay (blind SSRF) and a notification spammer under the app's VAPID
 * identity. A real browser subscription endpoint always points at the browser vendor's push service, so only
 * those hosts are allowed: https, default port, no credentials, no IP literals, no look-alike hosts.
 */
import { z } from 'zod';

const EXACT_HOSTS = new Set([
  'fcm.googleapis.com', // Chrome, Edge, Android
  'android.googleapis.com', // legacy GCM endpoints
  'updates.push.services.mozilla.com', // Firefox
  'web.push.apple.com', // Safari
]);
const HOST_SUFFIXES = ['.notify.windows.com', '.push.services.mozilla.com'];

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export function isAllowedPushEndpoint(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  const host = url.hostname.toLowerCase();
  if (host.endsWith('.') || host.includes('[') || host.includes(':') || IPV4.test(host)) return false;
  if (EXACT_HOSTS.has(host)) return true;
  return HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

const base64url = /^[A-Za-z0-9_-]+={0,2}$/;

export const PushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isAllowedPushEndpoint, 'Not a recognised push service endpoint'),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(20).max(200).regex(base64url),
    auth: z.string().min(8).max(64).regex(base64url),
  }),
});

export type PushSubscriptionInput = z.infer<typeof PushSubscriptionSchema>;
