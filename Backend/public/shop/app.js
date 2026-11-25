(() => {
  const grid = document.querySelector('#product-grid');
  const panel = document.querySelector('#cart-panel');
  const scrim = document.querySelector('#scrim');
  const rows = document.querySelector('#cart-items');
  const tableSelection = document.querySelector('#table-selection');
  const menuView = document.querySelector('#menu-view');
  const money = amount => `${Number(amount).toLocaleString('vi-VN')} ₫`;
  const state = { products: [], cart: readCart(), filter: 'all', tableId: readTable() };

  function readCart() { try { const value = JSON.parse(localStorage.getItem('moc-cart') || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
  function readTable() { const table = localStorage.getItem('moc-table'); return /^0[1-4]$/.test(table || '') ? table : ''; }
  function saveCart() { localStorage.setItem('moc-cart', JSON.stringify(state.cart)); renderCart(); }
  function escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function showToast(message) { const toast = document.querySelector('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200); }
  function safeImage(product, cls = '') { return product.imageUrl ? `<img class="${cls}" src="${escape(product.imageUrl)}" alt="${escape(product.name)}" loading="lazy" onerror="this.style.display='none'">` : ''; }
  function showCurrentStep() {
    const hasTable = Boolean(state.tableId);
    tableSelection.hidden = hasTable;
    menuView.hidden = !hasTable;
    document.querySelector('#selected-table-label').textContent = `Bàn ${state.tableId}`;
    document.querySelector('#cart-table-label').textContent = state.tableId || '--';
  }
  function renderProducts() {
    const menuCategories = ['rice','food','noodles','drinks'];
    const products = state.products.filter(item => menuCategories.includes(item.category) && (state.filter === 'all' || item.category === state.filter));
    if (!products.length) { grid.innerHTML = '<div class="empty-products">Thực đơn đang được cập nhật. Vui lòng quay lại sau.</div>'; return; }
    grid.innerHTML = products.map(item => `<article class="product-card">
      <div class="product-image">${safeImage(item)}<span class="product-tag">${escape(item.tag || item.categoryName || 'MÓN NGON')}</span></div>
      <div class="product-body"><div class="product-meta"><div><h3 class="product-name">${escape(item.name)}</h3><p class="product-category">${escape(item.categoryName || 'Món ngon')}</p></div><span class="product-price">${money(item.price)}</span></div>
      <p class="product-description">${escape(item.description || 'Được chuẩn bị tươi ngon khi bạn gọi món.')}</p><div class="product-extra"><span>Khẩu phần: ${escape(item.portion || '1 phần')}</span><span>${escape(item.feature || '')}</span></div>
      <div class="product-actions"><button class="detail-button" type="button" data-detail="${escape(item.id)}">Chi tiết</button><button class="add-button" type="button" data-add="${escape(item.id)}">Thêm vào giỏ　+</button></div></div></article>`).join('');
  }
  function renderCart() {
    const count = state.cart.reduce((total, item) => total + Number(item.quantity || 0), 0);
    const total = state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
    document.querySelector('#cart-count').textContent = count;
    document.querySelector('#cart-total').textContent = money(total);
    document.querySelector('#checkout').disabled = count === 0 || !state.tableId;
    rows.innerHTML = state.cart.length ? state.cart.map(item => `<article class="cart-row">
      <div class="cart-thumb">${safeImage(item)}</div><div class="cart-info"><strong>${escape(item.name)}</strong><p>${money(item.price)} / phần</p>
      <div class="quantity"><button type="button" data-qty="-1" data-id="${escape(item.id)}" aria-label="Giảm số lượng">−</button><span>${Number(item.quantity)}</span><button type="button" data-qty="1" data-id="${escape(item.id)}" aria-label="Tăng số lượng">+</button></div>
      <input class="cart-note" data-note="${escape(item.id)}" maxlength="200" placeholder="Ghi chú món (ít cay, không hành…)" value="${escape(item.note || '')}"></div>
      <div class="cart-side"><span class="cart-price">${money(Number(item.price) * Number(item.quantity))}</span><button class="remove-item" data-remove="${escape(item.id)}" type="button">Xóa</button></div></article>`).join('') : '<div class="cart-empty">Giỏ hàng đang trống.<br>Chọn một món ngon trong thực đơn nhé.</div>';
  }
  function toggleCart(open) { panel.classList.toggle('open', open); scrim.classList.toggle('open', open); panel.setAttribute('aria-hidden', String(!open)); document.body.style.overflow = open ? 'hidden' : ''; }
  function addProduct(product) { const existing = state.cart.find(item => item.id === String(product.id)); if (existing) existing.quantity += 1; else state.cart.push({ id: String(product.id), name: product.name, price: Number(product.price), imageUrl: product.imageUrl || '', quantity: 1, note: '' }); saveCart(); showToast(`${product.name} đã được thêm vào giỏ`); }
  async function loadProducts() {
    try { const response = await apiFetch('/api/products'); const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Không tải được thực đơn'); state.products = data.products || []; const validIds = new Set(state.products.filter(item => ['rice','food','noodles','drinks'].includes(item.category)).map(item => String(item.id))); state.cart = state.cart.filter(item => validIds.has(String(item.id))); saveCart(); renderProducts(); }
    catch (error) { grid.innerHTML = `<div class="empty-products">${escape(error.message)}. Vui lòng tải lại trang.</div>`; }
  }

  document.querySelectorAll('[data-table]').forEach(button => button.addEventListener('click', () => { state.tableId = button.dataset.table; localStorage.setItem('moc-table', state.tableId); showCurrentStep(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  document.querySelector('#change-table').addEventListener('click', () => { tableSelection.hidden = false; menuView.hidden = true; window.scrollTo({ top: 0, behavior: 'smooth' }); });
  grid.addEventListener('click', event => {
    const add = event.target.closest('[data-add]'); const detail = event.target.closest('[data-detail]');
    if (add) { const item = state.products.find(product => String(product.id) === add.dataset.add); if (item) addProduct(item); }
    if (detail) { const item = state.products.find(product => String(product.id) === detail.dataset.detail); if (!item) return; document.querySelector('#dish-detail').innerHTML = `<div class="dish-detail-image">${safeImage(item)}</div><div class="dish-detail-copy"><p class="eyebrow">${escape(item.categoryName || 'THỰC ĐƠN')}</p><h2>${escape(item.name)}</h2><strong>${money(item.price)}</strong><p>${escape(item.description || '')}</p><p><strong>Khẩu phần:</strong> ${escape(item.portion || '1 phần')}<br><strong>Đặc điểm:</strong> ${escape(item.feature || 'Nấu mới khi gọi')}</p><button class="add-button" data-dialog-add="${escape(item.id)}" type="button">Thêm vào giỏ</button></div>`; document.querySelector('#dish-dialog').showModal(); }
  });
  document.querySelector('#dish-detail').addEventListener('click', event => { const button = event.target.closest('[data-dialog-add]'); if (!button) return; const item = state.products.find(product => String(product.id) === button.dataset.dialogAdd); if (item) addProduct(item); document.querySelector('#dish-dialog').close(); });
  document.querySelector('#close-dish').addEventListener('click', () => document.querySelector('#dish-dialog').close());
  rows.addEventListener('input', event => { const input = event.target.closest('[data-note]'); if (!input) return; const item = state.cart.find(entry => entry.id === input.dataset.note); if (item) { item.note = input.value; localStorage.setItem('moc-cart', JSON.stringify(state.cart)); } });
  rows.addEventListener('click', event => { const quantity = event.target.closest('[data-qty]'); const remove = event.target.closest('[data-remove]'); if (quantity) { const item = state.cart.find(entry => entry.id === quantity.dataset.id); if (item) item.quantity += Number(quantity.dataset.qty); state.cart = state.cart.filter(entry => entry.quantity > 0); saveCart(); } else if (remove) { state.cart = state.cart.filter(entry => entry.id !== remove.dataset.remove); saveCart(); } });
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => { document.querySelector('.filter.active')?.classList.remove('active'); button.classList.add('active'); state.filter = button.dataset.filter; renderProducts(); }));
  document.querySelector('#open-cart').addEventListener('click', () => toggleCart(true)); document.querySelector('#close-cart').addEventListener('click', () => toggleCart(false)); scrim.addEventListener('click', () => toggleCart(false)); document.addEventListener('keydown', event => { if (event.key === 'Escape') toggleCart(false); });
  document.querySelector('#checkout').addEventListener('click', () => { if (!state.tableId || !state.cart.length) return; sessionStorage.removeItem('moc-checkout-order'); sessionStorage.removeItem('moc-order-request-id'); sessionStorage.setItem('moc-checkout-draft', JSON.stringify({ tableId: state.tableId, items: state.cart })); location.href = '/shop/checkout.html'; });
  showCurrentStep(); renderCart(); loadProducts();
})();
