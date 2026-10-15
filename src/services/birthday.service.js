const { Prisma } = require("@prisma/client");
const prisma = require("../lib/prisma");
const { connection } = require("../lib/redis");
const { getWibDateParts, formatWibDate } = require("../lib/wibDate");
const {
  findUserSubscriptions,
  sendToSubscriptions,
} = require("./push.service");

const SEND_CONCURRENCY = 10;
// Penanda "sudah dikirim" cukup hidup beberapa hari; tujuannya hanya mencegah
// ucapan ganda bila job di-retry atau dijalankan ulang manual di hari yang sama.
const SENT_MARKER_TTL_SECOND = 3 * 24 * 60 * 60;

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// Customer yang lahir 29 Februari diberi ucapan tanggal 28 Februari di tahun
// non-kabisat, supaya tidak terlewat tiga tahun sekali.
function getBirthdayDays({ year, month, day }) {
  if (month === 2 && day === 28 && !isLeapYear(year)) return [28, 29];
  return [day];
}

// Hanya customer yang punya akun app dan pernah mengizinkan notifikasi;
// sisanya tidak bisa dikirimi push sama sekali.
async function findBirthdayCustomers(now) {
  const parts = getWibDateParts(now);
  const days = getBirthdayDays(parts);

  return prisma.$queryRaw`
    SELECT c.customer_id, c.user_id, c.name
    FROM "Customer" c
    WHERE c.user_id IS NOT NULL
      AND c.dob IS NOT NULL
      AND EXTRACT(MONTH FROM c.dob)::int = ${parts.month}
      AND EXTRACT(DAY FROM c.dob)::int IN (${Prisma.join(days)})
      AND EXISTS (
        SELECT 1 FROM "PushSubscription" p WHERE p.user_id = c.user_id
      )
  `;
}

function buildBirthdayMessage(name) {
  const firstName = String(name || "")
    .trim()
    .split(/\s+/)[0];

  return {
    title: firstName
      ? `Selamat ulang tahun, ${firstName}! 🎂`
      : "Selamat ulang tahun! 🎂",
    body: "Semoga harimu menyenangkan dan penuh kebahagiaan. Terima kasih sudah jadi bagian dari Crisbro!",
    // Sengaja tanpa `tag`: Chrome di macOS mengganti notifikasi lama ber-tag
    // sama tanpa menampilkan banner. Duplikat sudah dicegah penanda Redis.
    url: "/",
  };
}

// Klaim atomik per device per hari, bukan per user: device yang baru subscribe
// setelah run pertama tetap kebagian ucapan saat job dijalankan ulang, sementara
// device yang sudah menerima tidak dikirimi dua kali.
async function greetDevice(subscription, message, dateLabel) {
  const markerKey = `customer-birthday:${dateLabel}:${subscription.push_subscription_id}`;
  const claimed = await connection.set(
    markerKey,
    "1",
    "EX",
    SENT_MARKER_TTL_SECOND,
    "NX",
  );
  if (!claimed) return "skipped";

  let result = null;
  try {
    // Throw hanya bila VAPID belum diisi; kegagalan per device sudah di-log push.service
    const summary = await sendToSubscriptions([subscription], message);
    if (summary.sent > 0) return "sent";
    result = summary.expired > 0 ? "expired" : "failed";
  } catch (error) {
    console.error(
      `[birthday] ucapan ke ${subscription.push_subscription_id} gagal:`,
      error.message,
    );
    result = "failed";
  }

  // Lepas klaim supaya run berikutnya di hari yang sama masih bisa mencoba lagi.
  // Subscription expired sudah dihapus, jadi tidak akan dicoba ulang.
  await connection.del(markerKey).catch(() => undefined);
  return result;
}

async function greetCustomer(customer, dateLabel) {
  const subscriptions = await findUserSubscriptions(customer.user_id);
  const message = buildBirthdayMessage(customer.name);

  return Promise.all(
    subscriptions.map((subscription) =>
      greetDevice(subscription, message, dateLabel),
    ),
  );
}

// Dijalankan worker harian: kirim ucapan ke customer yang berulang tahun hari ini (WIB).
// `customers` dihitung per customer; sent/skipped/expired/failed per device.
async function sendBirthdayGreetings({ now = new Date() } = {}) {
  const dateLabel = formatWibDate(now);
  const customers = await findBirthdayCustomers(now);
  const summary = {
    date: dateLabel,
    customers: customers.length,
    sent: 0,
    skipped: 0,
    expired: 0,
    failed: 0,
  };

  for (let i = 0; i < customers.length; i += SEND_CONCURRENCY) {
    const batch = customers.slice(i, i + SEND_CONCURRENCY);
    const results = await Promise.all(
      batch.map((customer) => greetCustomer(customer, dateLabel)),
    );
    for (const result of results.flat()) summary[result] += 1;
  }

  return summary;
}

module.exports = { sendBirthdayGreetings, getBirthdayDays };
