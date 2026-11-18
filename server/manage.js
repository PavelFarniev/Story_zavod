import { PlantStore } from './store.js';

const [command, idText, status, ...extra] = process.argv.slice(2);
const id = Number(idText);
const hasId = /^\d+$/.test(idText ?? '') && Number.isSafeInteger(id) && id > 0;

if (command === 'list' && !idText || command === 'show' && hasId && !status ||
    command === 'status' && hasId && ['new', 'review', 'approved', 'declined'].includes(status) && !extra.length) {
  const store = new PlantStore();
  try {
    if (command === 'list') console.table(store.listOrders());
    if (command === 'show') {
      const order = store.operatorOrder(id);
      if (!order) throw new Error('Заявка не найдена.');
      console.log(JSON.stringify(order, null, 2));
    }
    if (command === 'status') console.log(JSON.stringify(store.updateStatus(id, status), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    store.close();
  }
} else {
  console.log('npm run orders -- list\nnpm run orders -- show НОМЕР\nnpm run orders -- status НОМЕР review|approved|declined');
  if (command) process.exitCode = 1;
}
