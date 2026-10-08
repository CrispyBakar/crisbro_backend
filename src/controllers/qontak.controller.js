const {
  sendMessageViaBot,
} = require("../integration/qontak/qontak.integration");
const {
  verifyUserPhone,
  requestPasswordResetByPhone,
} = require("../services/auth.service");
const { badRequest, successRequest } = require("../utils/responseReuest");
const { serializeAuthUser } = require("./auth.controller");

function flattenAxiosError(error) {
  const data = error.response?.data;

  if (!data) return error.message;
  if (typeof data === "string") return data;

  // kalau object/array -> flatten jadi satu string
  return JSON.stringify(data);
}

const failed_message = `Verifikasi akun *Crisbro* kamu belum berhasil. ❌\nDimohon untuk tidak merubah format pesan sebelum dikirim.\nSilahkan mengirim permintaan ulang melalui *Crisbro* app.`;

const success_message = `Yey, akun *Crisbro* kamu sudah aktif! 🎉\nSekarang kamu sudah resmi jadi bagian dari *Crisbro*. Yuk, langsung jelajahi dan nikmati semua fiturnya sekarang!\n\nhttps://app.crisbro.id`;

// Baris pertama pesan WhatsApp yang dikirim customer untuk meminta reset password.
const RESET_PASSWORD_KEYWORD = "RESET PASSWORD CRISBRO";

const reset_failed_message = `Reset password akun *Crisbro* kamu belum berhasil. ❌\nNomor WhatsApp ini belum terdaftar atau akunnya belum aktif.\nSilahkan hubungi Admin *Crisbro*.`;

function resetPasswordMessage({ resetUrl, expiresAt }) {
  const expiryText = new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(expiresAt);

  return `Berikut tautan untuk mengatur ulang password akun *Crisbro* kamu:\n\n${resetUrl}\n\nTautan hanya bisa dipakai satu kali dan berlaku sampai ${expiryText} WIB.\nJika kamu tidak meminta reset password, abaikan pesan ini.`;
}

async function sendBotMessageSafely({ room_id, text }) {
  try {
    await sendMessageViaBot({ room_id, text });
  } catch (error) {
    // Delivery of the reply must not turn an already received webhook into a
    // failed request, otherwise Qontak will retry the same interaction.
    console.error("Failed to send Qontak bot reply:", flattenAxiosError(error));
  }
}

// Nomor pengirim pesan menjadi identitasnya: link hanya dibalas ke room
// WhatsApp tempat permintaan itu datang.
async function replyResetPasswordLink({ res, room_id, phone }) {
  let text = reset_failed_message;

  try {
    const reset = await requestPasswordResetByPhone(phone);
    if (reset) text = resetPasswordMessage(reset);
  } catch (error) {
    console.error(
      "Qontak reset password request failed:",
      flattenAxiosError(error),
    );
  }

  await sendBotMessageSafely({ room_id, text });

  // Sama seperti aktivasi: selalu 200 agar Qontak tidak mengulang pesan ini.
  return successRequest({ res, code: 200, data: null });
}

async function receiveQontakMessageInteraction(req, res) {
  const payload = req.body;

  if (!payload)
    return badRequest({
      code: 400,
      res,
      error: "Failed receive message payload",
    });

  const room_id = payload.room_id ?? undefined;
  const sender_id = payload.sender_id ?? undefined;
  const text = payload.text ?? undefined;
  const phone = payload.room?.account_uniq_id ?? undefined;

  if (!room_id || !sender_id || !text || !phone) {
    return successRequest({
      code: 200,
      res,
      message: "room_id, sender_id, text, account_uniq_id must be required",
    });
  }

  console.log("room_id: ", room_id);
  console.log("Phone: ", phone);

  try {
    // Validate is crisbro validation message.
    const identifier = text.split("\n") ?? undefined;

    // Loloskan kalau tidak bisa di split
    // Karena pasti bukan aktivasi crisbro
    if (!identifier) return successRequest({ res, data: null, code: 200 });

    if (identifier[0].trim().toUpperCase() === RESET_PASSWORD_KEYWORD)
      return replyResetPasswordLink({ res, room_id, phone });

    // Loloskan apabila bukan aktivasi crisbro
    if (identifier[0] !== "AKTIVASI CRISBRO")
      return successRequest({ res, data: null, code: 200 });

    const [_, noRef] = identifier[2].split(":") ?? undefined;

    // Verify phone
    const verify = await verifyUserPhone({ raw_phone: phone, noRef: noRef });

    if (!verify) {
      await sendBotMessageSafely({ room_id, text: failed_message });

      console.log(serializeAuthUser(verify));
      return successRequest({
        res,
        code: 200,
        data: null,
        message: "Webhook received; phone verification failed",
      });
    }

    // Success and send message to customer
    await sendBotMessageSafely({ room_id, text: success_message });

    console.log(serializeAuthUser(verify));
    return successRequest({ res, code: 200, data: null });
  } catch (error) {
    console.error(
      "Qontak phone verification failed:",
      flattenAxiosError(error),
    );
    await sendBotMessageSafely({ room_id, text: failed_message });

    // A verification error is a processed webhook, not a transport failure.
    // Returning 200 prevents Qontak from retrying the same message.
    return successRequest({
      res,
      code: 200,
      data: null,
      message: "Webhook received; phone verification failed",
    });
  }
}

module.exports = { receiveQontakMessageInteraction };
