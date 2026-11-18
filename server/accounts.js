import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { OrderError } from './store.js';

const derive = promisify(scrypt);
const sessionSeconds = 60 * 60 * 24 * 7;
const publicFields = 'id, name, email, role, active, created_at AS createdAt';
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
export const roles = ['customer', 'manager', 'admin'];
const dummyHash = '0'.repeat(32) + ':' + '0'.repeat(128);

function emailAddress(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new OrderError(422, 'Укажите корректную электронную почту.');
  }
  return email;
}

function newPassword(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) {
    throw new OrderError(422, 'Пароль должен содержать от 10 до 128 символов.');
  }
  return value;
}

async function makeHash(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await derive(password, salt, 64)).toString('hex');
}

async function matches(password, hash) {
  const [salt, expected] = hash.split(':');
  const candidate = await derive(password, salt, 64);
  return timingSafeEqual(candidate, Buffer.from(expected, 'hex'));
}

export class Accounts {
  constructor(store) {
    this.store = store;
    this.db = store.db;
  }

  async create({ name, email, password }, role, actorId) {
    const cleanName = typeof name === 'string' ? name.trim() : '';
    if (cleanName.length < 2 || cleanName.length > 80) throw new OrderError(422, 'Укажите имя длиной от 2 до 80 символов.');
    if (!roles.includes(role)) throw new OrderError(422, 'Выберите роль аккаунта.');
    const cleanEmail = emailAddress(email);
    const hash = await makeHash(newPassword(password));
    return this.store.transaction(() => {
      if (actorId) this.requireActiveAdmin(actorId);
      const account = this.db.prepare(`
        INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)
        ON CONFLICT(email) DO NOTHING RETURNING ${publicFields}
      `).get(cleanName, cleanEmail, hash, role);
      if (!account) throw new OrderError(409, 'Аккаунт с такой почтой уже существует.');
      return account;
    });
  }

  async login({ email, password }) {
    const address = emailAddress(email);
    if (typeof password !== 'string' || !password.length || password.length > 128) {
      throw new OrderError(401, 'Неверная почта или пароль.');
    }
    const row = this.db.prepare(`SELECT ${publicFields}, password_hash AS hash FROM users WHERE email = ?`).get(address);
    const valid = await matches(password, row?.hash ?? dummyHash);
    if (!valid || !row?.active) throw new OrderError(401, 'Неверная почта или пароль.');
    return this.store.transaction(() => {
      const account = this.db.prepare(`SELECT ${publicFields} FROM users WHERE id = ? AND password_hash = ? AND active = 1`).get(row.id, row.hash);
      if (!account) throw new OrderError(401, 'Неверная почта или пароль.');
      return { account, token: this.beginSession(account) };
    });
  }

  beginSession(account) {
    const token = randomBytes(32).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
    this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash(token), account.id, now + sessionSeconds);
    return token;
  }

  token(request) {
    const cookie = (request.headers.cookie ?? '').split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith('forma_session='));
    const value = cookie?.slice('forma_session='.length);
    return /^[A-Za-z0-9_-]{43}$/.test(value ?? '') ? value : null;
  }

  user(request) {
    const token = this.token(request);
    if (!token) return null;
    return this.db.prepare(`
      SELECT u.id, u.name, u.email, u.role, u.active, u.created_at AS createdAt
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
    `).get(tokenHash(token), Math.floor(Date.now() / 1000)) ?? null;
  }

  endSession(request) {
    const token = this.token(request);
    if (token) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
  }

  setCookie(request, response, token) {
    const secure = request.socket.encrypted || process.env.COOKIE_SECURE === '1';
    response.setHeader('Set-Cookie', `forma_session=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? sessionSeconds : 0}${secure ? '; Secure' : ''}`);
  }

  list() {
    return this.db.prepare(`SELECT ${publicFields} FROM users ORDER BY id DESC`).all();
  }

  requireActiveAdmin(id) {
    if (!this.db.prepare("SELECT id FROM users WHERE id = ? AND active = 1 AND role = 'admin'").get(id)) {
      throw new OrderError(403, 'Доступ администратора недоступен.');
    }
  }

  setActive(actorId, id, active) {
    if (typeof active !== 'boolean') throw new OrderError(422, 'Укажите состояние аккаунта.');
    if (actorId === id && !active) throw new OrderError(422, 'Свой аккаунт нельзя отключить.');
    return this.store.transaction(() => {
      this.requireActiveAdmin(actorId);
      const account = this.db.prepare(`UPDATE users SET active = ? WHERE id = ? RETURNING ${publicFields}`).get(Number(active), id);
      if (!account) throw new OrderError(404, 'Аккаунт не найден.');
      if (!active) this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      return account;
    });
  }

  async changePassword(account, current, next) {
    const password = newPassword(next);
    const row = this.db.prepare('SELECT password_hash AS hash FROM users WHERE id = ? AND active = 1').get(account.id);
    if (!row || typeof current !== 'string' || current.length > 128 || !await matches(current, row.hash)) {
      throw new OrderError(422, 'Текущий пароль введён неверно.');
    }
    const hash = await makeHash(password);
    return this.store.transaction(() => {
      const { changes } = this.db.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ? AND active = 1')
        .run(hash, account.id, row.hash);
      if (!changes) throw new OrderError(409, 'Данные аккаунта изменились. Войдите заново.');
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(account.id);
      return this.beginSession(account);
    });
  }
}
