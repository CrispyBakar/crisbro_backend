const { z } = require("zod");

const PUSH_SERVICE_HOSTS = [
  "fcm.googleapis.com", // Chrome, Opera, Samsung Internet, Edge Android
  "push.services.mozilla.com", // Firefox
  "push.apple.com", // Safari macOS & IOS 16.4 +
  "notify.windows.com", // Edge Windows
];

function isPushServiceUrl(value) {
  try {
    const { protocol, hostname } = new URL(value);
    return (
      protocol === "https:" &&
      PUSH_SERVICE_HOSTS.some(
        (host) => hostname === host || hostname.endsWith(`.${host}`),
      )
    );
  } catch (err) {
    return false;
  }
}

const base64Url = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+=*$/, "Format key tidak valid");

const PushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .max(2048)
    .refine(isPushServiceUrl, "Endpoint push service tidak dikenali"),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({ p256dh: base64Url, auth: base64Url }),
});

const UnsubscribeSchema = z.object({
  endpoint: z.string().min(1).max(2048),
});

const PushMessageSchema = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(300),
  url: z
    .string()
    .trim()
    .max(500)
    .regex(/^\/(?![/\\])/, "URL harus path internal, mis. /vouchers")
    .default("/"),
});

module.exports = {
  PushSubscriptionSchema,
  UnsubscribeSchema,
  PushMessageSchema,
  isPushServiceUrl,
};
