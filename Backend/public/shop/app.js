(() => {
  const grid = document.querySelector('#product-grid');
  const panel = document.querySelector('#cart-panel');
  const scrim = document.querySelector('#scrim');
  const rows = document.querySelector('#cart-items');
  const money = amount => `${Number(amount).toLocaleString('vi-VN')} ₫`;
  const state = { products: [], cart: readCart(), filter: 'all' };

  function readCart() {
    try { return JSON.parse(localStorage.getItem('moc-cart') || '[]'); }
    catch { return []; }
  }
  function saveCart() {
    localStorage.setItem('moc-cart', JSON.stringify(state.cart));
    renderCart();
  }
  function showToast(message) {
    const toast = document.querySelector('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('show'), 2100);
  }
  function safeImage(product) {
    if (!product.imageUrl) return '<span class="fallback-art" aria-hidden="true">✳</span>';
    return `<img src="${escapeAttr(product.imageUrl)}" alt="${escapeAttr(product.name)}" loading="lazy" onerror="this.remove()">`;
  }
  function escapeAttr(value) {
    return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }
  function renderProducts() {
    const products = state.products.filter(item => state.filter === 'all' || item.category === state.filter);
    if (!products.length) {
      grid.innerHTML = '<div class="empty-products">Chưa có sản phẩm trong danh mục này.</div>';
      return;
    }
    grid.innerHTML = products.map(item => `<article class="product-card">
      <div class="product-image">${safeImage(item)}<span class="product-tag">${escapeAttr(item.tag || 'ĐƯỢC YÊU THÍCH')}</span><button class="add-button" type="button" data-add="${escapeAttr(item.id)}" aria-label="Thêm ${escapeAttr(item.name)} vào giỏ">+</button></div>
      <div class="product-meta"><div><h3 class="product-name">${escapeAttr(item.name)}</h3><p class="product-category">${escapeAttr(item.categoryName || 'Đời sống')}</p></div><span class="product-price">${money(item.price)}</span></div>
    </article>`).join('');
  }
  function renderCart() {
    const count = state.cart.reduce((total, item) => total + item.quantity, 0);
    const total = state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    document.querySelector('#cart-count').textContent = count;
    document.querySelector('#cart-total').textContent = money(total);
    document.querySelector('#checkout').disabled = count === 0;
    rows.innerHTML = state.cart.length ? state.cart.map(item => `<article class="cart-row">
      <div class="cart-thumb">${item.imageUrl ? `<img src="${escapeAttr(item.imageUrl)}" alt="" style="width:100%;height:100%;object-fit:cover">` : '✳'}</div>
      <div class="cart-info"><strong>${escapeAttr(item.name)}</strong><p>${money(item.price)}</p><div class="quantity"><button type="button" data-qty="-1" data-id="${escapeAttr(item.id)}" aria-label="Giảm số lượng">−</button><span>${item.quantity}</span><button type="button" data-qty="1" data-id="${escapeAttr(item.id)}" aria-label="Tăng số lượng">+</button></div></div>
      <div style="display:flex;flex-direction:column;align-items:end;justify-content:space-between"><span class="cart-price">${money(item.price * item.quantity)}</span><button class="remove-item" data-remove="${escapeAttr(item.id)}" type="button">Xóa</button></div>
    </article>`).join('') : '<div class="cart-empty">Giỏ hàng đang trống.<br>Hãy chọn một món bạn yêu thích nhé.</div>';
  }
  function toggleCart(open) {
    panel.classList.toggle('open', open);
    scrim.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', String(!open));
    document.body.style.overflow = open ? 'hidden' : '';
  }
  async function loadProducts() {
    try {
      const response = await apiFetch('/api/products');
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Không tải được sản phẩm');
      state.products = data.products || [];
      renderProducts();
    } catch (error) {
      grid.innerHTML = `<div class="empty-products">${escapeAttr(error.message)}. Vui lòng thử tải lại trang.</div>`;
    }
  }

  grid.addEventListener('click', event => {
    const button = event.target.closest('[data-add]');
    if (!button) return;
    const product = state.products.find(item => String(item.id) === button.dataset.add);
    if (!product) return;
    const existing = state.cart.find(item => item.id === String(product.id));
    if (existing) existing.quantity += 1;
    else state.cart.push({ id: String(product.id), name: product.name, price: Number(product.price), imageUrl: product.imageUrl || '', quantity: 1 });
    saveCart();
    showToast(`${product.name} đã được thêm vào giỏ`);
  });
  rows.addEventListener('click', event => {
    const quantity = event.target.closest('[data-qty]');
    const remove = event.target.closest('[data-remove]');
    if (quantity) {
      const item = state.cart.find(entry => entry.id === quantity.dataset.id);
      if (item) item.quantity += Number(quantity.dataset.qty);
      state.cart = state.cart.filter(entry => entry.quantity > 0);
      saveCart();
    } else if (remove) {
      state.cart = state.cart.filter(entry => entry.id !== remove.dataset.remove);
      saveCart();
    }
  });
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
    document.querySelector('.filter.active')?.classList.remove('active');
    button.classList.add('active');
    state.filter = button.dataset.filter;
    renderProducts();
  }));
  document.querySelector('#open-cart').addEventListener('click', () => toggleCart(true));
  document.querySelector('#close-cart').addEventListener('click', () => toggleCart(false));
  scrim.addEventListener('click', () => toggleCart(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') toggleCart(false); });
  document.querySelector('#checkout').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Đang tạo đơn hàng…';
    try {
      const authResponse = await apiFetch('/api/customer/me');
      if (authResponse.status === 401) {
        location.href = '/account/?next=checkout';
        return;
      }
      const response = await apiFetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: state.cart.map(({ id, quantity }) => ({ productId: id, quantity })) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Không thể tạo đơn hàng');
      localStorage.removeItem('moc-cart');
      sessionStorage.setItem('moc-current-order', JSON.stringify({ order: data.order, qrCode: data.qrCode, paymentUrl: data.paymentUrl }));
      location.href = `/shop/checkout.html?order=${encodeURIComponent(data.order.orderId)}`;
    } catch (error) {
      showToast(error.message);
      button.disabled = false;
      button.innerHTML = 'Tiến hành đặt hàng <span>→</span>';
    }
  });
  renderCart();
  loadProducts();
  if (new URLSearchParams(location.search).get('continue') === 'checkout') requestAnimationFrame(() => toggleCart(true));
})();
