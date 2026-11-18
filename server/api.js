import { OrderError } from './store.js';
import { Accounts } from './accounts.js';

const codePattern = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

function send(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request, limit = 16_384) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw new OrderError(415, 'Требуется запрос в формате JSON.');
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      throw new OrderError(413, 'Запрос слишком большой.');
    }
    chunks.push(chunk);
  }

  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
    return data;
  } catch {
    throw new OrderError(400, 'Некорректный JSON.');
  }
}

function field(value, title, min, max) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (result.length < min || result.length > max) {
    throw new OrderError(422, `Проверьте поле «${title}».`);
  }
  return result;
}

function readCode(value) {
  if (typeof value !== 'string' || !codePattern.test(value)) {
    throw new OrderError(422, 'Проверьте код доступа к заявке.');
  }
  return value.toLowerCase();
}

function readId(value) {
  const id = Number(value);
  if (!/^\d+$/.test(String(value ?? '')) || !Number.isSafeInteger(id) || id < 1) {
    throw new OrderError(422, 'Проверьте номер записи.');
  }
  return id;
}

function requireUser(accounts, request, roles) {
  const user = accounts.user(request);
  if (!user) throw new OrderError(401, 'Войдите в личный кабинет.');
  if (roles && !roles.includes(user.role)) throw new OrderError(403, 'У вашей роли нет доступа к этому разделу.');
  return user;
}

function checkOrigin(request) {
  const origin = request.headers.origin;
  if (request.headers['sec-fetch-site'] === 'cross-site' || (origin && ![`http://${request.headers.host}`, `https://${request.headers.host}`].includes(origin))) {
    throw new OrderError(403, 'Запрос с другого сайта отклонён.');
  }
}

function authThrottle() {
  const attempts = new Map();
  let sweepAt = 0;
  return (request) => {
    const now = Date.now();
    if (now >= sweepAt) {
      for (const [address, entry] of attempts) if (entry.until <= now) attempts.delete(address);
      sweepAt = now + 60_000;
    }
    const key = request.socket.remoteAddress;
    const previous = attempts.get(key);
    const entry = previous?.until > now ? previous : { count: 0, until: now + 10 * 60_000 };
    if (entry.count >= 30) throw new OrderError(429, 'Слишком много попыток. Попробуйте через несколько минут.');
    entry.count += 1;
    attempts.set(key, entry);
  };
}

function readPhoto(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || value.length > 1_398_150 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new OrderError(422, 'Фотография должна весить до 1 МБ.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > 1_048_576) throw new OrderError(422, 'Фотография должна весить до 1 МБ.');
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', bytes };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return { mime: 'image/png', bytes };
  if (bytes.length >= 4 && bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return { mime: 'image/jpeg', bytes };
  throw new OrderError(422, 'Выберите фотографию JPEG, PNG или WebP.');
}

function validateProduct(body, id) {
  const sku = id === null ? field(body.sku, 'Артикул', 2, 40).toUpperCase() : null;
  if (sku && !/^[A-Z\d][A-Z\d-]*$/.test(sku)) throw new OrderError(422, 'Артикул может содержать латинские буквы, цифры и дефисы.');
  if (!Number.isInteger(body.price) || body.price < 1 || body.price > 100_000_000) {
    throw new OrderError(422, 'Введите целую цену от 1 до 100 000 000 ₽.');
  }
  if (!Number.isInteger(body.stock) || body.stock < 0 || body.stock > 10_000_000) {
    throw new OrderError(422, 'Введите целый остаток от 0 до 10 000 000.');
  }
  if (typeof body.active !== 'boolean') throw new OrderError(422, 'Укажите видимость товара.');
  return {
    sku, price: body.price, stock: body.stock, active: body.active, photo: readPhoto(body.photo),
    category: field(body.category, 'Категория', 2, 40),
    name: field(body.name, 'Название', 2, 120),
    spec: field(body.spec, 'Характеристики', 2, 180),
    unit: field(body.unit, 'Единица продажи', 1, 20),
    description: field(body.description, 'Описание', 2, 800),
  };
}

function validateOrder(body) {
  const method = body.method;
  if (!['pickup', 'delivery'].includes(method)) throw new OrderError(422, 'Выберите способ получения.');
  const name = field(body.name, 'Имя', 2, 80);
  const phone = field(body.phone, 'Телефон', 7, 32);
  const digits = phone.replace(/\D/g, '');
  if (!/^\+?[0-9 ()-]+$/.test(phone) || digits.length < 10 || digits.length > 15) {
    throw new OrderError(422, 'Введите телефон из 10–15 цифр.');
  }
  const address = method === 'delivery' ? field(body.address, 'Адрес доставки', 5, 200) : '';
  const comment = field(body.comment, 'Комментарий', 0, 500);
  if (body.consent !== true) throw new OrderError(422, 'Подтвердите отправку контактных данных.');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) {
    throw new OrderError(422, 'Добавьте в заявку от 1 до 30 материалов.');
  }

  const productIds = new Set();
  const items = body.items.map((item) => {
    const { productId, quantity } = item ?? {};
    if (!Number.isSafeInteger(productId) || productId < 1 || productIds.has(productId) ||
        !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
      throw new OrderError(422, 'Проверьте состав заявки. Количество должно быть от 1 до 999.');
    }
    productIds.add(productId);
    return { productId, quantity };
  }).sort((first, second) => first.productId - second.productId);
  return { name, phone, method, address, comment, items };
}

export function createApi(store) {
  const accounts = new Accounts(store);
  const throttle = authThrottle();
  return async function handleApi(request, response, pathname) {
    try {
      if (request.method === 'POST') checkOrigin(request);
      if (request.method === 'GET' && pathname === '/api/health') return send(response, 200, { status: 'ok' });
      if (request.method === 'GET' && pathname === '/api/catalog') return send(response, 200, store.catalog());

      const photoId = pathname.match(/^\/api\/catalog\/photo\/(\d+)$/)?.[1];
      if (request.method === 'GET' && photoId) {
        const photo = store.productPhoto(readId(photoId));
        if (!photo) throw new OrderError(404, 'Фотография не найдена.');
        response.writeHead(200, {
          'Content-Type': photo.mime, 'Content-Length': photo.bytes.length, 'Cache-Control': 'no-cache',
          'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox",
        });
        return response.end(photo.bytes);
      }

      if (request.method === 'GET' && pathname === '/api/auth/me') return send(response, 200, { user: accounts.user(request) });
      if (request.method === 'POST' && ['/api/auth/register', '/api/auth/login'].includes(pathname)) {
        throttle(request);
        const body = await readJson(request);
        const isNew = pathname.endsWith('/register');
        let account, token;
        if (isNew) {
          account = await accounts.create(body, 'customer');
          token = accounts.beginSession(account);
        } else {
          ({ account, token } = await accounts.login(body));
        }
        accounts.endSession(request);
        accounts.setCookie(request, response, token);
        return send(response, isNew ? 201 : 200, { user: account });
      }
      if (request.method === 'POST' && pathname === '/api/auth/logout') {
        await readJson(request);
        accounts.endSession(request);
        accounts.setCookie(request, response, null);
        return send(response, 200, { user: null });
      }
      if (request.method === 'POST' && pathname === '/api/auth/password') {
        const body = await readJson(request);
        const account = requireUser(accounts, request);
        throttle(request);
        const token = await accounts.changePassword(account, body.currentPassword, body.newPassword);
        accounts.setCookie(request, response, token);
        return send(response, 200, { ok: true });
      }

      if (request.method === 'POST' && pathname === '/api/orders') {
        const body = await readJson(request);
        const code = readCode(body.code);
        const account = accounts.user(request);
        const { created, order } = store.createOrder(code, validateOrder(body), account?.role === 'customer' ? account.id : null);
        return send(response, created ? 201 : 200, { ...order, code });
      }

      if (request.method === 'POST' && pathname === '/api/orders/track') {
        const body = await readJson(request);
        const id = Number(body.id);
        if (!/^\d+$/.test(String(body.id ?? '')) || !Number.isSafeInteger(id) || id < 1) {
          throw new OrderError(422, 'Введите номер заявки.');
        }
        const order = store.trackOrder(id, readCode(body.code));
        if (!order) throw new OrderError(404, 'Заявка не найдена. Проверьте номер и код.');
        return send(response, 200, order);
      }

      const customerOrder = pathname.match(/^\/api\/account\/orders\/(\d+)$/)?.[1];
      if (request.method === 'GET' && (pathname === '/api/account/orders' || customerOrder)) {
        const user = requireUser(accounts, request, ['customer']);
        if (!customerOrder) return send(response, 200, store.customerOrders(user.id));
        const order = store.customerOrder(readId(customerOrder), user.id);
        if (!order) throw new OrderError(404, 'Заявка не найдена.');
        return send(response, 200, order);
      }
      if (request.method === 'POST' && pathname === '/api/account/orders/claim') {
        const body = await readJson(request);
        const user = requireUser(accounts, request, ['customer']);
        const order = store.claimOrder(user.id, readId(body.id), readCode(body.code));
        if (!order) throw new OrderError(404, 'Заявка недоступна. Проверьте номер и код.');
        return send(response, 200, order);
      }

      const staff = ['manager', 'admin'];
      const staffOrder = pathname.match(/^\/api\/staff\/orders\/(\d+)$/)?.[1];
      if (request.method === 'GET' && (pathname === '/api/staff/orders' || staffOrder)) {
        requireUser(accounts, request, staff);
        if (!staffOrder) return send(response, 200, store.listOrders());
        const order = store.operatorOrder(readId(staffOrder));
        if (!order) throw new OrderError(404, 'Заявка не найдена.');
        return send(response, 200, order);
      }
      if (request.method === 'POST' && staffOrder) {
        const body = await readJson(request);
        requireUser(accounts, request, staff);
        return send(response, 200, store.updateStatus(readId(staffOrder), body.status));
      }

      const adminUser = pathname.match(/^\/api\/admin\/users\/(\d+)$/)?.[1];
      if (request.method === 'GET' && pathname === '/api/admin/users') {
        requireUser(accounts, request, ['admin']);
        return send(response, 200, accounts.list());
      }
      if (request.method === 'POST' && (pathname === '/api/admin/users' || adminUser)) {
        const body = await readJson(request);
        const actor = requireUser(accounts, request, ['admin']);
        if (adminUser) return send(response, 200, accounts.setActive(actor.id, readId(adminUser), body.active));
        return send(response, 201, await accounts.create(body, body.role, actor.id));
      }

      const adminProduct = pathname.match(/^\/api\/admin\/catalog\/(\d+)$/)?.[1];
      if (request.method === 'GET' && pathname === '/api/admin/catalog') {
        requireUser(accounts, request, ['admin']);
        return send(response, 200, store.catalog(true));
      }
      if (request.method === 'POST' && (pathname === '/api/admin/catalog' || adminProduct)) {
        requireUser(accounts, request, ['admin']);
        const body = await readJson(request, 1_410_000);
        requireUser(accounts, request, ['admin']);
        const id = adminProduct ? readId(adminProduct) : null;
        const productId = store.saveProduct(id, validateProduct(body, id));
        return send(response, id === null ? 201 : 200, { id: productId });
      }

      return send(response, 404, { error: 'Маршрут API не найден.' });
    } catch (error) {
      if (error instanceof OrderError) return send(response, error.status, { error: error.message });
      console.error(error);
      return send(response, 500, { error: 'Сервер не смог обработать запрос. Попробуйте ещё раз.' });
    }
  };
}
