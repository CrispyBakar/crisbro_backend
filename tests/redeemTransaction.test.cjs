const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const uuid = n => `550e8400-e29b-41d4-a716-44665544000${n}`;
const [REDEEM_A, REDEEM_B, REDEEM_C, PROMO_ID, PRODUCT_ID, CUSTOMER_A, CUSTOMER_B] = [1, 2, 3, 4, 5, 6, 7].map(uuid);
function load(file, deps) {
  const filename = path.join(ROOT, file);
  const realRequire = createRequire(filename);
  const ctx = { module: { exports: {} }, console, process: { env: {} }, require: name => Object.hasOwn(deps, name) ? deps[name] : realRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
  return ctx.module.exports;
}
// Meniru `select` Prisma supaya kolom yang tidak dipilih tidak ikut terbaca.
function pick(row, select) {
  if (row == null) return row;
  return Object.fromEntries(Object.entries(select).map(([key, value]) => [key, value === true ? row[key] : pick(row[key], value.select)]));
}
const contains = (value, filter) => filter.mode === 'insensitive' ? value.toLowerCase().includes(filter.contains.toLowerCase()) : value.includes(filter.contains);
function matches(row, where) {
  if (where.redeem_transaction_id && row.redeem_transaction_id !== where.redeem_transaction_id) return false;
  if (where.customer_id && row.customer_id !== where.customer_id) return false;
  if (where.customer?.user_id && row.customer.user_id !== where.customer.user_id) return false;
  if (where.customer?.name && !contains(row.customer.name, where.customer.name)) return false;
  if (where.customer?.phone_number && !contains(row.customer.phone_number, where.customer.phone_number)) return false;
  if (where.promoCode?.promo_id && row.promoCode.promo_id !== where.promoCode.promo_id) return false;
  if (where.promoCode?.code && !contains(row.promoCode.code, where.promoCode.code)) return false;
  if (where.promoCode?.promo?.name && !contains(row.promoCode.promo.name, where.promoCode.promo.name)) return false;
  if (where.OR && !where.OR.some(clause => matches(row, clause))) return false;
  return true;
}
function harness() {
  const promo = { promo_id: PROMO_ID, name: 'Gratis Ayam', status: 'active', start_date: new Date('2026-10-01'), end_date: new Date('2026-10-31'), terms_conditions: 'Berlaku dine in', product_ids: [PRODUCT_ID], runchise_id: 42 };
  const customers = [
    { customer_id: CUSTOMER_A, user_id: 'user-a', name: 'Budi', phone_number: '81200000001', phone_number_country_code: 62, available_point: 900, user: { email: 'budi@mail.test', password_hash: 'secret' } },
    { customer_id: CUSTOMER_B, user_id: 'user-b', name: 'Sari', phone_number: '81200000002', phone_number_country_code: 62, available_point: 100, user: { email: 'sari@mail.test', password_hash: 'secret' } },
  ];
  const redeem = (id, customer, code, redeemed_at) => ({ redeem_transaction_id: id, customer_id: customer.customer_id, promo_code_id: `code-${code}`, points_spent: 50, redeemed_at: new Date(redeemed_at), customer, promoCode: { promo_code_id: `code-${code}`, promo_id: PROMO_ID, code, status: 'active', maximum_usage: 1, number_of_usage: 0, last_usage: null, is_claimed: true, promo } });
  const h = { productQueries: 0, rows: [redeem(REDEEM_A, customers[0], 'AYAM1', '2026-10-05'), redeem(REDEEM_B, customers[0], 'AYAM2', '2026-10-07'), redeem(REDEEM_C, customers[1], 'AYAM3', '2026-10-06')] };
  const find = ({ where, select, skip = 0, take, orderBy }) => {
    const direction = orderBy?.[0].redeemed_at === 'asc' ? 1 : -1;
    const found = h.rows.filter(row => matches(row, where)).sort((a, b) => direction * (a.redeemed_at - b.redeemed_at));
    return found.slice(skip, take === undefined ? undefined : skip + take).map(row => pick(row, select));
  };
  const prisma = {
    redeemTransaction: { findMany: async args => find(args), findFirst: async args => find(args)[0] ?? null, count: async ({ where }) => h.rows.filter(row => matches(row, where)).length },
    products: { findMany: async ({ where, select }) => { h.productQueries++; return [{ product_id: PRODUCT_ID, name: 'Ayam Crisbar', sku: 'AYM', description: 'Ayam goreng', image_url: 'https://img.test/ayam.png', sell_price: '25000' }].filter(product => where.product_id.in.includes(product.product_id)).map(product => pick(product, select)); } },
    $transaction: async queries => Promise.all(queries),
  };
  h.service = load('src/services/redeemTransaction.service.js', { '../lib/prisma': prisma, './runchise.service': {}, '../lib/runchiseRetry': {} });
  h.controller = load('src/controllers/redeemTransaction.controller.js', { '../services/redeemTransaction.service': h.service });
  return h;
}
const res = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const page = { page: 1, limit: 10, sort_order: 'desc' };

test('customer list only returns their own vouchers, newest first, without customer data or terms', async () => {
  const h = harness();
  const result = await h.service.listMyRedeemedVouchers('user-a', page);
  assert.deepEqual(result.data.map(row => row.redeem_transaction_id), [REDEEM_B, REDEEM_A]);
  assert.deepEqual({ ...result.meta }, { page: 1, limit: 10, total: 2, total_pages: 1 });
  const [voucher] = result.data;
  assert.equal(voucher.promo_code.code, 'AYAM2');
  assert.equal(voucher.points_spent, 50);
  assert.equal(voucher.promo.end_date.toISOString(), '2026-10-31T00:00:00.000Z');
  assert.equal(voucher.products[0].name, 'Ayam Crisbar');
  assert.equal(voucher.customer, undefined);
  assert.equal(voucher.promo.terms_conditions, undefined);
  assert.equal(voucher.promo.product_ids, undefined);
  assert.equal(h.productQueries, 1);
});

test('customer list paginates and sorts', async () => {
  const h = harness();
  const result = await h.service.listMyRedeemedVouchers('user-a', { page: 2, limit: 1, sort_order: 'asc' });
  assert.deepEqual(result.data.map(row => row.redeem_transaction_id), [REDEEM_B]);
  assert.deepEqual({ ...result.meta }, { page: 2, limit: 1, total: 2, total_pages: 2 });
});

test('customer detail includes product, promo period and terms; other customers get 404', async () => {
  const h = harness();
  const voucher = await h.service.getMyRedeemedVoucher('user-a', REDEEM_A);
  assert.equal(voucher.promo.terms_conditions, 'Berlaku dine in');
  assert.equal(voucher.promo.start_date.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(voucher.products[0].product_id, PRODUCT_ID);
  assert.equal(voucher.products[0].sell_price, undefined);
  assert.equal(voucher.customer, undefined);
  await assert.rejects(h.service.getMyRedeemedVoucher('user-a', REDEEM_C), { code: 'REDEEM_TRANSACTION_NOT_FOUND', statusCode: 404 });
});

test('missing user_id never falls through to every customer', async () => {
  const h = harness();
  await assert.rejects(h.service.listMyRedeemedVouchers(undefined, page), { statusCode: 401 });
  await assert.rejects(h.service.getMyRedeemedVoucher(undefined, REDEEM_A), { statusCode: 401 });
});

test('admin list shows who redeemed and supports search and filters', async () => {
  const h = harness();
  const all = await h.service.listRedeemedVouchers({ ...page, search: '' });
  assert.equal(all.meta.total, 3);
  assert.deepEqual({ ...all.data[0].customer }, { customer_id: CUSTOMER_A, name: 'Budi', phone_number: '81200000001', phone_number_country_code: 62, email: 'budi@mail.test' });
  assert.equal(all.data[0].promo.terms_conditions, undefined);
  const ids = async query => (await h.service.listRedeemedVouchers({ ...page, search: '', ...query })).data.map(row => row.redeem_transaction_id);
  assert.deepEqual(await ids({ search: 'sari' }), [REDEEM_C]);
  assert.deepEqual(await ids({ search: 'ayam1' }), [REDEEM_A]);
  assert.deepEqual(await ids({ search: '0000002' }), [REDEEM_C]);
  assert.deepEqual(await ids({ search: 'gratis' }), [REDEEM_B, REDEEM_C, REDEEM_A]);
  assert.deepEqual(await ids({ customer_id: CUSTOMER_B }), [REDEEM_C]);
  assert.deepEqual(await ids({ promo_id: uuid(9) }), []);
});

test('admin detail includes customer and terms; unknown id is 404', async () => {
  const h = harness();
  const voucher = await h.service.getRedeemedVoucher(REDEEM_C);
  assert.equal(voucher.customer.name, 'Sari');
  assert.equal(voucher.customer.email, 'sari@mail.test');
  assert.equal(voucher.promo.terms_conditions, 'Berlaku dine in');
  await assert.rejects(h.service.getRedeemedVoucher(uuid(9)), { statusCode: 404 });
});

test('controllers validate input and take the customer from the session', async () => {
  const h = harness();
  let response = res();
  await h.controller.listMyRedeemedVouchersController({ user: { user_id: 'user-b' }, query: { limit: '5' } }, response);
  assert.equal(response.code, 200);
  assert.deepEqual(response.body.data.data.map(row => row.redeem_transaction_id), [REDEEM_C]);
  assert.equal(response.body.data.meta.limit, 5);

  response = res();
  await h.controller.getMyRedeemedVoucherController({ user: { user_id: 'user-b' }, params: { redeem_transaction_id: REDEEM_A } }, response);
  assert.equal(response.code, 404);
  assert.equal(response.body.message, 'Voucher tidak ditemukan');

  response = res();
  await h.controller.getMyRedeemedVoucherController({ user: { user_id: 'user-b' }, params: { redeem_transaction_id: 'bad' } }, response);
  assert.equal(response.code, 422);

  response = res();
  await h.controller.listRedeemedVouchersController({ query: { search: 'budi', page: '1' } }, response);
  assert.equal(response.code, 200);
  assert.equal(response.body.data.meta.total, 2);

  for (const query of [{ limit: '101' }, { page: '0' }, { sort_order: 'up' }, { customer_id: 'bad' }]) {
    response = res();
    await h.controller.listRedeemedVouchersController({ query }, response);
    assert.equal(response.code, 422);
  }

  response = res();
  await h.controller.getRedeemedVoucherController({ params: { redeem_transaction_id: REDEEM_A } }, response);
  assert.equal(response.code, 200);
  assert.equal(response.body.data.customer.name, 'Budi');
});

test('routes guard customer and admin/marketing endpoints by role', () => {
  const h = harness(), routes = [], auth = () => {}, requireValidPhone = () => {};
  load('src/routes/redeemTransaction.routes.js', {
    express: { Router: () => Object.fromEntries(['get', 'post'].map(method => [method, (...args) => routes.push([method, ...args])])) },
    '../middleware/authMiddleware': { auth, requireValidPhone, requireRole: (...roles) => roles.join(',') },
    '../controllers/redeemTransaction.controller': h.controller,
  });
  const gets = routes.filter(route => route[0] === 'get').map(([, routePath, ...handlers]) => [routePath, ...handlers]);
  assert.deepEqual(gets, [
    ['/me', auth, 'customer', h.controller.listMyRedeemedVouchersController],
    ['/me/:redeem_transaction_id', auth, 'customer', h.controller.getMyRedeemedVoucherController],
    ['/', auth, 'admin,marketing', h.controller.listRedeemedVouchersController],
    ['/:redeem_transaction_id', auth, 'admin,marketing', h.controller.getRedeemedVoucherController],
  ]);
});
