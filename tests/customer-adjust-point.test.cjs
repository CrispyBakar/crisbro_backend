const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const ROOT = path.resolve(__dirname, '..');

function load(file, deps) {
  const filename = path.join(ROOT, file);
  const realRequire = createRequire(filename);
  const ctx = { module: { exports: {} }, console: { log() {}, error() {} }, process: { env: {} }, setTimeout, require: name => Object.hasOwn(deps, name) ? deps[name] : realRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
  return ctx.module.exports;
}

// customer.service dengan prisma dan Runchise tiruan; `remote` adalah saldo di Runchise
function harness({ customer = {}, remote = { id: 77, available_point: 100, total_point: 300 }, adjustError, updateError } = {}) {
  const h = { adjustCalls: [], customerUpdates: [], remote };
  h.customer = { customer_id: 'c1', runchise_id: 77, phone_number: '81234567890', available_point: 100, total_point: 300, ...customer };
  const prisma = {
    customer: {
      findUnique: async () => h.customer,
      update: async ({ data }) => { if (updateError) throw updateError; h.customerUpdates.push(data); return { ...h.customer, ...data }; },
    },
    customerPointHistory: { createMany: async () => ({ count: 0 }) },
  };
  h.service = load('src/services/customer.service.js', {
    '../lib/prisma': prisma,
    './runchise.service': {
      findCustomerByPhone: async () => h.remote,
      getListCustomerPointHistory: async () => [],
      adjustCustomerPoint: async (...args) => {
        h.adjustCalls.push(args);
        if (adjustError) throw adjustError;
        const delta = args[2] === 'add' ? args[1] : -args[1];
        h.remote = { ...h.remote, available_point: h.remote.available_point + delta };
      },
    },
    './auth.service': { buildLocalCustomerData: () => ({}) },
    './emailVerification.service': {},
  });
  return h;
}

test('add point reaches Runchise and local balance follows Runchise', async () => {
  const h = harness();
  const result = await h.service.adjustPointCustomer('c1', { point: 50, type: 'add', notes: 'Kompensasi' });

  assert.deepEqual(h.adjustCalls, [[77, 50, 'add', 'Kompensasi']]);
  assert.equal(result.synced, true);
  assert.equal(result.customer.available_point, 150);
  assert.equal(result.customer.total_point, 300);
});

test('subtract above the Runchise balance is rejected before adjusting', async () => {
  // Saldo lokal masih 500 (tertinggal), tapi saldo Runchise hanya 100
  const h = harness({ customer: { available_point: 500 } });

  await assert.rejects(
    h.service.adjustPointCustomer('c1', { point: 200, type: 'subtract' }),
    { message: 'Poin customer tidak mencukupi' },
  );
  assert.deepEqual(h.adjustCalls, []);
});

test('customer without Runchise link is rejected', async () => {
  const h = harness({ customer: { runchise_id: null } });

  await assert.rejects(
    h.service.adjustPointCustomer('c1', { point: 10, type: 'add' }),
    { message: 'Customer belum terhubung ke Runchise, tidak bisa update' },
  );
  assert.deepEqual(h.adjustCalls, []);
});

test('failed adjust is not retried', async () => {
  const error = Object.assign(new Error('timeout'), { code: 'RUNCHISE_REQUEST_FAILED' });
  const h = harness({ adjustError: error });

  await assert.rejects(h.service.adjustPointCustomer('c1', { point: 10, type: 'add' }), error);
  assert.equal(h.adjustCalls.length, 1);
});

test('local sync failure after a successful adjust still succeeds', async () => {
  const h = harness({ updateError: new Error('db down') });
  const result = await h.service.adjustPointCustomer('c1', { point: 10, type: 'add' });

  assert.equal(h.adjustCalls.length, 1);
  assert.equal(result.synced, false);
});
