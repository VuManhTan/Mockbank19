(() => {
  const root = document.querySelector('#checkout-root');
  const orderId = new URLSearchParams(location.search).get('order');
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem('moc-current-order') || 'null'); } catch { return null; } })();
  const money = value => `${Number(value).toLocaleString('vi-VN')} ₫`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let poll;

  async function refresh() {
    try {
      const response = await apiFetch(`/api/orders/${encodeURIComponent(orderId)}`);
      const data = await response.json();
      if (response.status === 401) {
        location.href = `/account/?next=order&order=${encodeURIComponent(orderId)}`;
        return;
      }
      if (!response.ok) throw new Error(data.message || 'Không tìm thấy đơn hàng');
      render(data.order);
      if (data.order.status === 'PAID') clearInterval(poll);
    } catch (error) {
      root.innerHTML = `<div class="error-state">${escape(error.message)}. Hãy quay lại cửa hàng để tạo đơn mới.</div>`;
      clearInterval(poll);
    }
  }
  function render(order) {
    const paid = order.status === 'PAID';
    const items = (order.items || []).map(item => `<div class="checkout-line"><span>${escape(item.name)} × ${Number(item.quantity)}</span><strong>${money(item.subtotal)}</strong></div>`).join('');
    const qrCode = saved?.order?.orderId === order.orderId ? saved.qrCode : '';
    const paymentUrl = saved?.order?.orderId === order.orderId ? saved.paymentUrl : '';
        root.innerHTML = `<div class="checkout-top"><div><p class="eyebrow">CẢM ƠN BẠN ĐÃ LỰA CHỌN MỘC</p><h1 style="font:600 30px var(--serif);margin:0">${paid ? 'Đơn hàng đã thanh toán' : 'Hoàn tất đơn hàng'}</h1></div><span class="state-pill ${paid ? 'paid' : ''}" id="order-status">${paid ? 'ĐÃ THANH TOÁN' : 'CHỜ THANH TOÁN'}</span></div>
      <section class="checkout-card"><div class="checkout-info"><p class="eyebrow">MÃ ĐƠN HÀNG</p><div class="order-code">${escape(order.orderId)}</div><p class="checkout-sub">${paid ? 'Thanh toán đã được xác nhận. Cảm ơn bạn!' : 'Quét mã bằng Mock Bank hoặc mở trang thanh toán. Nội dung thanh toán đã gắn với mã đơn này.'}</p><div class="checkout-list">${items}<div class="checkout-line checkout-total"><span>Tổng cộng</span><strong>${money(order.amount)}</strong></div></div><p class="notice">Trạng thái đơn hàng được tự động cập nhật sau khi Mock Bank xác nhận giao dịch.</p></div>
      <div class="checkout-qr">${paid ? '<div style="font-size:42px;color:#526d5a">✓</div>' : qrCode ? `<img src="${qrCode}" alt="QR thanh toán đơn ${escape(order.orderId)}">` : '<div style="font:48px var(--serif);color:#899889">✳</div>'}<p>${paid ? 'Thanh toán thành công' : `Số tiền: <strong>${money(order.amount)}</strong><br>Nội dung: <span class="order-code">Thanh toan ${escape(order.orderId)}</span>`}</p>${!paid && paymentUrl ? `<a class="pay-link" href="${escape(paymentUrl)}" target="_blank" rel="noopener noreferrer">Chuyển đến Mock Bank xác nhận →</a>` : ''}</div></section>`;
  }
  if (!orderId) { root.innerHTML = '<div class="error-state">Thiếu mã đơn hàng.</div>'; return; }
  refresh();
  poll = setInterval(refresh, 3000);
})();
