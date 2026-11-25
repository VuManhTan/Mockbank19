(() => {
  const root = document.querySelector('#checkout-root');
  const money = value => `${Number(value).toLocaleString('vi-VN')} ₫`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const read = key => { try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; } };
  const draft = read('moc-checkout-draft');
  let savedOrder = read('moc-checkout-order');
  let poll;
  let submitting = false;

  function validDraft(value) { return value && /^0[1-4]$/.test(value.tableId || '') && Array.isArray(value.items) && value.items.length > 0; }
  function summary(items) {
    const rows = (items || []).map(item => `<div class="checkout-line"><span>${escape(item.name)} × ${Number(item.quantity)}${item.note ? `<small>Ghi chú: ${escape(item.note)}</small>` : ''}</span><strong>${money(Number(item.subtotal ?? Number(item.unitPrice ?? item.price) * Number(item.quantity)))}</strong></div>`).join('');
    const total = (items || []).reduce((sum, item) => sum + Number(item.subtotal ?? Number(item.unitPrice ?? item.price) * Number(item.quantity)), 0);
    return { rows, total };
  }
  function renderChoice() {
    if (!validDraft(draft)) { root.innerHTML = '<div class="error-state">Không tìm thấy giỏ hàng hoặc bàn đã chọn. <a href="/shop/">Quay lại cửa hàng</a> để bắt đầu đơn mới.</div>'; return; }
    const { rows, total } = summary(draft.items);
    root.innerHTML = `<div class="checkout-top"><div><p class="eyebrow">KIỂM TRA LẠI TRƯỚC KHI GỬI</p><h1>Đơn hàng của bạn</h1></div><span class="state-pill">BÀN ${escape(draft.tableId)}</span></div>
      <section class="checkout-card"><div class="checkout-info"><p class="checkout-sub">Bàn <strong>${escape(draft.tableId)}</strong> · ${draft.items.length} món trong đơn</p><div class="checkout-list">${rows}<div class="checkout-line checkout-total"><span>Tổng cộng</span><strong>${money(total)}</strong></div></div></div>
      <div class="payment-options"><button class="payment-option" data-method="QR" type="button"><span class="option-icon">▦</span><strong>Thanh toán bằng QR</strong><span>Mã QR riêng cho đơn hàng này. Đơn chỉ được xác nhận sau khi giao dịch Mock Bank báo thành công.</span></button><button class="payment-option" data-method="CASH" type="button"><span class="option-icon">₫</span><strong>Thanh toán tiền mặt</strong><span>Thanh toán cho nhân viên. Nhân viên sẽ xác nhận sau khi nhận đủ tiền.</span></button></div></section>
      <p class="notice">Giá được máy chủ tính lại từ thực đơn. Nhấn một phương thức để ghi nhận đơn.</p>`;
    root.querySelectorAll('[data-method]').forEach(button => button.addEventListener('click', () => createOrder(button.dataset.method, button)));
  }
  async function createOrder(method, button) {
    if (submitting || !validDraft(draft)) return;
    submitting = true; button.disabled = true; button.querySelector('strong').textContent = 'Đang ghi nhận đơn…';
    const requestId = sessionStorage.getItem('moc-order-request-id') || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`);
    sessionStorage.setItem('moc-order-request-id', requestId);
    try {
      const response = await apiFetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': requestId }, body: JSON.stringify({ tableId: draft.tableId, paymentMethod: method, items: draft.items.map(({ id, quantity, note }) => ({ productId: id, quantity, note })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Không thể ghi nhận đơn hàng');
      savedOrder = { order: data.order, orderAccessToken: data.orderAccessToken, qrCode: data.qrCode, paymentUrl: data.paymentUrl, paymentMethod: data.order.paymentMethod || method };
      sessionStorage.setItem('moc-checkout-order', JSON.stringify(savedOrder));
      localStorage.removeItem('moc-cart');
      sessionStorage.removeItem('moc-checkout-draft');
      sessionStorage.removeItem('moc-order-request-id');
      renderOrder(data.order, method, data.qrCode, data.paymentUrl);
      startPolling();
    } catch (error) {
      const notice = root.querySelector('.notice');
      if (notice) notice.textContent = `${error.message}. Bạn có thể thử lại; yêu cầu sẽ không tạo đơn trùng.`;
      button.disabled = false; button.querySelector('strong').textContent = method === 'QR' ? 'Thanh toán bằng QR' : 'Thanh toán tiền mặt';
    } finally { submitting = false; }
  }
  function renderOrder(order, method, qrCode, paymentUrl) {
    const { rows } = summary(order.items);
    const paid = order.paymentStatus === 'PAID' || order.status === 'PAID';
    const cash = method === 'CASH' || order.paymentMethod === 'CASH';
    const status = paid ? (cash ? 'ĐÃ NHẬN TIỀN MẶT' : 'ĐÃ THANH TOÁN') : 'CHỜ THANH TOÁN';
    const recipientInfo = order.recipientAccountId ? `<div class="recipient-details"><div><span>Ngân hàng</span><strong>${escape(order.recipientBankName || 'MockBank')}</strong></div><div><span>Số tài khoản</span><strong>${escape(order.recipientAccountNumber)}</strong></div><div><span>Chủ tài khoản</span><strong>${escape(order.recipientName)}</strong></div></div>` : '';
    const payment = paid ? `<div class="staff-notice cash-confirm">${cash ? 'Đơn hàng đã được nhân viên xác nhận thanh toán tiền mặt.' : 'Giao dịch đã được MockBank xác nhận.'}</div>` : cash ? '<div class="staff-notice">Vui lòng thanh toán tiền mặt cho nhân viên tại quầy. Đơn hàng sẽ được xác nhận sau khi nhân viên nhận đủ tiền.</div>' : `<div class="checkout-qr">${recipientInfo}${qrCode ? `<img src="${escape(qrCode)}" alt="Mã QR thanh toán đơn ${escape(order.orderId)}">` : '<p>Không tải được mã QR. Vui lòng thử tải lại trang.</p>'}<p>Quét mã để mở MockBank, đăng nhập và xác nhận giao dịch.<br><strong>Số tiền: ${money(order.amount)}</strong><br>Nội dung: <span class="order-code">Thanh toan ${escape(order.orderId)}</span></p>${paymentUrl ? `<a class="pay-link" href="${escape(paymentUrl)}" target="_blank" rel="noopener noreferrer">Mở MockBank để thanh toán</a>` : ''}<p class="notice">Trạng thái cập nhật sau khi backend xác minh tài khoản nhận, số tiền và webhook.</p></div>`;
    root.innerHTML = `<div class="checkout-top"><div><p class="eyebrow">CẢM ƠN BẠN ĐÃ ĐẶT MÓN</p><h1>Đơn hàng đã ghi nhận</h1></div><span class="state-pill ${paid ? 'paid' : ''}" id="payment-status">${status}</span></div><section class="checkout-card"><div class="checkout-info"><p class="checkout-sub">Mã đơn hàng: <strong class="order-code">${escape(order.orderId)}</strong> · Bàn <strong>${escape(order.tableId || draft?.tableId || '')}</strong></p><div class="checkout-list">${rows}<div class="checkout-line checkout-total"><span>Tổng tiền</span><strong>${money(order.amount)}</strong></div></div><p class="notice">Cảm ơn bạn đã đặt món! Đơn hàng của bạn đã được ghi nhận.</p></div>${payment}</section><p class="notice">Bạn có thể quay lại trang này để xem trạng thái đơn hàng.</p>`;
  }
  async function refreshOrder() {
    if (!savedOrder?.order?.orderId) return;
    try {
      const response = await apiFetch(`/api/orders/${encodeURIComponent(savedOrder.order.orderId)}`, { headers: { 'X-Order-Access-Token': savedOrder.orderAccessToken || '' } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Không tải được trạng thái đơn hàng');
      savedOrder.order = data.order; sessionStorage.setItem('moc-checkout-order', JSON.stringify(savedOrder));
      renderOrder(data.order, savedOrder.paymentMethod || data.order.paymentMethod, savedOrder.qrCode, savedOrder.paymentUrl);
      if (data.order.paymentStatus === 'PAID' || data.order.status === 'PAID') clearInterval(poll);
    } catch (error) { if (!root.querySelector('.error-state')) { const note = root.querySelector('.notice'); if (note) note.textContent = `${error.message}. Tải lại trang để thử lại.`; } }
  }
  function startPolling() { clearInterval(poll); poll = setInterval(refreshOrder, 4000); }
  if (savedOrder?.order?.orderId) { renderOrder(savedOrder.order, savedOrder.paymentMethod || savedOrder.order.paymentMethod, savedOrder.qrCode, savedOrder.paymentUrl); refreshOrder(); startPolling(); }
  else renderChoice();
})();
