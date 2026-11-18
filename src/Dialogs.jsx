import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clipboard, Image as ImageIcon, MapPin, Minus, Plus, Search, ShoppingBag, Trash2, Truck, X } from 'lucide-react';
import { api, orderNumber, picture, readSaved, rubles, save, statusLabels } from './api.js';
import { pickup } from './pickup.js';

const receiptKey = 'forma-last-receipt';
const pendingKey = 'forma-pending-order';

export function Dialog({ view, title, onClose, children }) {
  const ref = useRef(null);
  const opener = useRef(document.activeElement);
  const header = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = opener.current;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  useEffect(() => { header.current.focus(); }, [view]);

  return (
    <dialog ref={ref} className="panel" aria-labelledby="panel-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="panel-content">
        <header className="panel-header">
          <h2 id="panel-title" tabIndex="-1" ref={header}>{title}</h2>
          <button className="icon-button" aria-label="Закрыть" onClick={onClose}><X size={21} /></button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function ProductDetails({ product, category, onAdd }) {
  return (
    <div className="detail">
      {picture(product) ? <img src={picture(product)} alt={category} /> : <div className="detail-placeholder"><ImageIcon size={30} /> Фото пока нет</div>}
      <div className="detail-meta"><span>{category}</span><span>Арт. {product.sku}</span></div>
      <p>{product.description}</p>
      <dl><div><dt>Характеристики</dt><dd>{product.spec}</dd></div>
        <div><dt>Наличие</dt><dd>{product.stock ? `${product.stock} ${product.unit}` : 'Под заказ'}</dd></div>
        <div><dt>Цена за единицу</dt><dd>{rubles(product.price)} / {product.unit}</dd></div></dl>
      <button className="button button-primary full" onClick={() => onAdd(product)}><Plus size={18} /> Добавить в заявку</button>
    </div>
  );
}

export function Quantity({ product, quantity, onQuantity }) {
  return (
    <div className="quantity" aria-label={`Количество для «${product.name}»`}>
      <button aria-label={`Уменьшить количество «${product.name}»`} disabled={quantity <= 1} onClick={() => onQuantity(product, quantity - 1)}><Minus size={16} /></button>
      <input type="number" min="1" max="999" inputMode="numeric" aria-label={`Количество «${product.name}»`}
        key={quantity} defaultValue={quantity} onBlur={(event) => {
          const entered = event.currentTarget.valueAsNumber;
          const next = Number.isFinite(entered) ? Math.min(999, Math.max(1, Math.trunc(entered))) : quantity;
          event.currentTarget.value = next;
          onQuantity(product, next);
        }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      <button aria-label={`Увеличить количество «${product.name}»`} disabled={quantity >= 999} onClick={() => onQuantity(product, quantity + 1)}><Plus size={16} /></button>
    </div>
  );
}

export function Cart({ items, total, onQuantity, onClose, onContinue }) {
  if (!items.length) {
    return <div className="empty-dialog"><ShoppingBag size={35} /><h3>В заявке пока пусто</h3>
      <p>Добавьте подходящие материалы из каталога.</p>
      <a className="button button-primary" href="#catalog" onClick={onClose}>Открыть каталог <ArrowRight size={18} /></a>
    </div>;
  }

  return (<>
    <div className="cart-list">
      {items.map(({ product, quantity }) => <article className="cart-row" key={product.id}>
        {picture(product) ? <img src={picture(product)} alt="" /> : <span className="cart-photo-placeholder"><ImageIcon size={18} /></span>}
        <div className="cart-row-main"><h3>{product.name}</h3><p>{rubles(product.price)} / {product.unit}</p>
          <Quantity product={product} quantity={quantity} onQuantity={onQuantity} />
        </div>
        <div className="cart-row-end"><button className="icon-button remove" aria-label={`Удалить «${product.name}»`} onClick={() => onQuantity(product, 0)}><Trash2 size={17} /></button>
          <strong>{rubles(product.price * quantity)}</strong></div>
      </article>)}
    </div>
    <div className="panel-summary">
      <p className="total"><span>Материалы</span><strong>{rubles(total)}</strong></p>
      <p>Стоимость доставки уточняется при согласовании.</p>
      <button className="button button-primary full" onClick={onContinue}>Оформить заявку <ArrowRight size={18} /></button>
    </div>
  </>);
}

export function Checkout({ items, total, draft, setDraft, onBack, onResult, onBusy }) {
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const change = (field) => (event) => {
    const value = field === 'consent' ? event.target.checked : event.target.value;
    setDraft((previous) => ({ ...previous, [field]: value }));
  };

  async function submit(event) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    onBusy(true);
    setBusy(true);
    setError('');
    try {
      const payload = { ...draft, items: items.map(({ product, quantity }) => ({ productId: product.id, quantity })) };
      const fingerprint = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
        .then((bytes) => Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(''));
      const pending = readSaved(pendingKey, null);
      const code = pending?.fingerprint === fingerprint ? pending.code : crypto.randomUUID();
      save(pendingKey, { code, fingerprint });
      const result = await api('/orders', { ...payload, code });
      save(receiptKey, { id: result.id, code: result.code });
      save(pendingKey, null);
      onResult(result);
    } catch (error) {
      setError(error.status ? error.message : 'Не удалось отправить заявку. Проверьте подключение и повторите.');
    } finally {
      submitting.current = false;
      onBusy(false);
      setBusy(false);
    }
  }

  return <form className="panel-form" onSubmit={submit}>
    <button type="button" className="inline-button" onClick={onBack} disabled={busy}><ArrowLeft size={16} /> К составу заявки</button>
    <fieldset disabled={busy}>
      <label>Имя<input name="name" autoComplete="name" placeholder="Иван Петров" minLength={2} maxLength={80} required value={draft.name} onChange={change('name')} /></label>
      <label>Телефон<input name="phone" type="tel" autoComplete="tel" placeholder="+7 900 000-00-00" minLength={7} maxLength={32} required value={draft.phone} onChange={change('phone')} /></label>
      <fieldset className="fulfillment">
        <legend>Способ получения</legend>
        <label><input type="radio" name="method" value="pickup" checked={draft.method === 'pickup'} onChange={change('method')} /><MapPin size={16} /> Самовывоз</label>
        <label><input type="radio" name="method" value="delivery" checked={draft.method === 'delivery'} onChange={change('method')} /><Truck size={17} /> Доставка</label>
      </fieldset>
      {draft.method === 'delivery' && <label>Адрес доставки<input name="address" autoComplete="street-address" placeholder="Город, улица, дом" required minLength={5} maxLength={200} value={draft.address} onChange={change('address')} /></label>}
      {draft.method === 'pickup' && <p className="pickup-form-note"><MapPin size={16} /><span>{pickup.address} <small>· Демонстрационный адрес</small></span></p>}
      <label>Комментарий <span className="optional">необязательно</span>
        <textarea name="comment" rows={2} maxLength={500} placeholder="Желаемая дата, условия подъезда" value={draft.comment} onChange={change('comment')} />
      </label>
      <label className="consent"><input type="checkbox" checked={draft.consent} onChange={change('consent')} required />
        Подтверждаю отправку контактных данных для обработки заявки.
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="total"><span>Материалы</span><strong>{rubles(total)}</strong></p>
      <button className="button button-primary full" disabled={busy}>{busy ? 'Отправляем…' : 'Отправить заявку'} <ArrowRight size={18} /></button>
    </fieldset>
  </form>;
}

export function Success({ receipt, onTrack, onClose }) {
  const [copyMessage, setCopyMessage] = useState('');
  return <div className="success">
    <div className="success-mark"><Check size={25} /></div>
    <h3>Заявка № {orderNumber(receipt.id)}</h3>
    <p>Сохраните номер и код, чтобы проверить её статус.</p>
    <div className="receipt"><span>Код доступа</span><code>{receipt.code}</code>
      <button className="inline-button" onClick={async () => {
        try {
          await navigator.clipboard.writeText(`Заявка № ${orderNumber(receipt.id)}\nКод: ${receipt.code}`);
          setCopyMessage('Номер и код скопированы.');
        } catch {
          setCopyMessage('Выделите код, чтобы скопировать его.');
        }
      }}><Clipboard size={16} /> Скопировать номер и код</button>
      <span role="status">{copyMessage}</span>
    </div>
    <button className="button button-primary full" onClick={onTrack}>Проверить статус <ArrowRight size={18} /></button>
    <button className="inline-button" onClick={onClose}>Вернуться на сайт</button>
  </div>;
}

export function Track({ receipt }) {
  const last = receipt || readSaved(receiptKey, {}) || {};
  const [id, setId] = useState(last.id ? orderNumber(last.id) : '');
  const [code, setCode] = useState(last.code || '');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(await api('/orders/track', { id: id.trim(), code: code.trim() }));
    } catch (error) {
      setError(error.status ? error.message : 'Не удалось проверить статус. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  return <form className="panel-form" onSubmit={submit}>
    <p className="panel-intro">Введите номер и код, которые появились после отправки заявки.</p>
    <fieldset disabled={busy}>
      <label>Номер заявки<input name="id" required inputMode="numeric" pattern="[0-9]+" maxLength={16} placeholder="00001" value={id} onChange={(event) => { setId(event.target.value); setResult(null); }} /></label>
      <label>Код доступа<input name="code" required autoComplete="off" spellCheck="false" maxLength={50} value={code} onChange={(event) => { setCode(event.target.value); setResult(null); }} /></label>
      <button className="button button-primary full" disabled={busy}><Search size={18} /> {busy ? 'Проверяем…' : 'Проверить статус'}</button>
    </fieldset>
    {error && <p className="form-error" role="alert">{error}</p>}
    {result && <section className="tracking-result">
      <div role="status"><strong>Заявка № {orderNumber(result.id)}</strong><span className="status-pill">{statusLabels[result.status]}</span></div>
      <ul>{result.items.map((item) => <li key={item.name}>{item.name}<span>{item.quantity} {item.unit}</span></li>)}</ul>
      <p className="total"><span>Материалы</span><strong>{rubles(result.total)}</strong></p>
    </section>}
  </form>;
}
