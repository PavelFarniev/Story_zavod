import { randomBytes } from 'node:crypto';
import { Accounts } from './accounts.js';
import { PlantStore } from './store.js';

const [email, name = 'Администратор', ...extra] = process.argv.slice(2);
if (!email || extra.length) {
  console.log('npm run admin -- EMAIL [ИМЯ]');
  process.exitCode = 1;
} else {
  const store = new PlantStore();
  try {
    const password = randomBytes(18).toString('base64url');
    const account = await new Accounts(store).create({ email, name, password }, 'admin');
    console.log(`Администратор: ${account.email}\nНачальный пароль: ${password}\nКабинет: /admin`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}
