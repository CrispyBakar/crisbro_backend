const prisma = require("../lib/prisma");
const { getWebPush } = require("../lib/webPush");

// Jika device sedang offline, push service menyimpan notifikasi paling lama
// selama TTL. lewat dari itu notifikasi dibuat (promo kadaluwarsa)
const PUSH_TTL_SECOND = 24 * 60 * 60;
const PUSH_TIMEOUT_MS = 5_000;
const SEND_CONCURRENCY = 10;
const BROADCAST_BATCH_SIZE = 500;
const MAX_BROADCASTS_PER_RUN = 5;

const SUBSCRIPTION_SELECT = {
  push_subscription_id: true,
  endpoint: true,
  p256dh: true,
  auth: true,
};

async function saveSubscription({ user_id, subscription, user_agent }) {
  const data = {
    user_id,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
    user_agent: user_agent ? String(user_agent).slice(0, 255) : null,
  };

  // Endpoint unique per browser, jika device yang sama dipakai login akun lain,
  // subscription dipindahkan ke user yang sedang login.
  return prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: data,
    create: { ...data, endpoint: subscription.endpoint },
    select: { push_subscription_id: true, created_at: true },
  });
}

async function removeSubscription({ user_id, endpoint }) {
  const { count } = await prisma.pushSubscription.deleteMany({
    where: { user_id, endpoint },
  });
  return count;
}

function buildPayload({ title, body, url = "/", tag }) {
  return JSON.stringify({ title, body, url, ...(tag ? { tag } : {}) });
}

// Menjalankan fn untuk tiap item, maksimal `concurrency` request bersamaan
async function mapWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function runner() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }

  const runners = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: runners }, runner));
  return results;
}

// Tidak pernah throw: kegagalan satu device tidak boleh menghentikan device lain
async function sendOne(webpush, row, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
      payload,
      { TTL: PUSH_TTL_SECOND, timeout: PUSH_TIMEOUT_MS },
    );
    return "sent";
  } catch (err) {
    // 404/410: subscription sudah mati (izin dicabut, data browser dihapus)
    // applikasi di uninstall. Hapus sudapa tidak dikirim lagi.
    if (err.statusCode === 404 || err.statusCode == 410) {
      await prisma.pushSubscription
        .deleteMany({
          where: { push_subscription_id: row.push_subscription_id },
        })
        .catch(() => undefined);
      return "expired";
    }

    // Endpoint adalah URL rahasia milik device; cukup log id-nya
    console.error(
      `[push] gagal dikirim ke ${row.push_subscription_id}: ${err.statusCode ?? "-"} ${err.message}`,
    );
    return "failed";
  }
}

async function sendToSubscriptions(rows, message) {
  const summary = { sent: 0, expired: 0, failed: 0 };
  if (rows.length === 0) return summary;

  // Throw di sini bila VAPID belum diisi, sebelum ada request yang dikirim
  const webpush = getWebPush();
  const payload = buildPayload(message);

  const results = await mapWithConcurrency(rows, SEND_CONCURRENCY, (row) =>
    sendOne(webpush, row, payload),
  );
  for (const result of results) summary[result] += 1;

  return summary;
}

async function sendPushToUser(user_id, message) {
  const rows = await prisma.pushSubscription.findMany({
    where: { user_id },
    select: SUBSCRIPTION_SELECT,
  });
  return sendToSubscriptions(rows, message);
}

// Untuk trigger otomatis (poin, referral). Notifikasi hanya pelengkap, jadi
// error apa pun cukup di-log dan tidak boleh menggagalkan proses utama.
async function notifyUserSafely(user_id, message) {
  if (!user_id) return null;

  try {
    return await sendPushToUser(user_id, message);
  } catch (error) {
    console.error(`[push] notifikasi ke user ${user_id} gagal:`, error.message);
    return null;
  }
}

// Notifikasi operasional ke staf aktif (mis. referral perlu divalidasi).
// Jumlah staf sedikit, jadi tidak perlu paging seperti broadcast customer.
async function notifyStaffSafely(message, roles = ["admin", "marketing"]) {
  try {
    const rows = await prisma.pushSubscription.findMany({
      where: { user: { role: { in: roles }, status: "active" } },
      select: SUBSCRIPTION_SELECT,
    });
    return await sendToSubscriptions(rows, message);
  } catch (error) {
    console.error("[push] notifikasi ke staf gagal:", error.message);
    return null;
  }
}

async function createBroadcast({ created_by_id, message }) {
  return prisma.pushBroadcast.create({
    data: {
      title: message.title,
      body: message.body,
      url: message.url,
      created_by_id,
    },
  });
}

async function listBroadcasts({ limit = 20 } = {}) {
  return prisma.pushBroadcast.findMany({
    orderBy: { created_at: "desc" },
    take: limit,
  });
}

async function deliverBroadcast(broadcast) {
  const totals = { sent: 0, expired: 0, failed: 0 };
  let lastId = null;

  for (;;) {
    // Paging memakai `gt`, bukan cursor Prisma: baris cursor bisa saja sudah
    // terhapus karena expired, dan cursor yang hilang membuat halaman
    // berikutnya kosong sehingga broadcast berhenti di tengah jalan.
    const rows = await prisma.pushSubscription.findMany({
      where: {
        user: { role: "customer" },
        ...(lastId ? { push_subscription_id: { gt: lastId } } : {}),
      },
      orderBy: { push_subscription_id: "asc" },
      take: BROADCAST_BATCH_SIZE,
      select: SUBSCRIPTION_SELECT,
    });
    if (rows.length === 0) break;

    const summary = await sendToSubscriptions(rows, broadcast);
    totals.sent += summary.sent;
    totals.expired += summary.expired;
    totals.failed += summary.failed;
    lastId = rows[rows.length - 1].push_subscription_id;

    // Progres disimpan per batch supaya admin bisa memantau
    await prisma.pushBroadcast.update({
      where: { push_broadcast_id: broadcast.push_broadcast_id },
      data: {
        sent_count: totals.sent,
        failed_count: totals.failed + totals.expired,
      },
    });

    if (rows.length < BROADCAST_BATCH_SIZE) break;
  }

  return totals;
}

// Dijalankan worker (bukan Netlify): ambil broadcast pending, kirim, tandai selesai.
async function processPendingBroadcasts() {
  const processed = [];

  for (let i = 0; i < MAX_BROADCASTS_PER_RUN; i++) {
    const broadcast = await prisma.pushBroadcast.findFirst({
      where: { status: "pending" },
      orderBy: { created_at: "asc" },
    });
    if (!broadcast) break;

    // Klaim atomik: bila ada dua worker, hanya satu yang mendapat count 1,
    // jadi broadcast tidak terkirim dua kali.
    const { count } = await prisma.pushBroadcast.updateMany({
      where: {
        push_broadcast_id: broadcast.push_broadcast_id,
        status: "pending",
      },
      data: { status: "sending", started_at: new Date() },
    });
    if (count === 0) continue;

    try {
      const totals = await deliverBroadcast(broadcast);
      await prisma.pushBroadcast.update({
        where: { push_broadcast_id: broadcast.push_broadcast_id },
        data: {
          status: "done",
          sent_count: totals.sent,
          failed_count: totals.failed + totals.expired,
          finished_at: new Date(),
        },
      });
      processed.push({
        push_broadcast_id: broadcast.push_broadcast_id,
        ...totals,
      });
    } catch (error) {
      console.error(
        `[push] broadcast ${broadcast.push_broadcast_id} gagal:`,
        error,
      );
      await prisma.pushBroadcast.update({
        where: { push_broadcast_id: broadcast.push_broadcast_id },
        data: {
          status: "failed",
          error: String(error.message).slice(0, 500),
          finished_at: new Date(),
        },
      });
    }
  }

  return { processed };
}

module.exports = {
  saveSubscription,
  removeSubscription,
  sendPushToUser,
  notifyUserSafely,
  notifyStaffSafely,
  createBroadcast,
  listBroadcasts,
  processPendingBroadcasts,
  BROADCAST_BATCH_SIZE,
};
