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
DEFAULT_PITCH = "+0Hz"
DEFAULT_VOLUME = "+0%"
FALLBACK_SYLLABLES = ["나", "너", "무", "비", "소", "수", "아", "우", "자", "추", "파", "하", "미", "도", "레", "바"]


def stem_of_image(image_path: str) -> str:
    return Path(image_path).stem


def load_animals(limit: int | None) -> list[dict[str, str]]:
    animals = json.loads((ROOT / "animals.json").read_text(encoding="utf-8"))
    return animals[:limit] if limit is not None else animals


def syllable_path(syllable: str) -> str:
    return f"audio/syllables/{ord(syllable):04x}.mp3"


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


def build_items(
    animals: list[dict[str, str]],
    include_words: bool,
    include_praise: bool,
    include_syllables: bool,
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
        include_words=not args.only_syllables,
        include_praise=not args.no_praise and not args.only_syllables,
        include_syllables=not args.no_syllables,
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
    write_audio_map(items, preserve_existing=args.only_syllables)
    print(f"generated {sum(results)} files, mapped {len(items)} texts")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, help="앞에서부터 일부 동물만 생성")
    parser.add_argument("--no-praise", action="store_true", help="동물명만 생성")
    parser.add_argument("--no-syllables", action="store_true", help="글자 타일용 음절 MP3는 생성하지 않음")
    parser.add_argument("--only-syllables", action="store_true", help="글자 타일용 음절 MP3만 생성")
    parser.add_argument("--force", action="store_true", help="이미 있는 MP3도 다시 생성")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help="Edge TTS voice short name")
    parser.add_argument("--pitch", default=DEFAULT_PITCH, help="예: +0Hz, +20Hz, -10Hz")
    parser.add_argument("--volume", default=DEFAULT_VOLUME, help="예: +0%%, -10%%")
    parser.add_argument("--concurrency", type=int, default=3, help="동시 생성 요청 수")
    args = parser.parse_args()
    asyncio.run(generate(args))


if __name__ == "__main__":
    main()
