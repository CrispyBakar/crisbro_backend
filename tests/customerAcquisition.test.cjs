const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { Prisma } = require('@prisma/client');
const ROOT = path.resolve(__dirname, '..');
const CUSTOMER_A = '550e8400-e29b-41d4-a716-446655440001';
const CUSTOMER_B = '550e8400-e29b-41d4-a716-446655440002';
const UNKNOWN = '550e8400-e29b-41d4-a716-446655440009';
function load(file, deps) {
  const filename = path.join(ROOT, file);
  const realRequire = createRequire(filename);
  const ctx = { module: { exports: {} }, console, process: { env: {} }, require: name => Object.hasOwn(deps, name) ? deps[name] : realRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
  return ctx.module.exports;
}
function harness() {
  const h = { customers: [{ customer_id: CUSTOMER_A, user_id: 'user-a' }, { customer_id: CUSTOMER_B, user_id: 'user-b' }], acquisitions: [], failWrite: false };
  const prisma = {
    customer: { findUnique: async ({ where, select }) => { const [[key, value]] = Object.entries(where); assert.ok(value, 'findUnique tanpa nilai'); const customer = h.customers.find(row => row[key] === value); if (!customer) return null; return select?.customerAcquisition ? { customer_id: customer.customer_id, customerAcquisition: h.acquisitions.find(row => row.customer_id === customer.customer_id) ?? null } : customer; } },
    customerAcquisition: {
      create: async ({ data }) => {
        if (h.failWrite) throw Error('connection lost: postgres://secret');
        // Meniru unique constraint customer_id.
        if (h.acquisitions.some(row => row.customer_id === data.customer_id)) throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        const row = { customer_acquisition_id: `acq-${h.acquisitions.length + 1}`, ...data, created_at: new Date('2026-10-09T00:00:00Z') };
        h.acquisitions.push(row);
        return row;
      },
    },
  };
  h.service = load('src/services/customerAcquisition.service.js', { '../lib/prisma': prisma });
  h.controller = load('src/controllers/customerAcquisition.controller.js', { '../services/customerAcquisition.service': h.service });
  return h;
}
const res = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const quiet = async fn => { const original = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = original; } };

test('admin creates an acquisition for a customer; a second one is rejected', async () => {
  const h = harness();
  const created = await h.service.createCustomerAcquisition({ customer_id: CUSTOMER_A, source: 'instagram', captured_via: 'admin_input' });
  assert.deepEqual({ ...created, created_at: undefined }, { customer_acquisition_id: 'acq-1', customer_id: CUSTOMER_A, source: 'instagram', captured_via: 'admin_input', created_at: undefined });
  await assert.rejects(h.service.createCustomerAcquisition({ customer_id: CUSTOMER_A, source: 'tiktok', captured_via: 'admin_input' }), { code: 'ACQUISITION_ALREADY_EXISTS', statusCode: 409 });
  await assert.rejects(h.service.createCustomerAcquisition({ customer_id: UNKNOWN, source: 'tiktok', captured_via: 'admin_input' }), { code: 'CUSTOMER_NOT_FOUND', statusCode: 404 });
  assert.equal(h.acquisitions.length, 1);
});

test('customer creates their own acquisition from the session user', async () => {
  const h = harness();
  const created = await h.service.createMyCustomerAcquisition('user-b', { source: 'teman', captured_via: 'registration_form' });
  assert.equal(created.customer_id, CUSTOMER_B);
  await assert.rejects(h.service.createMyCustomerAcquisition('user-b', { source: 'teman', captured_via: 'registration_form' }), { statusCode: 409 });
  await assert.rejects(h.service.createMyCustomerAcquisition('user-without-customer', { source: 'teman', captured_via: 'registration_form' }), { statusCode: 404 });
  await assert.rejects(h.service.createMyCustomerAcquisition(undefined, { source: 'teman', captured_via: 'registration_form' }), { statusCode: 401 });
});

test('controllers validate the body, trim text and map errors to status codes', async () => {
  const h = harness();
  let response = res();
  await h.controller.createCustomerAcquisitionController({ body: { customer_id: CUSTOMER_A, source: '  instagram ', captured_via: 'admin_input' } }, response);
  assert.equal(response.code, 201);
  assert.equal(response.body.data.source, 'instagram');

  response = res();
  await h.controller.createCustomerAcquisitionController({ body: { customer_id: CUSTOMER_A, source: 'tiktok', captured_via: 'admin_input' } }, response);
  assert.equal(response.code, 409);
  assert.equal(response.body.message, 'Data akuisisi customer ini sudah tercatat');

  response = res();
  await h.controller.createCustomerAcquisitionController({ body: { customer_id: UNKNOWN, source: 'tiktok', captured_via: 'admin_input' } }, response);
  assert.equal(response.code, 404);

  for (const body of [undefined, {}, { customer_id: 'bad', source: 'a', captured_via: 'b' }, { customer_id: CUSTOMER_B, source: '   ', captured_via: 'b' }, { customer_id: CUSTOMER_B, source: 'a' }, { customer_id: CUSTOMER_B, source: 'a'.repeat(101), captured_via: 'b' }, { customer_id: CUSTOMER_B, source: 1, captured_via: 'b' }]) {
    response = res();
    await h.controller.createCustomerAcquisitionController({ body }, response);
    assert.equal(response.code, 422);
  }
  assert.equal(h.acquisitions.length, 1);
});

test('customer endpoint ignores customer_id from the body', async () => {
  const h = harness();
  const response = res();
  await h.controller.createMyCustomerAcquisitionController({ user: { user_id: 'user-b' }, body: { customer_id: CUSTOMER_A, source: 'outlet', captured_via: 'registration_form' } }, response);
  assert.equal(response.code, 201);
  assert.equal(response.body.data.customer_id, CUSTOMER_B);
  assert.deepEqual(h.acquisitions.map(row => row.customer_id), [CUSTOMER_B]);
});

test('unexpected database errors are not leaked to the client', async () => {
  const h = harness(); h.failWrite = true;
  const response = res();
  await quiet(() => h.controller.createMyCustomerAcquisitionController({ user: { user_id: 'user-a' }, body: { source: 'outlet', captured_via: 'registration_form' } }, response));
  assert.equal(response.code, 500);
  assert.ok(!JSON.stringify(response.body).includes('postgres'));
});

test('admin reads the acquisition of a specific customer', async () => {
  const h = harness();
  await h.service.createCustomerAcquisition({ customer_id: CUSTOMER_A, source: 'instagram', captured_via: 'admin_input' });
  const found = await h.service.getCustomerAcquisition(CUSTOMER_A);
  assert.equal(found.customer_id, CUSTOMER_A);
  assert.equal(found.source, 'instagram');
  assert.equal(found.captured_via, 'admin_input');
  await assert.rejects(h.service.getCustomerAcquisition(CUSTOMER_B), { code: 'ACQUISITION_NOT_FOUND', statusCode: 404 });
  await assert.rejects(h.service.getCustomerAcquisition(UNKNOWN), { code: 'CUSTOMER_NOT_FOUND', statusCode: 404 });

  let response = res();
  await h.controller.getCustomerAcquisitionController({ params: { customer_id: CUSTOMER_A } }, response);
  assert.equal(response.code, 200);
  assert.equal(response.body.data.source, 'instagram');

  response = res();
  await h.controller.getCustomerAcquisitionController({ params: { customer_id: CUSTOMER_B } }, response);
  assert.equal(response.code, 404);
  assert.equal(response.body.message, 'Data akuisisi customer ini belum tercatat');

  response = res();
  await h.controller.getCustomerAcquisitionController({ params: { customer_id: UNKNOWN } }, response);
  assert.equal(response.code, 404);
  assert.equal(response.body.message, 'Customer tidak ditemukan');

  response = res();
  await h.controller.getCustomerAcquisitionController({ params: { customer_id: 'bad' } }, response);
  assert.equal(response.code, 422);
});

test('routes guard every endpoint by role', () => {
  const h = harness(), routes = [], auth = () => {};
  load('src/routes/customerAcquisition.routes.js', {
    express: { Router: () => Object.fromEntries(['get', 'post'].map(method => [method, (...args) => routes.push([method, ...args])])) },
    '../middleware/authMiddleware': { auth, requireRole: (...roles) => roles.join(',') },
    '../controllers/customerAcquisition.controller': h.controller,
  });
  assert.deepEqual(routes, [
    ['post', '/me', auth, 'customer', h.controller.createMyCustomerAcquisitionController],
    ['post', '/', auth, 'admin,marketing', h.controller.createCustomerAcquisitionController],
    ['get', '/customer/:customer_id', auth, 'admin,marketing', h.controller.getCustomerAcquisitionController],
  ]);
});
