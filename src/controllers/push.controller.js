const { successRequest, badRequest } = require("../utils/responseReuest");
const { getVapidPublicKey } = require("../lib/webPush");
const {
  PushSubscriptionSchema,
  UnsubscribeSchema,
  PushMessageSchema,
} = require("../validation/push/push-validation");
const {
  saveSubscription,
  removeSubscription,
  sendPushToUser,
  createBroadcast,
  listBroadcasts,
} = require("../services/push.service");

function getVapidPublicKeyController(req, res) {
  const public_key = getVapidPublicKey();

  if (!public_key) {
    return badRequest({
      res,
      code: 503,
      error: "Push notification belum dikonfigurasi",
    });
  }

  return successRequest({ res, data: { public_key } });
}

async function subscribeController(req, res) {
  const validation = PushSubscriptionSchema.safeParse(req.body);

  if (!validation.success) {
    return badRequest({
      res,
      code: 422,
      error: validation.error.flatten().fieldErrors,
    });
  }

  const data = await saveSubscription({
    user_id: req.user.user_id,
    subscription: validation.data,
    user_agent: req.get("user-agent"),
  });

  return successRequest({
    res,
    code: 201,
    data,
    message: "Notifikasi diaktifkan",
  });
}

async function unsubscribeController(req, res) {
  const validation = UnsubscribeSchema.safeParse(req.body);

  if (!validation.success) {
    return badRequest({
      res,
      code: 422,
      error: validation.error.flatten().fieldErrors,
    });
  }

  const removed = await removeSubscription({
    user_id: req.user.user_id,
    endpoint: validation.data.endpoint,
  });

  return successRequest({
    res,
    data: { removed },
    message: "Notifikasi dimatikan",
  });
}

async function sendTestController(req, res) {
  const isStaff = req.user.role !== "customer";
  const summary = await sendPushToUser(req.user.user_id, {
    title: "Notifikasi Crisbro Aktif",
    body: isStaff
      ? "Referral baru yang perlu divalidasi akan muncul di sini"
      : "Info poin dan promo terbaru akan muncul di sini",
    url: isStaff ? "/admin/referrals" : "/settings",
    tag: "test",
  });

  if (summary.sent === 0) {
    return badRequest({
      res,
      code: 404,
      error: "Belum ada perangkat aktif yang menerima notifikasi",
    });
  }

  return successRequest({
    res,
    data: summary,
    message: "Notifikasi tes terkirim",
  });
}

async function createBroadcastController(req, res) {
  const validation = PushMessageSchema.safeParse(req.body);

  if (!validation.success) {
    return badRequest({
      res,
      code: 422,
      error: validation.error.flatten().fieldErrors,
    });
  }

  const data = await createBroadcast({
    created_by_id: req.user.user_id,
    message: validation.data,
  });

  return successRequest({
    res,
    code: 202,
    data,
    message: "Broadcast masuk antrean dan akan dikirim worker",
  });
}

async function listBroadcastsController(req, res) {
  const data = await listBroadcasts();
  return successRequest({ res, data });
}

module.exports = {
  getVapidPublicKeyController,
  subscribeController,
  unsubscribeController,
  sendTestController,
  createBroadcastController,
  listBroadcastsController,
};
