# 음성 파일

`audio/words/`, `audio/syllables/`, `audio/jamo/`, `audio/praise/`의 MP3 파일은 Edge TTS 한국어 음성으로 생성한 사전 녹음 음성입니다.

- 음성: `ko-KR-SunHiNeural`
- 생성 도구: `edge-tts`
- 용도: 개인 학습용 정적 웹 앱
- 재생 방식: 앱은 동물 이름, 글자/자모 타일, 칭찬 문구 모두 MP3를 먼저 재생하고, 파일이 없거나 재생에 실패하면 브라우저 Web Speech API를 사용합니다.

다시 생성하려면 저장소 루트에서 실행합니다.

```bash
python3 -m pip install edge-tts
python3 tools/generate_edge_tts_audio.py --force
```
