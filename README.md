# 🦁 한글 동물원 (Hangul Zoo)

4세 아이들이 동물 이름으로 한글을 배우는 웹 게임입니다.
동물 그림을 보고, 흩어진 글자 타일을 드래그해서 이름을 완성하면 음성으로 읽어 줍니다.

**▶ 플레이: https://clazyzombie.github.io/hangul-zoo/**

## 놀이 방법

1. 타이틀 화면 아무 곳이나 누르면 게임이 시작됩니다.
2. 동물 그림 아래 빈칸에, 하단의 글자 타일을 드래그해서 넣습니다.
   - 5초간 못 맞추면 아직 못 맞춘 첫 글자의 초성 힌트가 나타납니다 (병아리에서 "병"을 맞췄다면 다음 힌트는 ㅇ). 그 동물을 10번 맞춘 뒤에는 힌트가 나오지 않습니다.
3. 맞는 글자만 들어가고, 틀린 글자는 흔들리며 제자리로 돌아갑니다.
4. 이름을 완성하면 축하 화면과 함께 단어를 음성으로 읽어 줍니다.
5. 동물 그림을 누르면 이름을 다시 읽어 주고, 글자 타일을 누르면 그 글자를 읽어 줍니다.
6. ➡️ 버튼으로 다음 동물로 넘어갑니다.
7. 📖 도감에서 지금까지 맞춘 동물을 모아 볼 수 있고, 동물을 누르면 그 동물만 연습하는 퀴즈가 시작됩니다 (완료 후 "종료"로 도감 복귀).

## 기술

- 순수 HTML/CSS/JavaScript — 빌드 도구 없음
- [HTML Drag and Drop API](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API) (데스크톱) + 터치 이벤트 폴백 (모바일)
- Edge TTS로 미리 생성한 한국어 MP3 — 동물 이름, 글자 타일, 칭찬 문구 재생
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) — MP3가 없을 때 한국어 TTS 폴백
- `localStorage` — 동물별 맞춤/틀림 기록 저장 (틀린 동물을 더 자주 출제)

## 동물 추가하기

데이터만 수정하면 됩니다. 코드 변경 불필요.

1. 동물 그림을 `images/`에 넣습니다 (흰 배경, 정사각형 권장, 512px).
2. `animals.json`에 항목을 추가합니다:

```json
{ "name": "판다", "image": "images/panda.png" }
```

## 로컬 실행

`fetch()`를 사용하므로 HTTP 서버로 열어야 합니다:

```bash
python3 -m http.server 8000
# http://localhost:8000 접속
```

## 음성 다시 만들기

Edge TTS의 한국어 여성 음성(`ko-KR-SunHiNeural`)으로 `audio/`의 MP3를 다시 생성할 수 있습니다. 동물 이름, 글자 타일용 음절, 칭찬 문구가 함께 생성됩니다. 실행 시 인터넷 연결과 `edge-tts` 패키지가 필요합니다.

```bash
python3 -m pip install edge-tts
python3 tools/generate_edge_tts_audio.py --force
```

## 이미지 출처

동물 그림은 모두 AI 생성 이미지입니다 (OpenAI 이미지 생성 모델 · Codex CLI 사용).
사람이 그린 원작이 아니며, 특정 작가의 저작물을 포함하지 않습니다.

## 라이선스

코드는 MIT 라이선스로 자유롭게 사용할 수 있습니다.
