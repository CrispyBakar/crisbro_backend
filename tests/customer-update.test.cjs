const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');
const DOB = new Date('1995-03-12T00:00:00.000Z');

function load(file, deps) {
  const filename = path.join(ROOT, file);
  const realRequire = createRequire(filename);
  const ctx = { module: { exports: {} }, console: { log() {}, error() {} }, process: { env: {} }, require: name => Object.hasOwn(deps, name) ? deps[name] : realRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
  return ctx.module.exports;
}

// customer.service dengan prisma dan Runchise tiruan; `customer` adalah baris lokal saat ini
function harness(customer = {}) {
  const h = { runchiseCalls: [], customerUpdates: [], userUpdates: [], takenEmails: [] };
  h.customer = { customer_id: 'c1', user_id: 'u1', runchise_id: 77, runchise_location_id: 10, name: 'Budi', phone_number: '81234567890', dob: null, user: { email: 'lama@email.com' }, ...customer };
  const customerModel = { update: async ({ data }) => { h.customerUpdates.push(data); return { ...h.customer, ...data }; } };
  const prisma = {
    customer: { findUnique: async () => h.customer, ...customerModel },
    user: { findFirst: async ({ where }) => h.takenEmails.includes(where.email) ? { user_id: 'u2' } : null },
    $transaction: async fn => fn({ customer: customerModel, user: { update: async ({ data }) => { h.userUpdates.push(data); } } }),
  };
  h.service = load('src/services/customer.service.js', {
    '../lib/prisma': prisma,
    './runchise.service': { updateCustomer: async (id, locationId, data) => { h.runchiseCalls.push({ id, locationId, data: { ...data } }); } },
    './auth.service': { buildLocalCustomerData: () => ({}) },
    './emailVerification.service': { createEmailVerificationToken: () => ({ token: 't', expiresAt: new Date(0), fields: { email_verified: false } }), deliverEmailVerificationSafely: async () => {} },
  });
  return h;
}

test('email change reaches Runchise and the local user', async () => {
  const h = harness();
  await h.service.updateCustomerById('c1', { email: 'baru@email.com' });
  assert.deepEqual(h.runchiseCalls, [{ id: 77, locationId: 10, data: { email: 'baru@email.com' } }]);
  assert.equal(h.userUpdates[0].email, 'baru@email.com');
});

test('dob change reaches Runchise and the local customer', async () => {
  const h = harness();
  await h.service.updateCustomerById('c1', { dob: DOB });
  assert.equal(h.runchiseCalls.length, 1);
  assert.equal(new Date(h.runchiseCalls[0].data.dob).toISOString(), DOB.toISOString());
  assert.equal(new Date(h.customerUpdates[0].dob).toISOString(), DOB.toISOString());
});

test('clearing dob sends null to Runchise', async () => {
  const h = harness({ dob: DOB });
  await h.service.updateCustomerById('c1', { dob: null });
  assert.deepEqual(h.runchiseCalls.map(call => call.data), [{ dob: null }]);
  assert.equal(h.customerUpdates[0].dob, null);
});

test('unchanged email and dob are not resent with other fields', async () => {
  const h = harness({ dob: DOB });
  await h.service.updateCustomerById('c1', { name: 'Budi S.', email: 'lama@email.com', dob: new Date(DOB) });
  assert.deepEqual(h.runchiseCalls.map(call => call.data), [{ name: 'Budi S.' }]);
});

test('unchanged email and dob alone do not call Runchise', async () => {
  const h = harness({ dob: DOB });
  await h.service.updateCustomerById('c1', { email: 'lama@email.com', dob: new Date(DOB) });
  assert.equal(h.runchiseCalls.length, 0);
});

test('customer not linked to Runchise still saves email and dob locally', async () => {
  const h = harness({ runchise_id: null, runchise_location_id: null });
  await h.service.updateCustomerById('c1', { email: 'baru@email.com', dob: DOB });
  assert.equal(h.runchiseCalls.length, 0);
  assert.equal(h.userUpdates[0].email, 'baru@email.com');
  assert.equal(new Date(h.customerUpdates[0].dob).toISOString(), DOB.toISOString());
});

test('customer not linked to Runchise still cannot change Runchise fields', async () => {
  const h = harness({ runchise_id: null, runchise_location_id: null });
  await assert.rejects(h.service.updateCustomerById('c1', { name: 'Budi S.', email: 'baru@email.com' }), /belum terhubung ke Runchise/);
  assert.equal(h.runchiseCalls.length, 0);
  assert.equal(h.userUpdates.length, 0);
});

test('email already used by another user is rejected before Runchise is called', async () => {
  const h = harness();
  h.takenEmails.push('baru@email.com');
  await assert.rejects(h.service.updateCustomerById('c1', { email: 'baru@email.com' }), /Email is already registered/);
  assert.equal(h.runchiseCalls.length, 0);
});

// runchise.service dengan axios tiruan yang merekam body PATCH
function runchiseHarness() {
  const h = { patches: [], fail: null };
  const axios = {
    create: () => ({ patch: async (url, body) => { if (h.fail) throw h.fail; h.patches.push({ url, body }); return { data: { customer: { id: 77 } } }; } }),
    isAxiosError: error => Boolean(error?.isAxiosError),
  };
  h.service = load('src/services/runchise.service.js', { axios, dotenv: { config() {} }, '../lib/prisma': {} });
  return h;
}

test('Runchise receives dob as a date-only string, email as-is', async () => {
  const h = runchiseHarness();
  await h.service.updateCustomer(77, 10, { email: 'baru@email.com', dob: DOB });
  assert.equal(h.patches[0].url, '/locations/10/customers/77');
  assert.deepEqual({ ...h.patches[0].body }, { email: 'baru@email.com', dob: '1995-03-12' });
});

test('Runchise receives null when dob is cleared and no dob key when absent', async () => {
  const h = runchiseHarness();
  await h.service.updateCustomer(77, 10, { dob: null });
  await h.service.updateCustomer(77, 10, { name: 'Budi' });
  assert.deepEqual({ ...h.patches[0].body }, { dob: null });
  assert.deepEqual({ ...h.patches[1].body }, { name: 'Budi' });
});

test('failures without a Runchise response keep their own message', async () => {
  const h = runchiseHarness();
  await assert.rejects(h.service.updateCustomer(77, 10, { email: 'bukan-email' }), /email/);
  h.fail = Object.assign(new Error('timeout of 60000ms exceeded'), { isAxiosError: true });
  await assert.rejects(h.service.updateCustomer(77, 10, { name: 'Budi' }), /timeout of 60000ms exceeded/);
  assert.equal(h.patches.length, 0);
});
