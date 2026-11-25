from gtts import gTTS
import pygame
import time

print("=== SPEAKER TEST ===")

try:
    # Tạo giọng nói tiếng Việt
    tts = gTTS(
        text="Xin chào! Đây là bài kiểm tra loa Raspberry Pi.",
        lang="vi"
    )

    tts.save("/tmp/test_speaker.mp3")

    # Khởi tạo âm thanh
    pygame.mixer.init()

    # Phát âm thanh
    pygame.mixer.music.load("/tmp/test_speaker.mp3")
    pygame.mixer.music.play()

    print("Đang phát âm thanh...")

    while pygame.mixer.music.get_busy():
        time.sleep(0.1)

    print("SPEAKER OK!")

except Exception as e:
    print("SPEAKER ERROR:", e)

finally:
    pygame.mixer.quit()