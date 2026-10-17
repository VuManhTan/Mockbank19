import asyncio
import math
import sys
import os
import struct
import tempfile
import time
import uuid
import wave

import edge_tts
import pygame


# =========================================================
# CẤU HÌNH
# =========================================================

# Giọng đọc tiếng Việt
VOICE = "vi-VN-NamMinhNeural"

# Số lần thử tối đa
MAX_RETRIES = 3

# Thời gian chờ giữa các lần thử
RETRY_DELAY = 2

# Timeout cho quá trình tạo âm thanh
TTS_TIMEOUT = 30

# Tăng nhẹ tốc độ đọc để thông báo ngắn gọn hơn.
VOICE_RATE = "+15%"


# =========================================================
# TẠO FILE ÂM THANH
# =========================================================

async def generate_audio(text, output_file):

    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):

        try:

            print(
                f"[TTS] Đang tạo âm thanh "
                f"(lần thử {attempt}/{MAX_RETRIES})..."
            )

            # Nếu file cũ tồn tại thì xóa
            if os.path.exists(output_file):

                try:
                    os.remove(output_file)

                except Exception:
                    pass

            communicate = edge_tts.Communicate(
                text=text,
                voice=VOICE,
                rate=VOICE_RATE
            )

            # Có timeout để tránh treo vô hạn
            await asyncio.wait_for(
                communicate.save(output_file),
                timeout=TTS_TIMEOUT
            )

            # =================================================
            # KIỂM TRA FILE
            # =================================================

            if not os.path.exists(output_file):

                raise Exception(
                    "Edge TTS không tạo được file âm thanh."
                )

            file_size = os.path.getsize(output_file)

            if file_size <= 0:

                raise Exception(
                    "File âm thanh được tạo nhưng có kích thước 0 byte."
                )

            print(
                f"[TTS] Tạo âm thanh thành công "
                f"({file_size} bytes)."
            )

            return True

        except Exception as error:

            last_error = error

            print(
                f"[TTS] Lỗi lần {attempt}: {error}"
            )

            # Xóa file lỗi nếu có
            if os.path.exists(output_file):

                try:
                    os.remove(output_file)

                except Exception:
                    pass

            # Chưa phải lần cuối
            if attempt < MAX_RETRIES:

                print(
                    f"[TTS] Đang thử lại sau "
                    f"{RETRY_DELAY} giây..."
                )

                await asyncio.sleep(RETRY_DELAY)

    # =========================================================
    # TẤT CẢ LẦN THỬ ĐỀU THẤT BẠI
    # =========================================================

    print(
        "[TTS] Không thể tạo âm thanh."
    )

    if last_error:

        print(
            f"[TTS] Lỗi cuối cùng: {last_error}"
        )

    return False


# =========================================================
# PHÁT ÂM THANH
# =========================================================

def create_chime(file_path):

    sample_rate = 22050
    notes = [(880, 0.12), (1174, 0.17)]
    samples = []

    for frequency, duration in notes:
        count = int(sample_rate * duration)
        for index in range(count):
            progress = index / count
            envelope = min(1.0, index / (sample_rate * 0.008)) * math.exp(-3.2 * progress)
            sample = int(12000 * envelope * math.sin(2 * math.pi * frequency * index / sample_rate))
            samples.append(struct.pack("<h", sample))
        samples.extend([b"\x00\x00"] * int(sample_rate * 0.07))

    with wave.open(file_path, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(sample_rate)
        audio.writeframes(b"".join(samples))


def play_chime(file_path):

    try:
        pygame.mixer.init(frequency=22050, size=-16, channels=1)
        pygame.mixer.music.load(file_path)
        pygame.mixer.music.play()
        while pygame.mixer.music.get_busy():
            pygame.time.Clock().tick(30)
        return True
    except Exception as error:
        print(f"[TTS] Không phát được chuông báo: {error}")
        return False
    finally:
        try:
            if pygame.mixer.get_init():
                pygame.mixer.music.stop()
                pygame.mixer.quit()
        except Exception:
            pass


async def generate_audio_during_chime(text, output_file, chime_file):
    """Tạo giọng đọc trong lúc chuông đang phát để giảm thời gian chờ."""
    create_chime(chime_file)
    audio_task = asyncio.create_task(generate_audio(text, output_file))

    try:
        await asyncio.gather(
            audio_task,
            asyncio.to_thread(play_chime, chime_file)
        )
    except Exception as chime_error:
        print(f"[TTS] Bỏ qua chuông báo: {chime_error}")
        if not audio_task.done():
            return await audio_task

    return audio_task.result()

def play_audio(file_path):

    try:

        if not os.path.exists(file_path):

            print(
                "[TTS] Không tìm thấy file âm thanh."
            )

            return False

        file_size = os.path.getsize(file_path)

        if file_size <= 0:

            print(
                "[TTS] File âm thanh rỗng."
            )

            return False

        print(
            f"[TTS] Đang phát âm thanh "
            f"({file_size} bytes)..."
        )

        # Khởi tạo pygame
        pygame.mixer.init()

        # Load file
        pygame.mixer.music.load(file_path)

        # Phát
        pygame.mixer.music.play()

        # Chờ phát xong
        while pygame.mixer.music.get_busy():

            pygame.time.Clock().tick(10)

        print(
            "[TTS] Phát âm thanh thành công."
        )

        return True

    except Exception as error:

        print(
            f"[TTS] Lỗi phát âm thanh: {error}"
        )

        return False

    finally:

        try:

            if pygame.mixer.get_init():

                pygame.mixer.music.stop()
                pygame.mixer.quit()

        except Exception:
            pass


# =========================================================
# HÀM MAIN
# =========================================================

def main():

    # =======================================================
    # KIỂM TRA THAM SỐ
    # =======================================================

    if len(sys.argv) < 2:

        print(
            "[TTS] Vui lòng nhập nội dung cần đọc."
        )

        sys.exit(1)

    text = " ".join(sys.argv[1:]).strip()

    if not text:

        print(
            "[TTS] Nội dung đọc không được để trống."
        )

        sys.exit(1)

    print("")
    print("==========================================")
    print("             BANK NOTIFICATION")
    print("==========================================")
    print(f"[TTS] Nội dung: {text}")
    print("==========================================")
    print("")

    # =======================================================
    # TẠO FILE TẠM RIÊNG
    # =======================================================

    unique_id = uuid.uuid4().hex

    output_file = os.path.join(
        tempfile.gettempdir(),
        f"bank_notification_{unique_id}.mp3"
    )

    chime_file = os.path.join(
        tempfile.gettempdir(),
        f"bank_chime_{unique_id}.wav"
    )

    try:

        # ===================================================
        # TẠO GIỌNG ĐỌC SONG SONG VỚI CHUÔNG
        # ===================================================

        success = asyncio.run(
            generate_audio_during_chime(
                text,
                output_file,
                chime_file
            )
        )

        if not success:

            print(
                "[TTS] Tạo âm thanh thất bại."
            )

            # Trả mã lỗi cho Node.js
            sys.exit(2)

        # ===================================================
        # PHÁT ÂM THANH
        # ===================================================

        play_success = play_audio(
            output_file
        )

        if not play_success:

            print(
                "[TTS] Phát âm thanh thất bại."
            )

            sys.exit(3)

        print("")
        print(
            "[TTS] Hoàn thành."
        )

        sys.exit(0)

    except KeyboardInterrupt:

        print(
            "[TTS] Đã dừng bởi người dùng."
        )

        sys.exit(4)

    except Exception as error:

        print(
            f"[TTS] Lỗi không xác định: {error}"
        )

        sys.exit(5)

    finally:

        # ===================================================
        # XÓA FILE TẠM
        # ===================================================

        if os.path.exists(output_file):

            try:

                os.remove(output_file)

                print(
                    "[TTS] Đã xóa file tạm."
                )

            except Exception as error:

                print(
                    f"[TTS] Không thể xóa file tạm: {error}"
                )

        if os.path.exists(chime_file):

            try:
                os.remove(chime_file)
            except Exception as error:
                print(f"[TTS] Không thể xóa file chuông tạm: {error}")


# =========================================================
# CHẠY CHƯƠNG TRÌNH
# =========================================================

if __name__ == "__main__":

    main()
