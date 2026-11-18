import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { categories, products } from './catalog.js';

export const defaultDb = () => process.env.DB_PATH || resolve('data/forma.sqlite');

const productFields = 'id, sku, category_id AS category, name, spec, unit, price, stock, description';
const publicOrderFields = 'id, status, total, method, created_at AS createdAt';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const transitions = { new: ['review', 'declined'], review: ['approved', 'declined'], approved: [], declined: [] };

export class OrderError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class PlantStore {
  constructor(filename = defaultDb()) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.transaction(() => {
      this.db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
      const columns = (table) => this.db.prepare(`PRAGMA table_info(${table})`).all().map(({ name }) => name);
      if (!columns('orders').includes('customer_id')) {
        this.db.exec('ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES users(id)');
      }
      if (!columns('products').includes('active')) {
        this.db.exec('ALTER TABLE products ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))');
      }
      if (!columns('order_items').includes('item_name')) {
        this.db.exec(`
          ALTER TABLE order_items ADD COLUMN item_name TEXT NOT NULL DEFAULT '';
          ALTER TABLE order_items ADD COLUMN item_unit TEXT NOT NULL DEFAULT '';
          UPDATE order_items
          SET item_name = (SELECT name FROM products WHERE id = product_id),
              item_unit = (SELECT unit FROM products WHERE id = product_id);
        `);
      }
      this.db.exec('CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders(customer_id)');
      const insertCategory = this.db.prepare('INSERT INTO categories VALUES (?, ?) ON CONFLICT(id) DO NOTHING');
      const insertProduct = this.db.prepare(`
        INSERT INTO products (sku, category_id, name, spec, unit, price, stock, description)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sku) DO NOTHING
      `);
      for (const row of categories) insertCategory.run(...row);
      for (const row of products) insertProduct.run(...row);
    });
  }

  transaction(work) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  catalog(includeArchived = false) {
    return {
      categories: this.db.prepare('SELECT id, title FROM categories ORDER BY rowid').all(),
      products: this.db.prepare(`
        SELECT ${productFields}, active, EXISTS(SELECT 1 FROM product_photos WHERE product_id = products.id) AS uploadedPhoto
        FROM products WHERE ? OR active = 1 ORDER BY id
      `).all(Number(includeArchived)).map(({ uploadedPhoto, active, ...product }) => ({
        ...product,
        ...(includeArchived ? { active: Boolean(active) } : {}),
        image: uploadedPhoto ? `/api/catalog/photo/${product.id}` :
          products.some(([sku]) => sku === product.sku) ? `/images/products/${product.sku.toLowerCase()}.webp` : null,
      })),
    };
  }

  saveProduct(id, { sku, category, name, spec, unit, price, stock, description, active, photo }) {
    return this.transaction(() => {
      if (!this.db.prepare('SELECT id FROM categories WHERE id = ?').get(category)) {
        throw new OrderError(422, 'Выберите категорию из каталога.');
      }
      const values = [category, name, spec, unit, price, stock, description, Number(active)];
      const result = id === null ? this.db.prepare(`
        INSERT INTO products (sku, category_id, name, spec, unit, price, stock, description, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(sku) DO NOTHING RETURNING id
      `).get(sku, ...values) : this.db.prepare(`
        UPDATE products SET category_id = ?, name = ?, spec = ?, unit = ?, price = ?, stock = ?, description = ?, active = ?
        WHERE id = ? RETURNING id
      `).get(...values, id);
      if (!result && id === null) throw new OrderError(409, 'Этот артикул уже используется.');
      if (!result) throw new OrderError(404, 'Товар не найден.');
      if (photo) this.db.prepare(`
        INSERT INTO product_photos (product_id, mime, bytes) VALUES (?, ?, ?)
        ON CONFLICT(product_id) DO UPDATE SET mime = excluded.mime, bytes = excluded.bytes
      `).run(result.id, photo.mime, photo.bytes);
      return result.id;
    });
  }

  productPhoto(id) {
    return this.db.prepare('SELECT mime, bytes FROM product_photos WHERE product_id = ?').get(id);
  }

  createOrder(code, input, customerId = null) {
    const codeHash = hash(code);
    const payloadHash = hash(JSON.stringify(input));
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT id, payload_hash FROM orders WHERE code_hash = ?').get(codeHash);
      if (existing) {
        if (existing.payload_hash !== payloadHash) {
          throw new OrderError(409, 'Эта заявка уже отправлена с другим составом. Проверьте её статус.');
        }
        return { created: false, order: this.orderById(existing.id) };
      }

      const findProduct = this.db.prepare('SELECT id, name, unit, price FROM products WHERE id = ? AND active = 1');
      const items = input.items.map(({ productId, quantity }) => {
        const product = findProduct.get(productId);
        if (!product) throw new OrderError(422, 'Одна из позиций больше не доступна в каталоге.');
        return { ...product, quantity };
      });
      const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const { lastInsertRowid: orderId } = this.db.prepare(`
        INSERT INTO orders (code_hash, payload_hash, name, phone, method, address, comment, total, customer_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(codeHash, payloadHash, input.name, input.phone, input.method, input.address, input.comment, total, customerId);

      const insertItem = this.db.prepare(`
        INSERT INTO order_items (order_id, product_id, quantity, unit_price, item_name, item_unit) VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const { id, quantity, price, name, unit } of items) insertItem.run(orderId, id, quantity, price, name, unit);
      return { created: true, order: this.orderById(orderId) };
    });
  }

  orderById(id) {
    const order = this.db.prepare(`SELECT ${publicOrderFields} FROM orders WHERE id = ?`).get(id);
    if (!order) return null;
    order.items = this.db.prepare(`
      SELECT item_name AS name, item_unit AS unit, quantity, unit_price AS price
      FROM order_items WHERE order_id = ? ORDER BY product_id
    `).all(id);
    return order;
  }

  trackOrder(id, code) {
    const order = this.db.prepare('SELECT id FROM orders WHERE id = ? AND code_hash = ?').get(id, hash(code));
    return order ? this.orderById(order.id) : null;
  }

  listOrders() {
    return this.db.prepare(`SELECT ${publicOrderFields} FROM orders ORDER BY id DESC`).all();
  }

  customerOrders(customerId) {
    return this.db.prepare(`SELECT ${publicOrderFields} FROM orders WHERE customer_id = ? ORDER BY id DESC`).all(customerId);
  }

  customerOrder(id, customerId) {
    const order = this.db.prepare('SELECT id FROM orders WHERE id = ? AND customer_id = ?').get(id, customerId);
    return order ? this.orderById(order.id) : null;
  }

  claimOrder(customerId, id, code) {
    const order = this.db.prepare(`
      UPDATE orders SET customer_id = ? WHERE id = ? AND code_hash = ?
      AND (customer_id IS NULL OR customer_id = ?) RETURNING id
    `).get(customerId, id, hash(code), customerId);
    return order ? this.orderById(order.id) : null;
  }

  operatorOrder(id) {
    const details = this.db.prepare('SELECT name, phone, address, comment FROM orders WHERE id = ?').get(id);
    return details ? { ...this.orderById(id), ...details } : null;
  }

  updateStatus(id, status) {
    return this.transaction(() => {
      const order = this.orderById(id);
      if (!order) throw new OrderError(404, 'Заявка не найдена.');
      if (order.status === status) return order;
      if (!transitions[order.status].includes(status)) {
        throw new OrderError(422, `Переход из «${order.status}» в «${status}» недоступен.`);
      }
      this.db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, id);
      return this.orderById(id);
    });
  }

  close() {
    this.db.close();
  }
}
