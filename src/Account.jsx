import React, { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Boxes, ClipboardList, Image as ImageIcon, LogOut, Plus, Settings, ShieldCheck, Users } from 'lucide-react';
import { api, orderNumber, picture, rubles, save, statusLabels } from './api.js';
import './account.css';

const titles = { customer: 'Личный кабинет', manager: 'Кабинет менеджера', admin: 'Администрирование' };
const roleNames = { customer: 'Покупатель', manager: 'Менеджер', admin: 'Администратор' };
const rolePage = { customer: '/account', manager: '/manager', admin: '/admin' };
const methods = { pickup: 'Самовывоз', delivery: 'Доставка' };
const allowedStatuses = { new: ['review', 'declined'], review: ['approved', 'declined'], approved: [], declined: [] };
const statusActions = { review: 'Взять в работу', approved: 'Согласовать', declined: 'Отклонить' };
const formatDate = (value) => new Date(value).toLocaleDateString('ru-RU');

function Feedback({ error, success }) {
  return <>
    {error && <p className="form-error" role="alert">{error}</p>}
    {success && <p className="account-success" role="status">{success}</p>}
  </>;
}

function useResource(path) {
  const [result, setResult] = useState({ loading: true, data: null, error: '' });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setResult((last) => ({ ...last, loading: true, error: '' }));
    api(path).then((data) => {
      if (current) setResult({ loading: false, data, error: '' });
    }).catch((error) => {
      if (current) setResult({ loading: false, data: null, error: error.message });
    });
    return () => { current = false; };
  }, [path, version]);
  return { ...result, reload: () => setVersion((value) => value + 1) };
}

function AccountHeader({ user, onLogout, busy }) {
  return <header className="account-header">
    <div className="shell">
      <a className="brand" href="/" aria-label="ФОРМА — на главную">
        <img src="/mark.svg" width="40" height="40" alt="" />
        <span><strong>ФОРМА</strong><small>ЗАВОД СТРОЙМАТЕРИАЛОВ</small></span>
      </a>
      <div className="account-header-actions">
        <a className="inline-button" href="/#catalog"><ArrowLeft size={16} /> К каталогу</a>
        {user && <button type="button" className="button button-outline" disabled={busy} onClick={onLogout}><LogOut size={16} /> Выйти</button>}
      </div>
    </div>
  </header>;
}

function SignIn({ onSignIn, staffOnly }) {
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      const { user } = await api(register ? '/auth/register' : '/auth/login', body);
      onSignIn(user);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <main className="shell login-wrap">
    <section className="login-intro">
      <div className="account-emblem"><ShieldCheck size={27} /></div>
      <h1>{staffOnly ? 'Вход для сотрудников' : 'Личный кабинет'}</h1>
      <p>{staffOnly ? 'Войдите с рабочей учётной записью, чтобы открыть раздел управления.' :
        'Следите за заявками на поставку и уточняйте их состав в любое время.'}</p>
    </section>
    <form className="account-form account-card" onSubmit={submit}>
      <h2>{register ? 'Создать аккаунт' : 'Войти'}</h2>
      {register && <label>Имя<input name="name" autoComplete="name" minLength={2} maxLength={80} required /></label>}
      <label>Электронная почта<input name="email" type="email" autoComplete="username" maxLength={254} required /></label>
      <label>Пароль<input key={register} name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'}
        minLength={register ? 10 : undefined} maxLength={128} placeholder={register ? 'От 10 символов' : undefined} required /></label>
      <Feedback error={error} />
      <button className="button button-primary" disabled={busy}>{busy ? 'Подождите…' : register ? 'Зарегистрироваться' : 'Войти'} <ArrowRight size={17} /></button>
      {!staffOnly && <button type="button" className="inline-button" disabled={busy}
        onClick={() => { setRegister(!register); setError(''); }}>{register ? 'Уже есть аккаунт? Войти' : 'Создать аккаунт покупателя'}</button>}
    </form>
  </main>;
}

function OrderDetail({ order, staff, onUpdate, onBack }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function update(status) {
    setBusy(true);
    setError('');
    try {
      const updated = await api(`/staff/orders/${order.id}`, { status });
      onUpdate({ ...order, ...updated });
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <section className="account-card order-detail">
    <button className="inline-button" type="button" onClick={onBack}><ArrowLeft size={16} /> К списку</button>
    <div className="account-section-title"><h2>Заявка № {orderNumber(order.id)}</h2><Status status={order.status} /></div>
    <p className="account-muted">{formatDate(order.createdAt)} · {methods[order.method]}</p>
    {staff && <dl className="order-contacts">
      <div><dt>Покупатель</dt><dd>{order.name}</dd></div>
      <div><dt>Телефон</dt><dd><a href={`tel:${order.phone.replace(/[^+\d]/g, '')}`}>{order.phone}</a></dd></div>
      {!!order.address && <div><dt>Адрес доставки</dt><dd>{order.address}</dd></div>}
      {!!order.comment && <div><dt>Комментарий</dt><dd>{order.comment}</dd></div>}
    </dl>}
    <ul className="order-lines">{order.items.map((item, index) => <li key={index}>
      <span><strong>{item.name}</strong><small>{item.quantity} {item.unit} × {rubles(item.price)}</small></span>
      <strong>{rubles(item.price * item.quantity)}</strong>
    </li>)}</ul>
    <p className="total"><span>Стоимость материалов</span><strong>{rubles(order.total)}</strong></p>
    <Feedback error={error} />
    {staff && <div className="account-actions">
      {allowedStatuses[order.status].map((status) => <button className={`button ${status === 'declined' ? 'button-outline' : 'button-primary'}`}
        type="button" key={status} disabled={busy} onClick={() => update(status)}>{statusActions[status]}</button>)}
    </div>}
  </section>;
}

const Status = ({ status }) => <span className={`account-status status-${status}`}>{statusLabels[status]}</span>;

function ClaimOrder({ onClaim }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setError('');
    setBusy(true);
    try {
      onClaim(await api('/account/orders/claim', { id: values.id.trim(), code: values.code.trim() }));
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <details className="account-card claim-card">
    <summary>Добавить заявку, оформленную без аккаунта</summary>
    <form className="account-form" onSubmit={submit}>
      <label>Номер заявки<input name="id" inputMode="numeric" pattern="[0-9]+" maxLength={16} required /></label>
      <label>Код доступа<input name="code" autoComplete="off" spellCheck="false" maxLength={50} required /></label>
      <Feedback error={error} />
      <button className="button button-primary" disabled={busy}>Добавить в историю</button>
    </form>
  </details>;
}

function Orders({ staff }) {
  const path = staff ? '/staff/orders' : '/account/orders';
  const orders = useResource(path);
  const [status, setStatus] = useState('all');
  const [id, setId] = useState(null);
  return id ? <SelectedOrder key={id} id={id} path={path} staff={staff} onBack={() => { setId(null); orders.reload(); }} /> :
    <div className="account-stack">
      <div className="account-section-title"><h2>{staff ? 'Заявки на поставку' : 'Мои заявки'}</h2>
        <label className="account-filter"><span>Статус</span><select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">Все статусы</option>
          {Object.entries(statusLabels).map(([code, text]) => <option key={code} value={code}>{text}</option>)}
        </select></label>
      </div>
      <ResourceState resource={orders} />
      {orders.data && <div className="account-card account-list">
        {orders.data.filter((order) => status === 'all' || status === order.status).map((order) => (
          <button className="account-row order-row" key={order.id} onClick={() => setId(order.id)}>
            <span><strong>Заявка № {orderNumber(order.id)}</strong><small>{formatDate(order.createdAt)} · {methods[order.method]}</small></span>
            <Status status={order.status} /><strong>{rubles(order.total)}</strong><ArrowRight size={17} />
          </button>
        ))}
        {!orders.data.some((order) => status === 'all' || status === order.status) &&
          <div className="account-empty"><ClipboardList size={29} /><h3>{status === 'all' ? 'Заявок пока нет' : 'Заявки с таким статусом отсутствуют'}</h3>
            {!staff && status === 'all' && <a href="/#catalog" className="button button-primary">Открыть каталог <ArrowRight size={17} /></a>}
          </div>}
      </div>}
      {!staff && <ClaimOrder onClaim={(order) => setId(order.id)} />}
    </div>;
}

function SelectedOrder({ path, id, staff, onBack }) {
  const resource = useResource(`${path}/${id}`);
  const [updated, setUpdated] = useState(null);
  if (resource.data) return <OrderDetail order={updated || resource.data} staff={staff} onBack={onBack} onUpdate={setUpdated} />;
  return <section className="account-card"><button className="inline-button" onClick={onBack}><ArrowLeft size={16} /> К списку</button><ResourceState resource={resource} /></section>;
}

function ResourceState({ resource }) {
  if (resource.loading && !resource.data) return <p className="account-muted" role="status">Загрузка…</p>;
  if (!resource.error) return null;
  return <div className="account-stack"><Feedback error={resource.error} /><button className="button button-outline" onClick={resource.reload}>Повторить загрузку</button></div>;
}

function AccountsPanel({ user }) {
  const accounts = useResource('/admin/users');
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function update(path, body, successText) {
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      await api(path, body);
      if (path === '/admin/users') setCreating(false);
      accounts.reload();
      setSuccess(successText);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="account-stack">
    <div className="account-section-title"><h2>Аккаунты</h2>
      <button className="button button-primary" onClick={() => { setCreating(!creating); setError(''); }} disabled={busy}><Plus size={17} /> Создать аккаунт</button>
    </div>
    <Feedback error={error} success={success} />
    {creating && <form className="account-card account-form" onSubmit={(event) => {
      event.preventDefault();
      void update('/admin/users', Object.fromEntries(new FormData(event.currentTarget)), 'Аккаунт создан.');
    }}>
      <h3>Новый аккаунт</h3>
      <div className="account-form-grid">
        <label>Имя<input name="name" autoComplete="off" minLength={2} maxLength={80} required /></label>
        <label>Электронная почта<input name="email" type="email" autoComplete="off" maxLength={254} required /></label>
        <label>Роль<select name="role" defaultValue="manager">
          {Object.entries(roleNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Начальный пароль<input name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>
      </div>
      <div className="account-actions"><button className="button button-primary" disabled={busy}>Создать</button>
        <button className="button button-outline" type="button" onClick={() => { setCreating(false); setError(''); }}>Отмена</button></div>
    </form>}
    <ResourceState resource={accounts} />
    {accounts.data && <ul className="account-card account-list">
      {accounts.data.map((entry) => <li key={entry.id} className="account-row user-row">
        <span><strong>{entry.name}</strong><small>{entry.email}</small></span>
        <span className="account-status">{roleNames[entry.role]}</span>
        {entry.id === user.id ? <span className="account-muted">Ваш аккаунт</span> : <button
          type="button" className="button button-outline" disabled={busy}
          onClick={() => update(`/admin/users/${entry.id}`, { active: !entry.active }, entry.active ? 'Аккаунт отключён.' : 'Аккаунт включён.')}>
          {entry.active ? 'Отключить' : 'Включить'}</button>}
      </li>)}
    </ul>}
  </div>;
}

const editableFields = [
  { name: 'name', label: 'Название', max: 120 },
  { name: 'spec', label: 'Характеристики', max: 180 },
  { name: 'unit', label: 'Единица продажи', max: 20 },
  { name: 'price', label: 'Цена в рублях', type: 'number', min: 1, max: 100_000_000 },
  { name: 'stock', label: 'Остаток', type: 'number', min: 0, max: 10_000_000 },
];

function fileBase64(file) {
  if (!file?.size) return Promise.resolve(undefined);
  if (file.size > 1_048_576) return Promise.reject(new Error('Фотография должна весить до 1 МБ.'));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Не удалось прочитать фотографию.'));
    reader.readAsDataURL(file);
  });
}

function EditProduct({ product, categories, onCancel, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      const { photo, ...fields } = values;
      const body = { ...fields, active: values.active === 'on', price: Number(values.price), stock: Number(values.stock), photo: await fileBase64(photo) };
      await api(product.id ? `/admin/catalog/${product.id}` : '/admin/catalog', body);
      onSaved();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <form className="account-card account-form" onSubmit={submit}>
    <h3>{product.id ? `Товар ${product.sku}` : 'Новый товар'}</h3>
    <div className="account-form-grid">
      {!product.id && <label>Артикул<input name="sku" minLength={2} maxLength={40} pattern="[A-Za-z0-9][A-Za-z0-9\-]*" required /></label>}
      <label>Категория<select name="category" defaultValue={product.category || categories[0]?.id} required>
        {categories.map(({ id, title }) => <option key={id} value={id}>{title}</option>)}
      </select></label>
      {editableFields.map(({ name, label, type, min, max }) => <label key={name}>{label}
        <input name={name} type={type || 'text'} min={min} max={type ? max : undefined} maxLength={type ? undefined : max}
          step={type ? 1 : undefined} defaultValue={product[name] ?? ''} required />
      </label>)}
    </div>
    <label>Описание<textarea name="description" rows={3} maxLength={800} defaultValue={product.description || ''} required /></label>
    <label>Фото <small>JPEG, PNG или WebP до 1 МБ</small><input type="file" name="photo" accept="image/jpeg,image/png,image/webp" /></label>
    <label className="account-checkbox"><input name="active" type="checkbox" defaultChecked={product.active ?? true} /> Показывать в каталоге</label>
    <Feedback error={error} />
    <div className="account-actions"><button className="button button-primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить товар'}</button>
      <button className="button button-outline" type="button" disabled={busy} onClick={onCancel}>Отмена</button></div>
  </form>;
}

function CatalogPanel() {
  const catalog = useResource('/admin/catalog');
  const [editing, setEditing] = useState(null);
  const [success, setSuccess] = useState('');
  return <div className="account-stack">
    <div className="account-section-title"><h2>Управление каталогом</h2>
      <button className="button button-primary" disabled={!catalog.data} onClick={() => { setEditing({}); setSuccess(''); }}><Plus size={17} /> Добавить товар</button>
    </div>
    <Feedback success={success} />
    {editing && catalog.data && <EditProduct key={editing.id ?? 'new'} product={editing} categories={catalog.data.categories}
      onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setSuccess('Товар сохранён.'); catalog.reload(); }} />}
    <ResourceState resource={catalog} />
    {catalog.data && <div className="account-card account-list">
      {catalog.data.products.map((product) => <button key={product.id} className="account-row catalog-row"
        onClick={() => { setEditing(product); setSuccess(''); }}>
        <span className="account-thumb">{picture(product) ? <img alt="" src={picture(product)} /> : <ImageIcon size={21} />}</span>
        <span><strong>{product.name}</strong><small>{product.sku} · Остаток {product.stock} {product.unit}</small></span>
        <strong>{rubles(product.price)}</strong>
        <span className="account-status">{product.active ? 'В каталоге' : 'Скрыт'}</span>
      </button>)}
    </div>}
  </div>;
}

function SettingsPanel({ user }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      await api('/auth/password', body);
      form.reset();
      setSuccess('Пароль изменён.');
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="account-stack"><h2>Настройки аккаунта</h2>
    <form className="account-card account-form" onSubmit={submit}>
      <div><strong>{user.name}</strong><p className="account-muted">{user.email}</p></div><h3>Сменить пароль</h3>
      <label>Текущий пароль<input name="currentPassword" type="password" autoComplete="current-password" maxLength={128} required /></label>
      <label>Новый пароль<input name="newPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} required /></label>
      <Feedback error={error} success={success} />
      <button className="button button-primary" disabled={busy}>Сохранить пароль</button>
    </form>
  </div>;
}

function Dashboard({ user }) {
  const [tab, setTab] = useState('orders');
  const tabs = [
    ['orders', user.role === 'customer' ? 'Мои заявки' : 'Заявки', ClipboardList],
    ...(user.role === 'admin' ? [['catalog', 'Каталог', Boxes], ['users', 'Аккаунты', Users]] : []),
    ['settings', 'Настройки', Settings],
  ];
  return <main className="shell account-main">
    <div className="account-hero"><div><span className="account-status">{roleNames[user.role]}</span><h1>{titles[user.role]}</h1><p>{user.name}</p></div></div>
    <div className="account-layout">
      <nav className="account-nav" aria-label="Разделы кабинета">
        {tabs.map(([id, label, Icon]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={18} /> {label}</button>)}
      </nav>
      <div className="account-body">
        {tab === 'orders' && <Orders staff={user.role !== 'customer'} />}
        {tab === 'catalog' && <CatalogPanel />}
        {tab === 'users' && <AccountsPanel user={user} />}
        {tab === 'settings' && <SettingsPanel user={user} />}
      </div>
    </div>
  </main>;
}

export default function Account({ page }) {
  const session = useResource('/auth/me');
  const [localSession, setLocalSession] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const user = localSession === undefined ? session.data?.user : localSession;
  const requiredRole = page === '/admin' ? 'admin' : page === '/manager' ? 'manager' : null;
  function signIn(account) {
    if (page === '/account' && account.role !== 'customer') window.location.replace(rolePage[account.role]);
    else setLocalSession(account);
  }
  async function logout() {
    setBusy(true);
    setError('');
    try {
      await api('/auth/logout', {});
      save('forma-last-receipt', null);
      save('forma-pending-order', null);
      setLocalSession(null);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <>
    <AccountHeader user={user} onLogout={logout} busy={busy} />
    {error && <div className="shell account-notice"><Feedback error={error} /></div>}
    {localSession === undefined && (session.loading || session.error) ?
      <main className="shell account-notice"><ResourceState resource={session} /></main>
      : !user ? <SignIn staffOnly={Boolean(requiredRole)} onSignIn={signIn} />
      : requiredRole && requiredRole !== user.role ? <main className="shell account-notice"><section className="account-card account-stack">
        <h1>Раздел недоступен</h1><p>Вы вошли с ролью «{roleNames[user.role]}».</p>
        <a className="button button-primary" href={rolePage[user.role]}>Открыть свой кабинет <ArrowRight size={17} /></a>
      </section></main>
      : <Dashboard key={user.id} user={user} />}
  </>;
}
