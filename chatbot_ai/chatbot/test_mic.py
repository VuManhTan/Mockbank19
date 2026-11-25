import speech_recognition as sr

recognizer = sr.Recognizer()

recognizer.energy_threshold = 300
recognizer.dynamic_energy_threshold = True

print("=== MICROPHONE TEST ===")

try:
    with sr.Microphone() as source:

        print("Dang hieu chinh microphone...")
        recognizer.adjust_for_ambient_noise(source, duration=2)

        print("Hay noi gi do...")
        audio = recognizer.listen(
            source,
            timeout=10,
            phrase_time_limit=5
        )

    print("Dang nhan dien...")

    text = recognizer.recognize_google(
        audio,
        language="vi-VN"
    )

    print("Ban vua noi:", text)
    print("MIC OK!")

except sr.WaitTimeoutError:
    print("Khong phat hien am thanh!")

except sr.UnknownValueError:
    print("Khong nhan dien duoc giong noi!")

except Exception as e:
    print("MIC ERROR:", e)