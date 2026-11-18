import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowDownUp, ArrowRight, ArrowUpRight, Boxes, Check, ChevronDown, ChevronRight, ClipboardList, Factory, Image as ImageIcon, MapPin, Menu, PackageCheck, Plus, Search, ShoppingBag, Truck, UserRound, X } from 'lucide-react';
import { api, picture, readSaved, rubles, save } from './api.js';
import { Cart, Checkout, Dialog, ProductDetails, Success, Track } from './Dialogs.jsx';
import { pickup } from './pickup.js';
import Account from './Account.jsx';
import './styles.css';

const cartKey = 'forma-cart';
const initialDraft = { name: '', phone: '', method: 'pickup', address: '', comment: '', consent: false };

function getCart() {
  const saved = readSaved(cartKey, {});
  return Object.fromEntries(Object.entries(saved).filter(([id, quantity]) =>
    /^[1-9]\d*$/.test(id) && Number.isInteger(quantity) && quantity > 0 && quantity <= 999));
}

function Brand() {
  return <a className="brand" href="#top" aria-label="ФОРМА — на главную">
    <img src="/mark.svg" width="40" height="40" alt="" />
    <span><strong>ФОРМА</strong><small>ЗАВОД СТРОЙМАТЕРИАЛОВ</small></span>
  </a>;
}

function Header({ count, onCart, onTrack }) {
  const [menu, setMenu] = useState(false);
  const links = <>
    <a href="#catalog" onClick={() => setMenu(false)}>Каталог</a>
    <a href="#plant" onClick={() => setMenu(false)}>О заводе</a>
    <a href="#delivery" onClick={() => setMenu(false)}>Доставка</a>
  </>;
  return <header className="site-header" id="top">
    <div className="shell header-inner">
      <Brand />
      <nav className="nav-desktop" aria-label="Основное меню">{links}</nav>
      <div className="header-actions">
        <button className="header-track" onClick={onTrack}>Статус заявки</button>
        <a className="header-account" href="/account" aria-label="Личный кабинет"><UserRound size={17} /><span>Кабинет</span></a>
        <button className="header-cart" aria-label={`Заявка, позиций: ${count}`} onClick={onCart}>
          <ShoppingBag size={17} /><span className="header-cart-text">Заявка</span><span className="cart-badge">{count}</span>
        </button>
        <button className="mobile-menu icon-button" onClick={() => setMenu(!menu)}
          aria-label={menu ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menu} aria-controls="mobile-nav">
          {menu ? <X size={23} /> : <Menu size={23} />}
        </button>
      </div>
      <nav className="nav-mobile" id="mobile-nav" aria-label="Мобильное меню" hidden={!menu}>
        {links}
        <button onClick={() => { setMenu(false); onTrack(); }}>Статус заявки</button>
      </nav>
    </div>
  </header>;
}

function Hero({ onTrack }) {
  return <div className="shell">
    <section className="hero" aria-labelledby="hero-title">
      <img src="/images/factory.webp" width="1672" height="941" alt="" fetchPriority="high" />
      <div className="hero-content">
        <span className="eyebrow"><span className="green-dot" /> ЗАВОД СТРОИТЕЛЬНЫХ МАТЕРИАЛОВ</span>
        <h1 id="hero-title">Материалы<br />для строительства</h1>
        <p>Стеновые блоки, плитка, сухие смеси и железобетон.<br className="desktop-break" /> Подберите всё для объекта и оформите одну заявку.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="#catalog">Смотреть каталог <ArrowDown size={17} /></a>
          <button className="button button-glass" onClick={onTrack}>Проверить заявку <ArrowUpRight size={18} /></button>
        </div>
      </div>
      <div className="hero-caption"><span /> Цех готовой продукции</div>
    </section>
    <div className="benefits">
      <div><span className="benefit-icon"><Factory size={23} /></span><span><strong>От производителя</strong><small>Материалы из каталога завода</small></span></div>
      <div><span className="benefit-icon"><Boxes size={23} /></span><span><strong>В наличии и под заказ</strong><small>Остаток указан в карточке</small></span></div>
      <div><span className="benefit-icon"><Truck size={24} /></span><span><strong>Доставка и самовывоз</strong><small>Выберите способ при оформлении</small></span></div>
    </div>
  </div>;
}

function ProductPhoto({ product }) {
  return picture(product) ? <img src={picture(product)} width="762" height="506" alt="" loading="lazy" /> :
    <span className="photo-placeholder"><ImageIcon size={27} /><span>Фото пока нет</span></span>;
}

function ProductCard({ product, category, onOpen, onAdd, count }) {
  return <article className="product-card">
    <button className="product-image" aria-label={`Подробнее о товаре «${product.name}»`} onClick={() => onOpen(product)}>
      <ProductPhoto product={product} />
      <span className={`stock ${product.stock ? '' : 'stock-order'}`}><i />{product.stock ? 'В наличии' : 'Под заказ'}</span>
      <span className="product-more"><ArrowUpRight size={17} /></span>
    </button>
    <div className="product-content">
      <p className="product-category">{category}</p>
      <h3><button onClick={() => onOpen(product)}>{product.name}</button></h3>
      <p className="product-spec">{product.spec}</p>
      <div className="product-bottom">
        <div className="product-price"><strong>{rubles(product.price)}</strong><small> / {product.unit}</small></div>
        <button className={`add-button ${count ? 'is-added' : ''}`} aria-label={`Добавить «${product.name}» в заявку`} title="Добавить в заявку" onClick={() => onAdd(product)}>{count || <Plus size={20} />}</button>
      </div>
    </div>
  </article>;
}

function Catalog({ data, loadError, onRetry, cart, onAdd, onOpen }) {
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('default');
  const [showAll, setShowAll] = useState(false);
  const norm = (value) => value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const query = norm(search);
  const types = Object.fromEntries(data?.categories.map(({ id, title }) => [id, title]) ?? []);
  const filtered = data?.products.filter((product) => (!category || product.category === category) &&
    norm([product.name, product.sku, product.spec, types[product.category]].join(' ')).includes(query)) ?? [];
  if (sort === 'asc') filtered.sort((a, b) => a.price - b.price);
  if (sort === 'desc') filtered.sort((a, b) => b.price - a.price);
  if (sort === 'stock') filtered.sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0));

  const showFull = showAll || Boolean(category || query || sort !== 'default');
  const visible = showFull ? filtered : filtered.slice(0, 4);
  function reset() {
    setCategory('');
    setSearch('');
    setSort('default');
    setShowAll(false);
  }

  return <section className="catalog shell" id="catalog" aria-labelledby="catalog-title">
    <div className="section-kicker"><span /> ПРОДУКЦИЯ</div>
    <div className="catalog-heading"><h2 id="catalog-title">Каталог материалов</h2>
      <p>Сравните характеристики и цены,<br className="desktop-break" /> чтобы выбрать материалы для вашего объекта.</p>
    </div>
    <div className="catalog-controls">
      <label className="search-box"><Search size={20} /><input
        type="search" aria-label="Поиск по каталогу" placeholder="Название или артикул"
        value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label className="sort-box"><ArrowDownUp size={17} /><select aria-label="Сортировка" value={sort} onChange={(event) => setSort(event.target.value)}>
        <option value="default">По умолчанию</option><option value="asc">Сначала дешевле</option>
        <option value="desc">Сначала дороже</option><option value="stock">Сначала в наличии</option>
      </select><ChevronDown size={15} /></label>
    </div>
    <div className="filter-bar">
      <div className="filters" role="group" aria-label="Категории материалов">
        <button className={!category ? 'selected' : ''} aria-pressed={!category} onClick={() => setCategory('')}>Все материалы</button>
        {data?.categories.map(({ id, title }) => <button key={id} className={category === id ? 'selected' : ''}
          aria-pressed={category === id} onClick={() => setCategory(id)}>{title}</button>)}
      </div>
      {data && <span className="results-count" aria-live="polite">Позиций: {filtered.length}</span>}
    </div>
    {loadError && <div className="catalog-empty" role="alert"><p>Каталог временно недоступен.</p><button className="button button-dark" onClick={onRetry}>Повторить загрузку</button></div>}
    {!data && !loadError && <div className="catalog-empty" role="status"><p>Загружаем материалы…</p></div>}
    {!!data && !filtered.length && <div className="catalog-empty"><Search size={28} /><h3>Материалы не найдены</h3>
      <p>Попробуйте изменить запрос или сбросить фильтры.</p><button className="button button-dark" onClick={reset}>Сбросить фильтры</button></div>}
    <div className="product-grid">
      {visible.map((product) => <ProductCard key={product.id} product={product} category={types[product.category]}
        count={cart[product.id]} onOpen={onOpen} onAdd={onAdd} />)}
    </div>
    {!showFull && filtered.length > visible.length && <div className="show-all"><button className="button button-outline" onClick={() => setShowAll(true)}>Показать ещё {filtered.length - visible.length} <ChevronDown size={17} /></button></div>}
  </section>;
}

function Information({ onCart, onTrack }) {
  const [mapOpen, setMapOpen] = useState(false);
  return <>
    <section className="plant" id="plant" aria-labelledby="plant-title">
      <div className="shell plant-layout">
        <div className="plant-image"><img src="/images/production.webp" width="1536" height="1024" alt="Линия изготовления бетонных изделий" loading="lazy" /></div>
        <div className="plant-copy">
          <div className="section-kicker"><span /> О ЗАВОДЕ</div>
          <h2 id="plant-title">От цеха до объекта</h2>
          <p>ФОРМА — учебный проект завода строительных материалов. Каталог объединяет продукцию для кладки, устройства фундаментов и благоустройства территории.</p>
          <p>В карточках указаны размеры, цена и наличие. Состав поставки можно собрать в одну заявку, а её обработку проверить по номеру и коду.</p>
          <a className="inline-button" href="#catalog">Перейти к материалам <ArrowUpRight size={18} /></a>
        </div>
      </div>
    </section>
    <section className="shell delivery" id="delivery" aria-labelledby="delivery-title">
      <div className="delivery-heading"><div className="section-kicker"><span /> ПОЛУЧЕНИЕ</div><h2 id="delivery-title">Доставка и самовывоз</h2></div>
      <div className="delivery-options">
        <article><Truck size={27} /><h3>Доставка на объект</h3><p>Укажите адрес в заявке. В комментарии можно описать подъезд, условия разгрузки и нужную дату.</p></article>
        <article><PackageCheck size={27} /><h3>Самовывоз</h3><p>Выберите самовывоз при отправке. Время выдачи и параметры транспорта уточняются при согласовании.</p>
          <address className="pickup-address"><MapPin size={17} /><span>{pickup.address}<small>Демонстрационный адрес</small></span></address>
          <a className="inline-button" href={pickup.route} target="_blank" rel="noopener noreferrer">Построить маршрут <ArrowUpRight size={17} /></a>
        </article>
      </div>
      <details className="pickup-map-panel" onToggle={(event) => setMapOpen(event.currentTarget.open)}>
        <summary><MapPin size={19} /> Карта самовывоза <ChevronDown size={17} /></summary>
        {mapOpen && <iframe className="pickup-map" title="Точка самовывоза на Яндекс Картах" src={pickup.map} allowFullScreen />}
        <a className="inline-button full-map-link" href={pickup.fullMap} target="_blank" rel="noopener noreferrer">Открыть в Яндекс Картах <ArrowUpRight size={16} /></a>
      </details>
    </section>
    <section className="shell"><div className="cta">
      <div><h2>Готовы собрать поставку?</h2><p>Откройте заявку, чтобы проверить состав, или посмотрите статус отправленной.</p></div>
      <div className="cta-actions"><button className="button button-primary" onClick={onCart}>Открыть заявку <ArrowRight size={17} /></button>
      <button className="button button-glass" onClick={onTrack}>Статус заявки <ClipboardList size={17} /></button></div>
    </div></section>
  </>;
}

function Footer({ onTrack }) {
  return <footer className="footer">
    <div className="shell footer-inner">
      <Brand /><nav aria-label="Меню в подвале"><a href="#catalog">Каталог</a><a href="#plant">О заводе</a><a href="#delivery">Доставка</a><button onClick={onTrack}>Статус заявки <ChevronRight size={14} /></button></nav>
    </div>
    <div className="shell footer-note">© {new Date().getFullYear()} ФОРМА · Учебный проект. Цены, остатки и адрес самовывоза демонстрационные.</div>
  </footer>;
}

function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [cart, setCart] = useState(getCart);
  const [view, setView] = useState('');
  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(initialDraft);
  const [receipt, setReceipt] = useState(null);
  const [notice, setNotice] = useState(null);
  const noticeTimer = useRef(null);
  const checkoutBusy = useRef(false);

  async function loadCatalog() {
    setLoadError(false);
    try { setData(await api('/catalog')); }
    catch { setLoadError(true); }
  }

  useEffect(() => { void loadCatalog(); return () => clearTimeout(noticeTimer.current); }, []);
  useEffect(() => { save(cartKey, cart); }, [cart]);
  useEffect(() => {
    if (data) setCart((previous) => Object.fromEntries(data.products
      .filter(({ id }) => previous[id]).map(({ id }) => [id, previous[id]])));
  }, [data]);

  function changeQuantity(product, quantity) {
    setCart((previous) => {
      const next = { ...previous };
      if (quantity) next[product.id] = quantity;
      else delete next[product.id];
      return next;
    });
  }

  function add(product) {
    setCart((previous) => ({ ...previous, [product.id]: Math.min((previous[product.id] || 0) + 1, 999) }));
    setNotice({ text: cart[product.id] >= 999 ? 'Достигнуто максимальное количество' : 'Материал добавлен в заявку' });
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3200);
  }

  const close = () => { if (!checkoutBusy.current) setView(''); };
  const onCart = () => setView('cart');
  const onTrack = () => setView('track');
  const items = data?.products.filter(({ id }) => cart[id]).map((product) => ({ product, quantity: cart[product.id] })) ?? [];
  const total = items.reduce((sum, { product, quantity }) => sum + product.price * quantity, 0);
  const titles = { product: selected?.name, cart: 'Ваша заявка', checkout: 'Оформление заявки', success: 'Заявка отправлена', track: 'Статус заявки' };

  return <>
    <a className="skip-link" href="#catalog">К каталогу</a>
    <Header count={Object.keys(cart).length} onCart={onCart} onTrack={onTrack} />
    <main>
      <Hero onTrack={onTrack} />
      <Catalog data={data} loadError={loadError} onRetry={loadCatalog} cart={cart} onAdd={add}
        onOpen={(product) => { setSelected(product); setView('product'); }} />
      <Information onCart={onCart} onTrack={onTrack} />
    </main>
    <Footer onTrack={onTrack} />
    <div className="toast-area" role="status" aria-live="polite">{notice && <div className="toast"><Check size={18} />{notice.text}</div>}</div>
    {view && <Dialog view={view} title={titles[view]} onClose={close}>
      {view === 'product' && <ProductDetails product={selected} category={data.categories.find(({ id }) => id === selected.category).title} onAdd={(product) => { add(product); onCart(); }} />}
      {view === 'cart' && <Cart items={items} total={total} onQuantity={changeQuantity} onClose={close} onContinue={() => setView('checkout')} />}
      {view === 'checkout' && <Checkout items={items} total={total} draft={draft} setDraft={setDraft} onBusy={(value) => { checkoutBusy.current = value; }}
        onBack={onCart} onResult={(result) => { setReceipt(result); setCart({}); setDraft(initialDraft); setView('success'); }} />}
      {view === 'success' && <Success receipt={receipt} onClose={close} onTrack={onTrack} />}
      {view === 'track' && <Track receipt={receipt} />}
    </Dialog>}
  </>;
}

const page = window.location.pathname.replace(/\/$/, '');
const isAccount = ['/account', '/manager', '/admin'].includes(page);
createRoot(document.getElementById('root')).render(isAccount ? <Account page={page} /> : <App />);
