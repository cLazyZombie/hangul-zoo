#!/usr/bin/env python3
"""Edge TTS로 한글 동물원 음성 파일을 생성한다."""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

try:
    import edge_tts
except ImportError as exc:
    raise SystemExit(
        "edge-tts가 필요합니다. 먼저 `python3 -m pip install edge-tts`를 실행하세요."
    ) from exc


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VOICE = "ko-KR-SunHiNeural"
DEFAULT_WORD_RATE = "-8%"
DEFAULT_PRAISE_RATE = "+0%"
DEFAULT_SYLLABLE_RATE = "-12%"
DEFAULT_JAMO_RATE = "-12%"
DEFAULT_PITCH = "+0Hz"
DEFAULT_VOLUME = "+0%"
FALLBACK_SYLLABLES = ["나", "너", "무", "비", "소", "수", "아", "우", "자", "추", "파", "하", "미", "도", "레", "바"]
CONSONANT_SOUNDS = {
    "ㄱ": "기역",
    "ㄲ": "쌍기역",
    "ㄴ": "니은",
    "ㄷ": "디귿",
    "ㄸ": "쌍디귿",
    "ㄹ": "리을",
    "ㅁ": "미음",
    "ㅂ": "비읍",
    "ㅃ": "쌍비읍",
    "ㅅ": "시옷",
    "ㅆ": "쌍시옷",
    "ㅇ": "이응",
    "ㅈ": "지읒",
    "ㅉ": "쌍지읒",
    "ㅊ": "치읓",
    "ㅋ": "키읔",
    "ㅌ": "티읕",
    "ㅍ": "피읖",
    "ㅎ": "히읗",
    "ㄳ": "기역 시옷",
    "ㄵ": "니은 지읒",
    "ㄶ": "니은 히읗",
    "ㄺ": "리을 기역",
    "ㄻ": "리을 미음",
    "ㄼ": "리을 비읍",
    "ㄽ": "리을 시옷",
    "ㄾ": "리을 티읕",
    "ㄿ": "리을 피읖",
    "ㅀ": "리을 히읗",
    "ㅄ": "비읍 시옷",
}
VOWEL_SOUNDS = {
    "ㅏ": "아",
    "ㅐ": "애",
    "ㅑ": "야",
    "ㅒ": "얘",
    "ㅓ": "어",
    "ㅔ": "에",
    "ㅕ": "여",
    "ㅖ": "예",
    "ㅗ": "오",
    "ㅘ": "와",
    "ㅙ": "왜",
    "ㅚ": "외",
    "ㅛ": "요",
    "ㅜ": "우",
    "ㅝ": "워",
    "ㅞ": "웨",
    "ㅟ": "위",
    "ㅠ": "유",
    "ㅡ": "으",
    "ㅢ": "의",
    "ㅣ": "이",
}


def stem_of_image(image_path: str) -> str:
    return Path(image_path).stem


def load_animals(limit: int | None) -> list[dict[str, str]]:
    animals = json.loads((ROOT / "animals.json").read_text(encoding="utf-8"))
    return animals[:limit] if limit is not None else animals


def load_audio_map() -> dict[str, str]:
    map_path = ROOT / "audio" / "audio-map.json"
    if not map_path.exists():
        return {}
    return json.loads(map_path.read_text(encoding="utf-8"))


def syllable_path(syllable: str) -> str:
    return f"audio/syllables/{ord(syllable):04x}.mp3"


def text_path_part(text: str) -> str:
    return "_".join(f"{ord(ch):04x}" for ch in text)


def jamo_path(speech_text: str) -> str:
    return f"audio/jamo/{text_path_part(speech_text)}.mp3"


def build_syllable_items(animals: list[dict[str, str]]) -> list[dict[str, str]]:
    word_texts = {animal["name"] for animal in animals}
    syllables = sorted({ch for animal in animals for ch in animal["name"]} | set(FALLBACK_SYLLABLES))
    return [
        {
            "text": syllable,
            "path": syllable_path(syllable),
            "rate": DEFAULT_SYLLABLE_RATE,
        }
        for syllable in syllables
        if syllable not in word_texts
    ]


def build_jamo_items() -> list[dict[str, str]]:
    existing_map = load_audio_map()
    speech_texts = sorted(set(CONSONANT_SOUNDS.values()) | set(VOWEL_SOUNDS.values()))
    items = []
    for speech_text in speech_texts:
        existing_path = existing_map.get(speech_text)
        if existing_path and not existing_path.startswith("audio/jamo/") and (ROOT / existing_path).exists():
            continue
        items.append({
            "text": speech_text,
            "path": jamo_path(speech_text),
            "rate": DEFAULT_JAMO_RATE,
        })
    return items


def build_items(
    animals: list[dict[str, str]],
    include_words: bool,
    include_praise: bool,
    include_syllables: bool,
    include_jamo: bool,
) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []
    for animal in animals:
        stem = stem_of_image(animal["image"])
        if include_words:
            items.append({
                "text": animal["name"],
                "path": f"audio/words/{stem}.mp3",
                "rate": DEFAULT_WORD_RATE,
            })
        if include_praise:
            items.append({
                "text": f"{animal['name']}! 참 잘했어요!",
                "path": f"audio/praise/{stem}.mp3",
                "rate": DEFAULT_PRAISE_RATE,
            })
    if include_syllables:
        items.extend(build_syllable_items(animals))
    if include_jamo:
        items.extend(build_jamo_items())
    return items


async def synthesize_item(
    item: dict[str, str],
    voice: str,
    pitch: str,
    volume: str,
    force: bool,
    semaphore: asyncio.Semaphore,
) -> bool:
    output_path = ROOT / item["path"]
    if output_path.exists() and not force:
        return False

    output_path.parent.mkdir(parents=True, exist_ok=True)
    async with semaphore:
        for attempt in range(3):
            try:
                communicate = edge_tts.Communicate(
                    text=item["text"],
                    voice=voice,
                    rate=item["rate"],
                    volume=volume,
                    pitch=pitch,
                )
                await communicate.save(str(output_path))
                print(f"{item['text']} -> {item['path']}")
                return True
            except Exception:
                if attempt == 2:
                    raise
                await asyncio.sleep(1 + attempt)
    return False


def write_audio_map(items: list[dict[str, str]], preserve_existing: bool) -> None:
    map_path = ROOT / "audio" / "audio-map.json"
    audio_map: dict[str, str] = {}
    if preserve_existing and map_path.exists():
        audio_map.update(json.loads(map_path.read_text(encoding="utf-8")))
    for item in items:
        if (ROOT / item["path"]).exists():
            audio_map.setdefault(item["text"], item["path"])
    map_path.parent.mkdir(parents=True, exist_ok=True)
    map_path.write_text(
        json.dumps(audio_map, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


async def generate(args: argparse.Namespace) -> None:
    animals = load_animals(args.limit)
    items = build_items(
        animals,
        include_words=not args.only_syllables and not args.only_jamo,
        include_praise=not args.no_praise and not args.only_syllables and not args.only_jamo,
        include_syllables=not args.no_syllables and not args.only_jamo,
        include_jamo=args.only_jamo or (not args.no_jamo and not args.only_syllables),
    )
    semaphore = asyncio.Semaphore(args.concurrency)
    tasks = [
        synthesize_item(
            item,
            voice=args.voice,
            pitch=args.pitch,
            volume=args.volume,
            force=args.force,
            semaphore=semaphore,
        )
        for item in items
    ]
    results = await asyncio.gather(*tasks)
    write_audio_map(items, preserve_existing=args.only_syllables or args.only_jamo)
    print(f"generated {sum(results)} files, mapped {len(items)} texts")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, help="앞에서부터 일부 동물만 생성")
    parser.add_argument("--no-praise", action="store_true", help="동물명만 생성")
    parser.add_argument("--no-syllables", action="store_true", help="글자 타일용 음절 MP3는 생성하지 않음")
    parser.add_argument("--no-jamo", action="store_true", help="자모 조각용 발음 MP3는 생성하지 않음")
    parser.add_argument("--only-syllables", action="store_true", help="글자 타일용 음절 MP3만 생성")
    parser.add_argument("--only-jamo", action="store_true", help="자모 조각용 발음 MP3만 생성")
    parser.add_argument("--force", action="store_true", help="이미 있는 MP3도 다시 생성")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help="Edge TTS voice short name")
    parser.add_argument("--pitch", default=DEFAULT_PITCH, help="예: +0Hz, +20Hz, -10Hz")
    parser.add_argument("--volume", default=DEFAULT_VOLUME, help="예: +0%%, -10%%")
    parser.add_argument("--concurrency", type=int, default=3, help="동시 생성 요청 수")
    args = parser.parse_args()
    asyncio.run(generate(args))


if __name__ == "__main__":
    main()
