(() => {
  const firebaseHost = location.hostname.endsWith('.web.app') || location.hostname.endsWith('.firebaseapp.com');
  const apiBase = (window.MOCKBANK_API_BASE_URL || (firebaseHost
    ? 'https://mockbank-loathongbaochuyenkhoan-aaab1.onrender.com'
    : location.origin)).replace(/\/$/, '');

  function tokenFor(path, method) {
    if (path.startsWith('/api/bank/')) return sessionStorage.getItem('mockbank-bank-token');
    if (path.startsWith('/api/admin/')) return sessionStorage.getItem('mockbank-admin-token');
    if (path.startsWith('/api/customer/')) return sessionStorage.getItem('mockbank-customer-token');
    if (path === '/api/orders' && method === 'POST') return sessionStorage.getItem('mockbank-customer-token');
    if (path.startsWith('/api/orders/')) {
      return sessionStorage.getItem('mockbank-customer-token') || sessionStorage.getItem('mockbank-admin-token');
    }
    if (path === '/api/orders') {
      return sessionStorage.getItem('mockbank-admin-token') || sessionStorage.getItem('mockbank-customer-token');
    }
    return null;
  }

  window.apiFetch = (input, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    const requestUrl = new URL(input, location.href);
    const headers = new Headers(options.headers || {});
    const token = tokenFor(requestUrl.pathname, method);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const target = requestUrl.pathname.startsWith('/api/') ? `${apiBase}${requestUrl.pathname}${requestUrl.search}` : input;
    const requestOptions = {
      ...options,
      headers,
      credentials: 'omit'
    };
    const retryDelays = [2000, 5000, 10000, 15000, 20000, 20000];
    const retryableMethods = ['GET', 'HEAD'];
    const retryablePosts = ['/api/customer/login', '/api/admin/login', '/api/bank/login', '/api/customer/logout', '/api/admin/logout', '/api/bank/logout'];
    const mayRetry = retryableMethods.includes(method) || (method === 'POST' && retryablePosts.includes(requestUrl.pathname));
    const send = async attempt => {
      try {
        const response = await fetch(target, requestOptions);
        const contentType = response.headers.get('content-type') || '';
        const transient = response.status === 502 || response.status === 503 || response.status === 504 || (response.ok && !contentType.includes('application/json'));
        if (mayRetry && transient && attempt < retryDelays.length) {
          await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
          return send(attempt + 1);
        }
        return response;
      } catch (error) {
        if (!mayRetry || attempt >= retryDelays.length) throw error;
        await new Promise(resolve => setTimeout(resolve, retryDelays[attempt]));
        return send(attempt + 1);
      }
    };
    return send(0);
  };

  window.saveAuthToken = (role, token) => sessionStorage.setItem(`mockbank-${role}-token`, token);
  window.clearAuthToken = role => sessionStorage.removeItem(`mockbank-${role}-token`);
})();
