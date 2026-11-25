import os
import tempfile
import threading
import time
import speech_recognition as sr
import pygame

from dotenv import load_dotenv
from openai import OpenAI
from gtts import gTTS
from datetime import datetime
from ui_bridge import UIBridge

# =====================================
# 1. KHOI TAO
# =====================================

load_dotenv()

api_key = os.getenv("OPENAI_API_KEY")

if not api_key:
    raise ValueError("Khong tim thay OPENAI_API_KEY trong file .env")

client = OpenAI(api_key=api_key)

pygame.mixer.init()

recognizer = sr.Recognizer()

recognizer.pause_threshold = 0.8
recognizer.dynamic_energy_threshold = True

# Luu lich su hoi thoai
conversation_history = []
mic_enabled = threading.Event()
mic_enabled.set()
bridge = None


def set_state(state, message=None):
    if bridge:
        bridge.emit("state", state=state, message=message)


def handle_ui_command(command):
    if command.get("type") == "ui_ready":
        set_state("listening" if mic_enabled.is_set() else "idle")
        return
    if command.get("type") != "mic_toggle":
        return
    if mic_enabled.is_set():
        mic_enabled.clear()
        set_state("idle", "Đã tạm dừng microphone")
        print("[UI] Microphone tạm dừng", flush=True)
    else:
        mic_enabled.set()
        set_state("listening", "Tôi đang lắng nghe...")
        print("[UI] Microphone được bật", flush=True)

SYSTEM_PROMPT = """
Bạn là trợ lý AI thông minh trên Raspberry Pi.
Bạn giao tiếp bằng tiếng Việt tự nhiên.
Trả lời lịch sự, chân thành, và ngắn gọn,
vì câu trả lời sẽ được phát qua loa.
THÔNG TIN THỜI GIAN:
- Thời gian hiện tại được cung cấp trong câu hỏi của người dùng.
- Khi được hỏi ngày, giờ hoặc thứ, phải sử dụng thông tin này.
- Không tự đoán ngày giờ.

"""

# =====================================
# 2. NHAN DIEN GIONG NOI
# =====================================

def listen():

    if not mic_enabled.is_set():
        return None

    set_state("listening")

    try:
        with sr.Microphone() as source:
            print("\n🎤 Đang lắng nghe...")
            audio = recognizer.listen(
                source,
                timeout=5,
                phrase_time_limit=10
            )

            # A stop request may arrive while SpeechRecognition is recording.
            if not mic_enabled.is_set():
                return None

            text = recognizer.recognize_google(
                audio,
                language="vi-VN"
            )

            print("Bạn:", text)
            if bridge:
                bridge.emit("transcript", text=text)

            return text

    except sr.WaitTimeoutError:
        print("Không phát hiện giọng nói.")
        return None

    except sr.UnknownValueError:
        print("Không hiểu nội dung.")
        return None

    except sr.RequestError as e:
        print("Lỗi kết nối Google:", e)
        if bridge:
            bridge.emit("error", message="Không kết nối được dịch vụ nhận diện giọng nói.")
        set_state("error", "Lỗi nhận diện giọng nói")
        return None
    except Exception as e:
        print("Lỗi microphone:", e)
        if bridge:
            bridge.emit("error", message="Không thể mở microphone. Hãy kiểm tra thiết bị âm thanh.")
        set_state("error", "Lỗi microphone")
        return None


# =====================================
# 3. CHATBOT OPENAI
# =====================================

def ask_ai(question):

    global conversation_history

    # Lay thoi gian thuc tu Raspberry Pi
    now = datetime.now()

    weekday_vi = {
        0: "Thứ Hai",
        1: "Thứ Ba",
        2: "Thứ Tư",
        3: "Thứ Năm",
        4: "Thứ Sáu",
        5: "Thứ Bảy",
        6: "Chủ Nhật"
    }

    current_time = now.strftime("%H:%M:%S")
    current_date = now.strftime("%d/%m/%Y")
    current_weekday = weekday_vi[now.weekday()]

    time_context = f"""
THÔNG TIN THỜI GIAN HIỆN TẠI:
- Ngày: {current_date}
- Thứ: {current_weekday}
- Giờ: {current_time}
- Múi giờ: Việt Nam (UTC+7).

Nếu người dùng hỏi về ngày giờ, hãy sử dụng chính xác
thông tin thời gian trên. Không tự suy đoán.
"""

    conversation_history.append({
        "role": "user",
        "content": question
    })

    try:

        response = client.responses.create(
            model="gpt-4.1-mini",

            instructions=SYSTEM_PROMPT + "\n" + time_context,

            input=conversation_history,

            max_output_tokens=500
        )

        answer = response.output_text

        conversation_history.append({
            "role": "assistant",
            "content": answer
        })

        # Giu lich su trong gioi han
        conversation_history = conversation_history[-10:]

        return answer

    except Exception as e:

        print("OpenAI API Error:", e)
        if bridge:
            bridge.emit("error", message="Không kết nối được trợ lý AI. Vui lòng thử lại.")
        set_state("error", "Lỗi kết nối trợ lý AI")

        conversation_history.pop()

        return "Xin lỗi, hiện tại tôi chưa thể xử lý câu hỏi."

# =====================================
# 4. CHUYEN VAN BAN THANH GIONG NOI
# =====================================

def speak(text):

    print("\n🤖 Chatbot:", text)

    filename = None
    playback_started = False
    set_state("thinking", "Đang chuẩn bị giọng nói...")

    try:

        tts = gTTS(
            text=text,
            lang="vi"
        )

        with tempfile.NamedTemporaryFile(
            suffix=".mp3",
            delete=False
        ) as temp:

            filename = temp.name

        tts.save(filename)

        pygame.mixer.music.load(filename)
        pygame.mixer.music.play()
        playback_started = True
        if bridge:
            bridge.emit("tts_started")
        set_state("speaking")

        while pygame.mixer.music.get_busy():
            pygame.time.Clock().tick(10)

    except Exception as e:

        print("Lỗi phát âm thanh:", e)
        if bridge:
            bridge.emit("error", message="Không phát được âm thanh. Hãy kiểm tra loa.")
        set_state("error", "Lỗi phát âm thanh")

    finally:

        try:
            pygame.mixer.music.stop()
            pygame.mixer.music.unload()
        except pygame.error:
            pass

        if filename and os.path.exists(filename):
            os.remove(filename)

        if bridge and playback_started:
            bridge.emit("tts_finished")
        set_state("listening" if mic_enabled.is_set() else "idle")


# =====================================
# 5. CHUONG TRINH CHINH
# =====================================

def main():

    global bridge

    bridge = UIBridge(on_command=handle_ui_command)
    bridge.start()
    time.sleep(0.15)

    print("=" * 40)
    print("       SMART HOME AI CHATBOT")
    print("=" * 40)

    speak("Xin chào! Tôi là trợ lý AI của bạn.")

    with sr.Microphone() as source:

        print("Đang hiệu chỉnh microphone...")
        recognizer.adjust_for_ambient_noise(
            source,
            duration=1
        )

    while True:

        if not mic_enabled.is_set():
            time.sleep(0.1)
            continue

        question = listen()

        if not question:
            if mic_enabled.is_set():
                set_state("idle")
            continue

        if question.lower().strip() in [
            "thoát",
            "dừng lại",
            "tạm biệt"
        ]:

            speak("Tạm biệt bạn!")
            break

        set_state("thinking")
        answer = ask_ai(question)

        if bridge:
            bridge.emit("answer", text=answer)
        set_state("happy", "Đã có câu trả lời cho bạn!")
        time.sleep(0.45)

        speak(answer)


if __name__ == "__main__":

    try:
        main()

    except KeyboardInterrupt:
        print("\nĐang tắt chatbot...")

    finally:
        pygame.mixer.quit()
