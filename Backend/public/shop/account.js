(() => {
  const root = document.querySelector('#account-root');
  const params = new URLSearchParams(location.search);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = value => `${Number(value).toLocaleString('vi-VN')} ₫`;
  let mode = params.get('view') === 'register' ? 'register' : 'login';

  function destination() {
    if (params.get('next') === 'checkout') return '/shop/?continue=checkout';
    if (params.get('next') === 'order') {
      const orderId = params.get('order') || '';
      return /^(?:[A-Z]{2}\d{4}|DH[A-F0-9]{12}|DH\d{6}[A-F0-9]{16})$/i.test(orderId) ? `/shop/checkout.html?order=${encodeURIComponent(orderId)}` : '/shop/';
    }
    return '/shop/';
  }
  async function request(url, options = {}) {
    const response = await apiFetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Yêu cầu thất bại.');
    return data;
  }
  function renderGuest(message = '') {
    const registering = mode === 'register';
    root.innerHTML = `<p class="eyebrow">TÀI KHOẢN MỘC</p><h1>${registering ? 'Tạo tài khoản' : 'Chào mừng trở lại.'}</h1><p class="account-sub">${registering ? 'Đăng ký để theo dõi đơn hàng và xem lại các lần mua sắm.' : 'Đăng nhập để xem đơn hàng và tiếp tục mua sắm.'}</p>
      <form id="account-form" class="account-form">${registering ? '<label>Họ và tên<input name="name" autocomplete="name" minlength="2" maxlength="100" required></label>' : ''}<label>Email<input name="email" type="email" autocomplete="email" required maxlength="254"></label><label>Mật khẩu<input name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" minlength="${registering ? 10 : 1}" maxlength="128" required></label><button class="account-submit" type="submit">${registering ? 'TẠO TÀI KHOẢN' : 'ĐĂNG NHẬP'}</button><p class="account-error" id="account-error" role="alert">${escape(message)}</p></form>
      <p class="account-switch">${registering ? 'Đã có tài khoản?' : 'Bạn chưa có tài khoản?'} <button id="switch-mode" type="button">${registering ? 'Đăng nhập' : 'Tạo tài khoản'}</button></p>`;
    document.querySelector('#switch-mode').addEventListener('click', () => { mode = registering ? 'login' : 'register'; renderGuest(); });
    document.querySelector('#account-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = form.querySelector('button[type="submit"]');
      const fields = Object.fromEntries(new FormData(form));
      submit.disabled = true;
      try {
        const auth = await request(registering ? '/api/customer/register' : '/api/customer/login', { method: 'POST', body: JSON.stringify(fields) });
        saveAuthToken('customer', auth.token);
        location.href = destination();
      } catch (error) {
        document.querySelector('#account-error').textContent = error.message;
        submit.disabled = false;
      }
    });
  }
  function renderCustomer(customer, orders) {
    root.innerHTML = `<div class="profile-row"><div><p class="eyebrow">TÀI KHOẢN CỦA BẠN</p><h1>Xin chào, ${escape(customer.name)}</h1><p class="account-sub">${escape(customer.email)}</p></div><button class="logout-button" id="logout">ĐĂNG XUẤT</button></div><h2 class="order-title">Đơn hàng của tôi</h2><div>${orders.length ? orders.map(order => `<article class="customer-order"><div><strong>${escape(order.orderId)} · ${order.status === 'PAID' ? 'Đã thanh toán' : 'Chờ thanh toán'}</strong><p>${(order.items || []).map(item => `${escape(item.name)} × ${Number(item.quantity)}`).join(' · ')}</p><p>${new Date(order.createdAt).toLocaleString('vi-VN')} · ${money(order.amount)}</p></div><a href="/shop/checkout.html?order=${encodeURIComponent(order.orderId)}">Xem đơn hàng →</a></article>`).join('') : '<p class="account-empty">Bạn chưa có đơn hàng nào. Hãy khám phá cửa hàng nhé.</p>'}</div>`;
    document.querySelector('#logout').addEventListener('click', async () => { try { await request('/api/customer/logout', { method: 'POST' }); clearAuthToken('customer'); location.href = '/shop/'; } catch (error) { alert(error.message); } });
  }
  async function load() {
    if (!sessionStorage.getItem('mockbank-customer-token')) { renderGuest(); return; }
    try {
      const me = await request('/api/customer/me');
      const data = await request('/api/customer/orders');
      renderCustomer(me.customer, data.orders || []);
    } catch (error) {
      if (error.message === 'Failed to fetch') renderGuest('Không kết nối được máy chủ.');
      else renderGuest();
    }
  }
  load();
})();
