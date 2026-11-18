import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createPlantServer } from '../server/index.js';
import { PlantStore } from '../server/store.js';
import { Accounts } from '../server/accounts.js';

let directory, dbPath, store, server, url, catalog;
const price = (id) => catalog.products.find((product) => product.id === id).price;

async function request(path, options) {
  const response = await fetch(url + path, options);
  return { status: response.status, type: response.headers.get('content-type'), cookie: response.headers.get('set-cookie'), body: await response.json() };
}

const post = (path, body, cookie, headers) => request(path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers },
  body: JSON.stringify(body),
});
const get = (path, cookie) => request(path, cookie ? { headers: { Cookie: cookie } } : undefined);
const sessionCookie = ({ cookie }) => cookie.split(';')[0];

function example(overrides = {}) {
  return {
    code: randomUUID(), name: 'Тестовый покупатель', phone: '+7 (900) 000-00-00', method: 'pickup',
    address: '', consent: true, comment: 'Проверка API',
    items: [{ productId: 1, quantity: 2 }, { productId: 2, quantity: 3 }],
    ...overrides,
  };
}

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'forma-'));
  dbPath = join(directory, 'test.sqlite');
  store = new PlantStore(dbPath);
  server = await createPlantServer({ store });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  catalog = (await request('/api/catalog')).body;
});

after(async () => {
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  store?.close();
  if (directory) rmSync(directory, { force: true, recursive: true });
});

test('API health and seeded catalog', async () => {
  assert.deepEqual((await request('/api/health')).body, { status: 'ok' });
  assert.equal(catalog.categories.length, 4);
  assert.equal(catalog.products.length, 12);
  for (const category of catalog.categories) {
    assert.equal(catalog.products.filter((product) => product.category === category.id).length, 3);
  }
  assert.equal(catalog.products.filter(({ stock }) => stock === 0).length, 1);
  assert.equal((await request('/api/unknown')).status, 404);
});

test('Server calculates prices and keeps one order for simultaneous retries', async () => {
  const input = example({ total: 1 });
  const first = post('/api/orders', input);
  const second = post('/api/orders', { ...input, items: [...input.items].reverse() });
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [200, 201]);
  assert.equal(results[0].body.id, results[1].body.id);
  assert.equal(results[0].body.total, price(1) * 2 + price(2) * 3);
  assert.equal(results[0].body.status, 'new');
  assert.equal((await post('/api/orders', { ...input, name: 'Другой покупатель' })).status, 409);
});

test('Rejects invalid orders without storing partial records', async () => {
  const beforeCount = store.listOrders().length;
  const invalid = [
    example({ items: [] }), example({ phone: 'abc-12345' }),
    example({ method: 'delivery', address: '' }), example({ consent: false }),
    example({ items: [{ productId: 1, quantity: 1 }, { productId: 50, quantity: 1 }] }),
    example({ items: [{ productId: 1, quantity: 1000 }] }),
    example({ items: [{ productId: 1, quantity: 1 }, { productId: 1, quantity: 3 }] }),
  ];
  for (const body of invalid) assert.equal((await post('/api/orders', body)).status, 422);
  assert.equal(store.listOrders().length, beforeCount);
});

test('Validates request encoding and body size', async () => {
  const path = '/api/orders';
  const headers = { 'Content-Type': 'application/json' };
  assert.equal((await request(path, { method: 'POST', body: 'x' })).status, 415);
  assert.equal((await request(path, { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await request(path, { method: 'POST', headers, body: ' '.repeat(17_000) })).status, 413);
});

test('Tracks a persisted delivery by number and code without exposing contact data', async () => {
  const payload = example({ method: 'delivery', address: 'Тестовая улица, 10' });
  const { body: order, status } = await post('/api/orders', payload);
  assert.equal(status, 201);
  assert.equal((await post('/api/orders/track', { id: order.id, code: randomUUID() })).status, 404);
  const persisted = new PlantStore(dbPath);
  try {
    assert.equal(persisted.operatorOrder(order.id).address, payload.address);
    assert.equal(persisted.operatorOrder(order.id).phone, payload.phone);
    assert.throws(() => persisted.updateStatus(order.id, 'approved'), { status: 422 });
    persisted.updateStatus(order.id, 'review');
    persisted.updateStatus(order.id, 'approved');
    assert.throws(() => persisted.updateStatus(order.id, 'review'), { status: 422 });
  } finally {
    persisted.close();
  }
  const { body, status: trackStatus } = await post('/api/orders/track', { id: `000${order.id}`, code: order.code });
  assert.equal(trackStatus, 200);
  assert.equal(body.status, 'approved');
  assert.equal(body.items.length, 2);
  for (const privateField of ['name', 'phone', 'comment', 'address', 'code']) assert.ok(!(privateField in body));
});

test('Accepts a quote for a made-to-order item and keeps its price snapshot', async () => {
  const product = catalog.products.find(({ stock }) => stock === 0);
  const { status, body } = await post('/api/orders', example({ items: [{ productId: product.id, quantity: 1 }] }));
  assert.equal(status, 201);
  const second = new PlantStore(dbPath);
  try {
    second.db.prepare('UPDATE products SET price = price + 50 WHERE id = ?').run(product.id);
    assert.equal(second.trackOrder(body.id, body.code).items[0].price, product.price);
  } finally {
    second.close();
  }
});

const demoPassword = 'Password-for-tests-941';
const profile = (name) => ({ name, email: `${name.toLowerCase()}@example.test`, password: demoPassword });

async function register(name, extra = {}) {
  const response = await post('/api/auth/register', { ...profile(name), ...extra });
  assert.equal(response.status, 201);
  return { cookie: sessionCookie(response), user: response.body.user };
}

async function login(user) {
  const response = await post('/api/auth/login', user);
  assert.equal(response.status, 200);
  return sessionCookie(response);
}

test('Customer registration, private order history and safe guest order claiming', async () => {
  const guestDraft = example();
  const { body: guest } = await post('/api/orders', guestDraft);
  const customer = await register('Alice', { role: 'admin' });
  const other = await register('Bob');
  assert.equal(customer.user.role, 'customer');
  assert.equal((await get('/api/admin/users', customer.cookie)).status, 403);
  assert.equal((await get('/api/staff/orders', customer.cookie)).status, 403);
  assert.equal((await get('/api/account/orders')).status, 401);

  const { body: own } = await post('/api/orders', example({ customerId: other.user.id }), customer.cookie);
  assert.deepEqual((await get('/api/account/orders', customer.cookie)).body.map(({ id }) => id), [own.id]);
  assert.deepEqual((await get('/api/account/orders', other.cookie)).body, []);
  assert.equal((await get(`/api/account/orders/${own.id}`, other.cookie)).status, 404);
  assert.equal((await post('/api/account/orders/claim', { id: own.id, code: own.code }, other.cookie)).status, 404);
  assert.equal((await post('/api/account/orders/claim', { id: guest.id, code: randomUUID() }, customer.cookie)).status, 404);
  assert.equal((await post('/api/account/orders/claim', { id: guest.id, code: guest.code }, customer.cookie)).status, 200);
  assert.equal((await post('/api/account/orders/claim', { id: guest.id, code: guest.code }, other.cookie)).status, 404);
  assert.deepEqual((await get('/api/account/orders', customer.cookie)).body.map(({ id }) => id), [own.id, guest.id]);
});

test('Administrator creates staff and only staff can process orders', async () => {
  const root = await new Accounts(store).create(profile('Admin'), 'admin');
  const admin = await login(profile('Admin'));
  const { status: created, body: manager } = await post('/api/admin/users', { ...profile('Manager'), role: 'manager' }, admin);
  assert.equal(created, 201);
  const staff = await login(profile('Manager'));
  assert.equal((await post('/api/admin/users', { ...profile('Denied'), role: 'admin' }, staff)).status, 403);
  assert.equal((await get('/api/admin/catalog', staff)).status, 403);
  const { body: order } = await post('/api/orders', example());
  const detail = await get(`/api/staff/orders/${order.id}`, staff);
  assert.equal(detail.body.phone, '+7 (900) 000-00-00');
  assert.equal((await post(`/api/staff/orders/${order.id}`, { status: 'approved' }, staff)).status, 422);
  assert.equal((await post(`/api/staff/orders/${order.id}`, { status: 'review' }, staff)).body.status, 'review');
  assert.equal((await post(`/api/staff/orders/${order.id}`, { status: 'approved' }, staff)).body.status, 'approved');
  assert.equal((await post(`/api/admin/users/${root.id}`, { active: false }, admin)).status, 422);
  assert.equal((await post(`/api/admin/users/${manager.id}`, { active: false }, admin)).body.active, 0);
  assert.equal((await get('/api/staff/orders', staff)).status, 401);
  assert.equal((await post('/api/auth/login', profile('Manager'))).status, 401);
  assert.equal((await post(`/api/admin/users/${manager.id}`, { active: true }, admin)).body.active, 1);
  assert.equal((await get('/api/staff/orders', staff)).status, 401);
  assert.equal((await get('/api/staff/orders', await login(profile('Manager')))).status, 200);
});

test('Sessions use protected cookies and password changes revoke existing sessions', async () => {
  const user = profile('Rotation');
  const registration = await post('/api/auth/register', user);
  assert.match(registration.cookie, /HttpOnly; SameSite=Lax/);
  const first = sessionCookie(registration);
  const second = await login(user);
  assert.notEqual(first, second);
  assert.equal((await post('/api/auth/logout', {}, second, { Origin: 'https://elsewhere.invalid' })).status, 403);
  assert.equal((await get('/api/auth/me', second)).body.user.email, user.email);
  const changed = await post('/api/auth/password', { currentPassword: user.password, newPassword: 'Updated-password-1843' }, first);
  assert.equal(changed.status, 200);
  assert.equal((await get('/api/auth/me', first)).body.user, null);
  assert.equal((await get('/api/auth/me', second)).body.user, null);
  assert.equal((await post('/api/auth/login', user)).status, 401);
  const next = sessionCookie(changed);
  assert.equal((await get('/api/auth/me', next)).body.user.email, user.email);
  assert.match((await post('/api/auth/logout', {}, next)).cookie, /Max-Age=0/);
  assert.equal((await get('/api/auth/me', next)).body.user, null);
});

test('Catalog changes appear publicly and archived products cannot enter new orders', async () => {
  const admin = await login(profile('Admin'));
  const photo = readFileSync(new URL('../public/images/products/gb-400.webp', import.meta.url));
  const { id: ignoredId, image, ...base } = catalog.products[0];
  const product = { ...base, sku: 'TEST-BOX', name: 'Тестовый товар', active: true, photo: photo.toString('base64') };
  const result = await post('/api/admin/catalog', product, admin);
  assert.equal(result.status, 201);
  const id = result.body.id;
  const latest = (await get('/api/catalog')).body.products.find((item) => item.id === id);
  const response = await fetch(url + latest.image);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), photo);
  assert.equal((await post('/api/admin/catalog', product, admin)).status, 409);
  const order = await post('/api/orders', example({ items: [{ productId: id, quantity: 1 }] }));
  assert.equal(order.status, 201);
  const { photo: omitted, ...edit } = product;
  assert.equal((await post(`/api/admin/catalog/${id}`, { ...edit, active: false, name: 'Новое название', unit: 'уп.', price: edit.price + 200 }, admin)).status, 200);
  assert.equal((await get('/api/catalog')).body.products.some((item) => item.id === id), false);
  assert.equal((await post('/api/orders', example({ items: [{ productId: id, quantity: 1 }] }))).status, 422);
  const tracked = (await post('/api/orders/track', { id: order.body.id, code: order.body.code })).body;
  assert.equal(tracked.total, product.price);
  assert.deepEqual(tracked.items, [{ name: product.name, unit: product.unit, quantity: 1, price: product.price }]);
});

test('An existing database gains account features while preserving historical records', () => {
  const filename = join(directory, 'legacy.sqlite');
  const old = new DatabaseSync(filename);
  old.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8').split('CREATE TABLE IF NOT EXISTS users')[0]);
  old.exec(`
    INSERT INTO categories VALUES ('blocks', 'Стеновые блоки');
    INSERT INTO products VALUES (1, 'GB-400', 'blocks', 'Старое название', '20 × 30 мм', 'шт.', 110, 1, 'Описание');
    INSERT INTO orders (code_hash, payload_hash, name, phone, method, address, comment, total)
    VALUES ('code', 'payload', 'Старая запись', '71234567890', 'pickup', '', '', 110);
    INSERT INTO order_items VALUES (1, 1, 1, 110);
  `);
  old.close();
  const migrated = new PlantStore(filename);
  try {
    assert.equal(migrated.operatorOrder(1).name, 'Старая запись');
    assert.equal(migrated.operatorOrder(1).items[0].name, 'Старое название');
    assert.equal(migrated.db.prepare('SELECT customer_id FROM orders WHERE id = 1').get().customer_id, null);
    assert.equal(migrated.catalog().products.length, 12);
    assert.deepEqual(new Accounts(migrated).list(), []);
  } finally {
    migrated.close();
  }
});
