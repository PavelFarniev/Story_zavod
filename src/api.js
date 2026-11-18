export async function api(path, options) {
  const response = await fetch(`/api${path}`, options && {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Ответ сервера недоступен. Попробуйте ещё раз.');
  }
  if (!response.ok) {
    const error = new Error(data.error || 'Сервер не смог обработать запрос.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export const rubles = (value) => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
export const orderNumber = (id) => String(id).padStart(5, '0');
export const picture = (product) => product.image;
export const statusLabels = {
  new: 'Заявка принята',
  review: 'На рассмотрении',
  approved: 'Согласована',
  declined: 'Отклонена',
};

export function readSaved(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The current session can still be used when persistent storage is unavailable.
  }
}
