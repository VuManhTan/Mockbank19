(() => {
  const socketUrl = "ws://127.0.0.1:8765";
  const messages = document.getElementById("messages");
  const connection = document.getElementById("connection");
  const micButton = document.getElementById("micButton");
  const micLabel = document.getElementById("micLabel");
  const stateText = document.getElementById("stateText");
  const hintText = document.getElementById("hintText");
  const shell = document.querySelector(".shell");
  const labels = {
    idle: ["Đang chờ bạn", "Chạm micro để trò chuyện"],
    listening: ["Tôi đang lắng nghe...", "Hãy nói điều bạn cần nhé"],
    thinking: ["Để tôi suy nghĩ nhé...", "Đang chuẩn bị câu trả lời"],
    speaking: ["Tôi đang trả lời...", "Mình đang nói với bạn"],
    happy: ["Tuyệt quá!", "Mọi thứ đã sẵn sàng"],
    error: ["Có lỗi kết nối", "Kiểm tra microphone hoặc kết nối mạng"]
  };
  let socket;
  let reconnectDelay = 500;
  let reconnectTimer = null;
  let listening = false;

  function setState(state, message) {
    const safe = labels[state] ? state : "idle";
    shell.className = `shell state-${safe}`;
    stateText.textContent = message || labels[safe][0];
    hintText.textContent = labels[safe][1];
    listening = safe === "listening";
    micLabel.textContent = listening ? "DỪNG NGHE" : "BẮT ĐẦU";
    micButton.setAttribute("aria-label", listening ? "Dừng lắng nghe" : "Bắt đầu lắng nghe");
  }

  function addMessage(kind, text) {
    if (!text) return;
    const item = document.createElement("article");
    item.className = `message ${kind}`;
    if (kind === "bot") {
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = "✦";
      item.append(avatar);
    }
    const body = document.createElement("p");
    body.textContent = text;
    item.append(body);
    messages.append(item);
    while (messages.children.length > 12) messages.firstElementChild.remove();
    messages.scrollTop = messages.scrollHeight;
  }

  function connect() {
    socket = new WebSocket(socketUrl);
    socket.onopen = () => {
      reconnectDelay = 500;
      connection.classList.remove("offline");
      connection.lastElementChild.textContent = "Đã kết nối";
      socket.send(JSON.stringify({ type: "ui_ready" }));
    };
    socket.onmessage = event => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.type === "state") setState(data.state, data.message);
      if (data.type === "transcript") addMessage("user", data.text);
      if (data.type === "answer") addMessage("bot", data.text);
      if (data.type === "error") {
        addMessage("bot", data.message || "Đã xảy ra lỗi. Vui lòng thử lại.");
        setState("error", data.message || labels.error[0]);
      }
    };
    socket.onclose = socket.onerror = () => {
      connection.classList.add("offline");
      connection.lastElementChild.textContent = "Mất kết nối";
      if (reconnectTimer === null) {
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, reconnectDelay);
      }
      reconnectDelay = Math.min(reconnectDelay * 1.7, 8000);
    };
  }

  micButton.addEventListener("click", () => {
    if (socket?.readyState !== WebSocket.OPEN) {
      setState("error", "Chưa kết nối được với chatbot");
      return;
    }
    socket.send(JSON.stringify({ type: "mic_toggle" }));
  });
  document.getElementById("clearButton").addEventListener("click", () => { messages.replaceChildren(); });
  connect();
})();
