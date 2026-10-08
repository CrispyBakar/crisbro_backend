const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');

function load(file, deps, env) {
  const filename = path.join(ROOT, file);
  const realRequire = createRequire(filename);
  const ctx = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} }, process: { env }, URL, require: name => Object.hasOwn(deps, name) ? deps[name] : realRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
  return ctx.module.exports;
}

const sha256 = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');

// auth.service dengan prisma dan email tiruan; `user` adalah satu-satunya baris User
function harness({ user = {}, env = {}, sendMail } = {}) {
  const h = { emails: [], revoked: [] };
  h.user = { user_id: 'u1', email: 'Budi@Email.com', username: 'budi', phone: '81234567890', role: 'customer', status: 'active', password_hash: 'lama', forgot_password_token: null, ...user };
  // Setiap syarat di `where` harus cocok, jadi filter tambahan (mis. phone_verified) ikut teruji
  const matches = where => Object.entries(where).every(([field, value]) =>
    field === 'email' ? value.equals === h.user.email.toLowerCase()
      : value?.in ? value.in.includes(h.user[field])
      : value === h.user[field]);
  const userModel = {
    findFirst: async ({ where }) => matches(where) ? h.user : null,
    update: async ({ data }) => Object.assign(h.user, data),
    updateMany: async ({ where, data }) => matches(where) ? (Object.assign(h.user, data), { count: 1 }) : { count: 0 },
  };
  const prisma = { user: userModel, $transaction: async fn => fn({ user: userModel }) };
  h.service = load('src/services/auth.service.js', {
    '../lib/prisma': prisma,
    './email.service': { sendResetPasswordEmail: sendMail ?? (async mail => { h.emails.push(mail); return { sent: true }; }) },
    './emailVerification.service': {},
    './session.service': { revokeUserSessions: async userId => { h.revoked.push(userId); } },
    './runchise.service': {},
    './saleTransaction.service': {},
  }, { FRONTEND_URL: 'https://app.test/', ...env });
  h.tokenFromEmail = () => new URL(h.emails.at(-1).resetUrl).searchParams.get('token');
  return h;
}

const invalidToken = error => error.statusCode === 400 && /tidak valid atau sudah kedaluwarsa/.test(error.message);

test('unknown email sends nothing and stores nothing', async () => {
  const h = harness();
  await h.service.requestPasswordReset('lain@email.com');
  assert.equal(h.emails.length, 0);
  assert.equal(h.user.forgot_password_token, null);
});

test('inactive user gets no reset link', async () => {
  const h = harness({ user: { status: 'inactive' } });
  await h.service.requestPasswordReset('budi@email.com');
  assert.equal(h.emails.length, 0);
});

test('active customer with unverified phone still gets the link and can reset', async () => {
  const h = harness({ user: { role: 'customer', phone_verified: false, email_verified: false } });
  await h.service.requestPasswordReset('budi@email.com');
  assert.equal(h.emails.length, 1);
  await h.service.resetUserPassword(h.tokenFromEmail(), 'PasswordBaru1');
  assert.ok(await bcrypt.compare('PasswordBaru1', h.user.password_hash));
});

test('request emails a link whose token is stored only as a hash', async () => {
  const h = harness();
  await h.service.requestPasswordReset('  BUDI@email.com ');
  const [mail] = h.emails;
  assert.equal(mail.to, 'Budi@Email.com');
  assert.ok(mail.resetUrl.startsWith('https://app.test/reset-password?token='));
  assert.ok(mail.expiresAt.getTime() > Date.now());
  const token = h.tokenFromEmail();
  assert.notEqual(h.user.forgot_password_token, token);
  assert.equal(h.user.forgot_password_token, sha256(token));
});

test('email failure does not reveal that the account exists', async () => {
  const h = harness({ sendMail: async () => { throw new Error('SMTP down'); } });
  await h.service.requestPasswordReset('budi@email.com');
  assert.ok(h.user.forgot_password_token);
});

test('valid token sets the new password, clears the token and revokes sessions', async () => {
  const h = harness();
  await h.service.requestPasswordReset('budi@email.com');
  await h.service.resetUserPassword(h.tokenFromEmail(), 'PasswordBaru1');
  assert.ok(await bcrypt.compare('PasswordBaru1', h.user.password_hash));
  assert.equal(h.user.forgot_password_token, null);
  assert.deepEqual(h.revoked, ['u1']);
});

test('token cannot be used twice', async () => {
  const h = harness();
  await h.service.requestPasswordReset('budi@email.com');
  const token = h.tokenFromEmail();
  await h.service.resetUserPassword(token, 'PasswordBaru1');
  await assert.rejects(h.service.resetUserPassword(token, 'PasswordLain2'), invalidToken);
  assert.ok(await bcrypt.compare('PasswordBaru1', h.user.password_hash));
});

test('a newer request invalidates the older link', async () => {
  const h = harness();
  await h.service.requestPasswordReset('budi@email.com');
  const older = h.tokenFromEmail();
  await h.service.requestPasswordReset('budi@email.com');
  await assert.rejects(h.service.resetUserPassword(older, 'PasswordBaru1'), invalidToken);
  assert.equal(h.user.password_hash, 'lama');
});

test('expired token is rejected', async () => {
  const h = harness({ env: { RESET_PASSWORD_TTL_MINUTES: '0.0001' } });
  await h.service.requestPasswordReset('budi@email.com');
  await new Promise(resolve => setTimeout(resolve, 30));
  await assert.rejects(h.service.resetUserPassword(h.tokenFromEmail(), 'PasswordBaru1'), invalidToken);
  assert.equal(h.user.password_hash, 'lama');
});

test('extending the expiry inside the token breaks the hash match', async () => {
  const h = harness({ env: { RESET_PASSWORD_TTL_MINUTES: '0.0001' } });
  await h.service.requestPasswordReset('budi@email.com');
  const [random] = h.tokenFromEmail().split('.');
  const forged = `${random}.${(Date.now() + 3_600_000).toString(36)}`;
  await assert.rejects(h.service.resetUserPassword(forged, 'PasswordBaru1'), invalidToken);
  assert.equal(h.user.password_hash, 'lama');
});

test('phone request returns a working link for any format of the customer number', async () => {
  for (const phone of ['6281234567890', '081234567890', '+62 812-3456-7890']) {
    const h = harness({ user: { phone_verified: false } });
    const reset = await h.service.requestPasswordResetByPhone(phone);
    assert.equal(h.user.forgot_password_token, sha256(new URL(reset.resetUrl).searchParams.get('token')));
    assert.ok(reset.expiresAt.getTime() > Date.now());
    assert.equal(h.emails.length, 0);
    await h.service.resetUserPassword(new URL(reset.resetUrl).searchParams.get('token'), 'PasswordBaru1');
    assert.ok(await bcrypt.compare('PasswordBaru1', h.user.password_hash));
  }
});

test('phone request is refused for unknown numbers, staff and inactive customers', async () => {
  const cases = [[{}, '6289999999999'], [{ role: 'marketing' }, '6281234567890'], [{ status: 'inactive' }, '6281234567890'], [{}, ''], [{}, undefined]];
  for (const [user, phone] of cases) {
    const h = harness({ user });
    assert.equal(await h.service.requestPasswordResetByPhone(phone), null);
    assert.equal(h.user.forgot_password_token, null);
  }
});

// qontak.controller dengan service dan bot tiruan
function webhook({ reset, resetError } = {}) {
  const w = { sent: [], resetPhones: [], verified: [] };
  const controller = load('src/controllers/qontak.controller.js', {
    '../integration/qontak/qontak.integration': { sendMessageViaBot: async message => { w.sent.push(message); } },
    '../services/auth.service': {
      verifyUserPhone: async args => { w.verified.push({ ...args }); return { user_id: 'u1' }; },
      requestPasswordResetByPhone: async phone => { w.resetPhones.push(phone); if (resetError) throw resetError; return reset ?? null; },
    },
    './auth.controller': { serializeAuthUser: user => user },
  }, {});
  w.receive = async text => {
    const res = { status(code) { w.status = code; return res; }, json(body) { w.body = body; return res; } };
    await controller.receiveQontakMessageInteraction({ body: { room_id: 'room-1', sender_id: 's1', text, room: { account_uniq_id: '6281234567890' } } }, res);
  };
  return w;
}

test('webhook replies to the sender room with the reset link', async () => {
  const w = webhook({ reset: { resetUrl: 'https://app.test/reset-password?token=abc', expiresAt: new Date('2026-10-08T05:00:00Z') } });
  await w.receive('reset password crisbro \nHarap kirim pesan ini tanpa merubah apapun.');
  assert.deepEqual(w.resetPhones, ['6281234567890']);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].room_id, 'room-1');
  assert.ok(w.sent[0].text.includes('https://app.test/reset-password?token=abc'));
  assert.ok(w.sent[0].text.includes('12.00 WIB'));
  assert.equal(w.status, 200);
  assert.equal(w.verified.length, 0);
});

test('webhook replies with a failure message and no link when the request is refused or errors', async () => {
  for (const options of [{}, { resetError: new Error('db down') }]) {
    const w = webhook(options);
    await w.receive('RESET PASSWORD CRISBRO');
    assert.equal(w.sent.length, 1);
    assert.ok(w.sent[0].text.includes('belum berhasil'));
    assert.ok(!w.sent[0].text.includes('http'));
    assert.equal(w.status, 200);
  }
});

test('webhook still handles activation messages and ignores other chats', async () => {
  const w = webhook();
  await w.receive('AKTIVASI CRISBRO\nHarap kirim pesan ini tanpa merubah apapun.\nNo.ref:ABC123');
  assert.deepEqual(w.verified, [{ raw_phone: '6281234567890', noRef: 'ABC123' }]);
  await w.receive('halo admin');
  assert.equal(w.resetPhones.length, 0);
  assert.equal(w.sent.length, 1);
});

test('malformed tokens are rejected', async () => {
  const h = harness();
  for (const token of [undefined, '', 'abc', 'a'.repeat(64), `${'a'.repeat(64)}.`]) {
    await assert.rejects(h.service.resetUserPassword(token, 'PasswordBaru1'), invalidToken);
  }
});
