/* ============ 한글 동물원 — 게임 로직 ============ */
/* 동물 추가는 animals.json에 { name, image } 항목을 추가하고
   이미지 파일을 images/에 넣기만 하면 됩니다. */

'use strict';

const STORAGE_KEY = 'hangulzoo-progress-v1';
const TILE_TOTAL = 10;          // 화면에 놓이는 타일 개수 (정답 + 오답)
const TILE_COLORS = 6;          // css의 .c0 ~ .c5
const MAX_ROTATE = 15;          // 타일 회전 범위 ±15°
const FALLBACK_SYLLABLES = ['나', '너', '무', '비', '소', '수', '아', '우', '자', '추', '파', '하', '미', '도', '레', '바'];

const HINT_UNTIL_CORRECT = 10;  // 이만큼 맞추기 전까지는 초성 힌트 대상
const HINT_DELAY_MS = 5000;     // 이 시간 동안 못 맞추면 첫 미완성 빈칸에 힌트 표시
const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

let animals = [];
let progress = loadProgress();  // { [이름]: { correct, wrong } }
let current = null;             // { animal, chars, filledCount }
let lastName = null;
let koVoice = null;
let currentAudio = null;
let currentUtterance = null;
let speechBusy = false;
let queuedSpeech = null;
const audioByText = new Map();
let quizMode = 'all';           // 'all': 전체 출제, 'single': 도감에서 고른 동물만 연습

/* ---------- 진행 기록 (localStorage) ---------- */

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveProgress() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    /* 사생활 보호 모드 등에서 저장 불가 시 게임은 계속 진행 */
  }
}

function statsOf(name) {
  if (!progress[name]) progress[name] = { correct: 0, wrong: 0 };
  return progress[name];
}

function learnedCount() {
  return animals.filter((a) => (progress[a.name]?.correct || 0) > 0).length;
}

function updateProgressLabels() {
  const label = `⭐ ${learnedCount()}/${animals.length}`;
  document.getElementById('title-progress').textContent = label;
  document.getElementById('collection-progress').textContent = label;
}

/* ---------- 음성 출력 (Edge TTS 오디오 + Web Speech API 폴백) ---------- */

// 여성 목소리 우선 순위 (iPad 등에서 알파벳순 첫 음성이 남성(Eddy)인 문제 대응)
const PREFERRED_FEMALE_VOICES = ['yuna', '유나', 'sora', '소라', 'sunhi', 'heami', 'google 한국', 'flo', 'sandy', 'shelley'];
const MALE_VOICE_NAMES = ['eddy', 'reed', 'rocko', 'grandpa', 'injoon', 'bongjin', 'hyunsu', 'gookmin'];

function pickKoreanVoice() {
  const voices = (window.speechSynthesis?.getVoices() || [])
    .filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('ko'));
  if (voices.length === 0) { koVoice = null; return; }

  for (const hint of PREFERRED_FEMALE_VOICES) {
    const match = voices.find((v) => v.name.toLowerCase().includes(hint));
    if (match) { koVoice = match; return; }
  }
  // 알려진 여성 음성이 없으면 남성으로 알려진 이름만 피해서 선택
  koVoice = voices.find((v) => !MALE_VOICE_NAMES.some((m) => v.name.toLowerCase().includes(m)))
    || voices[0];
}

function stemOfImagePath(imagePath) {
  return imagePath.split('/').pop().replace(/\.[^.]+$/, '');
}

function registerPrebuiltAudio(audioMap) {
  audioByText.clear();
  if (audioMap) {
    Object.entries(audioMap).forEach(([text, audioPath]) => audioByText.set(text, audioPath));
    return;
  }
  animals.forEach((animal) => {
    const stem = stemOfImagePath(animal.image);
    audioByText.set(animal.name, animal.audio || `audio/words/${stem}.mp3`);
    audioByText.set(`${animal.name}! 참 잘했어요!`, `audio/praise/${stem}.mp3`);
  });
}

async function loadPrebuiltAudioMap() {
  try {
    const res = await fetch('audio/audio-map.json');
    if (!res.ok) throw new Error(`audio map HTTP ${res.status}`);
    registerPrebuiltAudio(await res.json());
  } catch {
    registerPrebuiltAudio(null);
  }
}

function cancelSpeech() {
  queuedSpeech = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.removeAttribute('src');
    currentAudio.load();
    currentAudio = null;
  }
  currentUtterance = null;
  speechBusy = false;
  window.speechSynthesis?.cancel();
}

function finishSpeech() {
  currentAudio = null;
  currentUtterance = null;
  speechBusy = false;

  const next = queuedSpeech;
  queuedSpeech = null;
  if (next) speak(next);
}

function speakWithBrowser(text) {
  if (!('speechSynthesis' in window)) {
    finishSpeech();
    return;
  }
  const utter = new SpeechSynthesisUtterance(text);
  currentUtterance = utter;
  utter.lang = 'ko-KR';
  if (koVoice) utter.voice = koVoice;
  utter.rate = 0.85;
  utter.pitch = 1.1;
  utter.addEventListener('end', () => {
    if (currentUtterance === utter) finishSpeech();
  }, { once: true });
  utter.addEventListener('error', () => {
    if (currentUtterance === utter) finishSpeech();
  }, { once: true });
  window.speechSynthesis.speak(utter);
}

function speak(text, options = {}) {
  if (speechBusy) {
    if (options.interrupt) {
      cancelSpeech();
    } else {
      if (options.queue) queuedSpeech = text;
      return false;
    }
  }

  speechBusy = true;
  const audioPath = audioByText.get(text);
  if (!audioPath) {
    speakWithBrowser(text);
    return true;
  }

  const audio = new Audio(audioPath);
  currentAudio = audio;
  audio.addEventListener('ended', () => {
    if (currentAudio === audio) finishSpeech();
  }, { once: true });
  audio.addEventListener('error', () => {
    if (currentAudio === audio) {
      currentAudio = null;
      speakWithBrowser(text);
    }
  }, { once: true });
  audio.play().catch(() => {
    if (currentAudio === audio) {
      currentAudio = null;
      speakWithBrowser(text);
    }
  });
  return true;
}

/* ---------- 출제 ---------- */

function weightOf(animal) {
  const s = progress[animal.name];
  if (!s || s.correct === 0) return 5;          // 아직 못 맞춘 동물 우선
  if (s.wrong > s.correct) return 4;            // 많이 틀린 동물 복습
  if (s.correct < 3) return 2;
  return 1;                                     // 익숙한 동물은 가끔만
}

function pickNextAnimal() {
  let pool = animals;
  if (animals.length > 1) pool = animals.filter((a) => a.name !== lastName);
  const total = pool.reduce((sum, a) => sum + weightOf(a), 0);
  let r = Math.random() * total;
  for (const a of pool) {
    r -= weightOf(a);
    if (r <= 0) return a;
  }
  return pool[pool.length - 1];
}

/* ---------- 문제 렌더링 ---------- */

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildDistractors(answerChars, count) {
  const answerSet = new Set(answerChars);
  const pool = new Set();
  for (const a of animals) {
    if (current && a.name === current.animal.name) continue;
    for (const ch of Array.from(a.name)) {
      if (!answerSet.has(ch)) pool.add(ch);
    }
  }
  for (const ch of FALLBACK_SYLLABLES) {
    if (!answerSet.has(ch)) pool.add(ch);
  }
  return shuffle(Array.from(pool)).slice(0, count);
}

// 음절의 첫 자음(초성)을 돌려준다. 예: '병' → 'ㅂ'
function choseongOf(ch) {
  const code = ch.charCodeAt(0) - 0xAC00;
  if (code < 0 || code > 11171) return '';
  return CHOSEONG[Math.floor(code / 588)];
}

const NEXT_ARROW_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">'
  + '<path d="M13 5.6 20.4 12 13 18.4 V14.2 H3.6 v-4.4 H13 Z" fill="#fff" stroke="#fff" stroke-width="2.4" stroke-linejoin="round"/></svg>';

function applyModeUI() {
  const single = quizMode === 'single';
  document.getElementById('btn-next').classList.toggle('gone', single);
  document.getElementById('btn-exit').classList.toggle('gone', !single);
  document.getElementById('btn-next-big').innerHTML = single ? '종료' : `다음 동물 ${NEXT_ARROW_SVG}`;
}

// 3초간 못 맞추면 아직 못 맞춘 첫 빈칸 하나에만 초성 힌트를 보여 준다
let hintTimer = null;

function scheduleHint() {
  clearTimeout(hintTimer);
  if (!current) return;
  if (statsOf(current.animal.name).correct >= HINT_UNTIL_CORRECT) return;
  hintTimer = setTimeout(() => {
    const target = document.querySelector('.blank:not(.filled)');
    if (target && !target.textContent) {
      target.textContent = choseongOf(target.dataset.char);
      target.classList.add('hinted');
    }
  }, HINT_DELAY_MS);
}

// 스테이지 전환 시 드래그 잔여물(터치 고스트 등)을 확실히 정리한다
function cleanupDrag() {
  document.querySelectorAll('.tile-ghost').forEach((g) => g.remove());
  ghost = null;
  touchTile = null;
  touchStart = null;
}

function startQuestion(animal) {
  cancelSpeech();
  current = { animal, chars: Array.from(animal.name), filledCount: 0 };
  lastName = animal.name;
  applyModeUI();
  cleanupDrag();

  const img = document.getElementById('animal-img');
  img.src = animal.image;
  img.alt = animal.name;

  // 빈칸 (힌트는 scheduleHint가 3초 후에 첫 미완성 칸에만 표시)
  const blanksEl = document.getElementById('blanks');
  blanksEl.innerHTML = '';
  current.chars.forEach((ch, i) => {
    const blank = document.createElement('div');
    blank.className = 'blank';
    blank.dataset.char = ch;
    blank.dataset.index = String(i);
    blanksEl.appendChild(blank);
  });
  scheduleHint();

  // 타일: 정답 음절 + 다른 동물 이름에서 가져온 오답 음절
  const distractorCount = Math.max(3, TILE_TOTAL - current.chars.length);
  const tileChars = shuffle([...current.chars, ...buildDistractors(current.chars, distractorCount)]);

  const tray = document.getElementById('tile-tray');
  tray.innerHTML = '';
  tileChars.forEach((ch, i) => {
    const tile = document.createElement('div');
    tile.className = `tile c${i % TILE_COLORS}`;
    tile.textContent = ch;
    tile.dataset.char = ch;
    tile.id = `tile-${i}`;
    tile.draggable = true;
    const deg = (Math.random() * 2 - 1) * MAX_ROTATE;
    tile.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    attachTileEvents(tile);
    tray.appendChild(tile);
  });

  document.getElementById('praise').classList.add('hidden');

  // 글을 아직 못 읽는 아이를 위해 새 문제는 한 번 읽어 준다
  setTimeout(() => speak(animal.name), 500);
}

function nextQuestion() {
  startQuestion(pickNextAnimal());
}

/* ---------- 드래그 앤 드롭 (데스크톱: HTML5 DnD API) ---------- */

function attachTileEvents(tile) {
  // 타일 글자를 누르면 그 글자를 읽어 준다
  tile.addEventListener('click', () => speak(tile.dataset.char));

  tile.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', tile.id);
    e.dataTransfer.effectAllowed = 'move';
    tile.classList.add('dragging');
  });
  tile.addEventListener('dragend', () => tile.classList.remove('dragging'));

  // 모바일: 터치 드래그 폴백
  tile.addEventListener('touchstart', (e) => onTouchStart(e, tile), { passive: false });
}

function setupBlankDropZone() {
  const blanksEl = document.getElementById('blanks');

  blanksEl.addEventListener('dragover', (e) => {
    const blank = e.target.closest('.blank');
    if (blank && !blank.classList.contains('filled')) {
      e.preventDefault(); // 드롭 허용 (MDN Drag and Drop 가이드)
      e.dataTransfer.dropEffect = 'move';
      blank.classList.add('hover');
    }
  });

  blanksEl.addEventListener('dragleave', (e) => {
    const blank = e.target.closest('.blank');
    if (blank) blank.classList.remove('hover');
  });

  blanksEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const blank = e.target.closest('.blank');
    if (blank) blank.classList.remove('hover');
    const tile = document.getElementById(e.dataTransfer.getData('text/plain'));
    if (tile && blank) judgeDrop(tile, blank);
  });
}

/* ---------- 터치 드래그 폴백 ---------- */

let ghost = null;
let touchTile = null;
let touchStart = null;

function onTouchStart(e, tile) {
  if (tile.classList.contains('used')) return;
  e.preventDefault();
  if (touchTile) return; // 이미 드래그 중이면 두 번째 손가락은 무시 (고스트 누수 방지)

  const t = e.touches[0];
  touchTile = tile;
  touchStart = { x: t.clientX, y: t.clientY, id: t.identifier };
  ghost = tile.cloneNode(true);
  ghost.classList.add('tile-ghost');
  ghost.removeAttribute('id');
  document.body.appendChild(ghost);
  tile.classList.add('dragging');
  moveGhost(t);

  document.addEventListener('touchmove', onTouchMove, { passive: false });
  document.addEventListener('touchend', onTouchEnd);
  document.addEventListener('touchcancel', onTouchEnd);
}

function moveGhost(touch) {
  if (!ghost) return;
  ghost.style.left = `${touch.clientX}px`;
  ghost.style.top = `${touch.clientY}px`;
}

// 드래그를 시작한 그 손가락의 터치만 골라낸다
function trackedTouch(list) {
  if (!touchStart) return null;
  return Array.from(list).find((t) => t.identifier === touchStart.id) || null;
}

function onTouchMove(e) {
  e.preventDefault();
  const t = trackedTouch(e.touches);
  if (!t) return;
  moveGhost(t);
  const blank = blankUnderPoint(t);
  document.querySelectorAll('.blank.hover').forEach((b) => b.classList.remove('hover'));
  if (blank && !blank.classList.contains('filled')) blank.classList.add('hover');
}

function blankUnderPoint(touch) {
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  return el ? el.closest('.blank') : null;
}

function onTouchEnd(e) {
  const touch = trackedTouch(e.changedTouches);
  if (!touch) return; // 다른 손가락이 떨어진 것 — 드래그는 계속

  document.removeEventListener('touchmove', onTouchMove);
  document.removeEventListener('touchend', onTouchEnd);
  document.removeEventListener('touchcancel', onTouchEnd);

  const blank = blankUnderPoint(touch);
  document.querySelectorAll('.blank.hover').forEach((b) => b.classList.remove('hover'));

  if (ghost) { ghost.remove(); ghost = null; }
  if (touchTile) {
    touchTile.classList.remove('dragging');
    if (blank) {
      judgeDrop(touchTile, blank);
    } else if (touchStart
        && Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) < 12) {
      // 드래그 없이 살짝 누른 것(탭)이면 글자를 읽어 준다
      speak(touchTile.dataset.char);
    }
    touchTile = null;
    touchStart = null;
  }
}

/* ---------- 판정 ---------- */

function judgeDrop(tile, blank) {
  if (!current || blank.classList.contains('filled') || tile.classList.contains('used')) return;

  if (tile.dataset.char === blank.dataset.char) {
    // 정답: 빈칸을 타일 색으로 채우고, 타일은 제자리에 회색으로 남긴다 (레이아웃 유지)
    const colorClass = Array.from(tile.classList).find((c) => /^c\d$/.test(c)) || 'c2';
    blank.textContent = blank.dataset.char;
    blank.classList.remove('hinted');
    blank.classList.add('filled', 'pop', colorClass);
    tile.classList.add('used');
    tile.draggable = false;
    speak(blank.dataset.char);

    current.filledCount += 1;
    if (current.filledCount === current.chars.length) {
      clearTimeout(hintTimer);
      setTimeout(completeWord, 600);
    } else {
      scheduleHint(); // 다음 빈칸 기준으로 3초 타이머 재시작
    }
  } else {
    // 오답: 타일은 흔들리며 제자리로, 빈칸은 빨갛게 깜빡
    statsOf(current.animal.name).wrong += 1;
    saveProgress();
    tile.classList.add('shake');
    blank.classList.add('wrong-flash');
    setTimeout(() => {
      tile.classList.remove('shake');
      blank.classList.remove('wrong-flash');
    }, 500);
  }
}

function completeWord() {
  const name = current.animal.name;
  statsOf(name).correct += 1;
  saveProgress();
  updateProgressLabels();

  document.getElementById('praise-word').textContent = name;
  document.getElementById('praise').classList.remove('hidden');
  launchConfetti();
  // 완성된 단어를 TTS로 다시 한 번 읽어 준다
  setTimeout(() => speak(`${name}! 참 잘했어요!`, { queue: true }), 400);
}

/* ---------- 씬 전환 ---------- */

function showScene(id) {
  document.querySelectorAll('.scene').forEach((s) => s.classList.toggle('active', s.id === id));
}

function buildTitleFloats() {
  const zone = document.getElementById('title-floats');
  zone.innerHTML = '';
  const spots = [
    { left: '6%', top: '10%' }, { left: '78%', top: '8%' },
    { left: '10%', top: '72%' }, { left: '80%', top: '70%' },
    { left: '45%', top: '82%' }, { left: '55%', top: '6%' },
  ];
  shuffle([...animals]).slice(0, spots.length).forEach((a, i) => {
    const img = document.createElement('img');
    img.src = a.image;
    img.alt = '';
    img.style.left = spots[i].left;
    img.style.top = spots[i].top;
    img.style.animationDelay = `${i * 0.7}s`;
    zone.appendChild(img);
  });
}

/* ---------- 도감 ---------- */

function renderCollection() {
  const grid = document.getElementById('collection-grid');
  grid.innerHTML = '';
  animals.forEach((a) => {
    const s = progress[a.name];
    const learned = (s?.correct || 0) > 0;
    const card = document.createElement('div');
    card.className = `collection-card${learned ? '' : ' locked'}`;
    const stars = learned ? '⭐'.repeat(Math.min(s.correct, 3)) : '';
    card.innerHTML = `
      <img src="${a.image}" alt="${learned ? a.name : '아직 못 만난 동물'}">
      <span class="col-name">${learned ? a.name : '???'}</span>
      <span class="col-stars">${stars}</span>`;
    // 도감에서 동물을 누르면 그 동물만 연습하는 퀴즈 시작
    card.addEventListener('click', () => {
      quizMode = 'single';
      showScene('scene-game');
      startQuestion(a);
    });
    grid.appendChild(card);
  });
}

/* ---------- 컨페티 ---------- */

const confettiCanvas = document.getElementById('confetti');
const confettiCtx = confettiCanvas.getContext('2d');
let confettiParticles = [];
let confettiRunning = false;
const CONFETTI_COLORS = ['#FF9EAA', '#FFD166', '#7FD8BE', '#8ECAE6', '#C8A8E9', '#FFB77D'];

function resizeConfetti() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}

function launchConfetti() {
  resizeConfetti();
  for (let i = 0; i < 130; i++) {
    confettiParticles.push({
      x: Math.random() * confettiCanvas.width,
      y: -20 - Math.random() * confettiCanvas.height * 0.4,
      w: 8 + Math.random() * 8,
      h: 6 + Math.random() * 6,
      vy: 2 + Math.random() * 3.5,
      vx: -1.5 + Math.random() * 3,
      rot: Math.random() * Math.PI,
      vrot: -0.15 + Math.random() * 0.3,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    });
  }
  if (!confettiRunning) {
    confettiRunning = true;
    requestAnimationFrame(tickConfetti);
  }
}

function tickConfetti() {
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  confettiParticles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vrot;
    confettiCtx.save();
    confettiCtx.translate(p.x, p.y);
    confettiCtx.rotate(p.rot);
    confettiCtx.fillStyle = p.color;
    confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    confettiCtx.restore();
  });
  confettiParticles = confettiParticles.filter((p) => p.y < confettiCanvas.height + 30);
  if (confettiParticles.length > 0) {
    requestAnimationFrame(tickConfetti);
  } else {
    confettiRunning = false;
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }
}

/* ---------- 초기화 ---------- */

async function init() {
  try {
    const res = await fetch('animals.json');
    animals = await res.json();
    await loadPrebuiltAudioMap();
  } catch (err) {
    document.querySelector('.subtitle').textContent = '동물 데이터를 불러오지 못했어요 😢 (서버로 열어 주세요)';
    console.error('animals.json 로드 실패:', err);
    return;
  }

  updateProgressLabels();
  buildTitleFloats();
  setupBlankDropZone();

  if ('speechSynthesis' in window) {
    pickKoreanVoice();
    window.speechSynthesis.addEventListener('voiceschanged', pickKoreanVoice);
  }

  // 타이틀: 아무 곳이나 누르면 시작 (이 탭이 모바일 오디오 잠금도 해제)
  document.getElementById('scene-title').addEventListener('click', () => {
    quizMode = 'all';
    showScene('scene-game');
    nextQuestion();
  });

  document.getElementById('btn-collection').addEventListener('click', (e) => {
    e.stopPropagation();
    renderCollection();
    updateProgressLabels();
    showScene('scene-collection');
  });

  document.getElementById('btn-back').addEventListener('click', () => {
    buildTitleFloats();
    showScene('scene-title');
  });

  document.getElementById('btn-home').addEventListener('click', () => {
    cancelSpeech();
    clearTimeout(hintTimer);
    cleanupDrag();
    quizMode = 'all';
    buildTitleFloats();
    updateProgressLabels();
    showScene('scene-title');
  });

  // 동물 그림을 누르면 이름을 읽어 준다
  document.querySelector('.animal-card').addEventListener('click', () => {
    if (current) speak(current.animal.name);
  });

  const exitToCollection = () => {
    cancelSpeech();
    clearTimeout(hintTimer);
    cleanupDrag();
    quizMode = 'all';
    renderCollection();
    updateProgressLabels();
    showScene('scene-collection');
  };

  document.getElementById('btn-next').addEventListener('click', nextQuestion);
  document.getElementById('btn-exit').addEventListener('click', exitToCollection);
  document.getElementById('btn-next-big').addEventListener('click', () => {
    // 단일 연습 모드에서는 '다음' 대신 '종료' → 도감으로 복귀
    if (quizMode === 'single') exitToCollection();
    else nextQuestion();
  });

  // 설정 모달 (타이틀 오른쪽 위 톱니바퀴)
  const optionsModal = document.getElementById('options-modal');
  const openOptions = () => {
    document.getElementById('options-progress').textContent = `⭐ ${learnedCount()}/${animals.length}`;
    document.getElementById('options-main').classList.remove('gone');
    document.getElementById('options-confirm').classList.add('gone');
    optionsModal.classList.remove('hidden');
  };
  const closeOptions = () => optionsModal.classList.add('hidden');

  document.getElementById('btn-options').addEventListener('click', (e) => {
    e.stopPropagation(); // 타이틀 '아무 곳이나 눌러 시작'과 겹치지 않게
    openOptions();
  });
  document.getElementById('btn-options-close').addEventListener('click', closeOptions);
  document.getElementById('modal-backdrop').addEventListener('click', closeOptions);
  document.getElementById('btn-reset').addEventListener('click', () => {
    document.getElementById('options-main').classList.add('gone');
    document.getElementById('options-confirm').classList.remove('gone');
  });
  document.getElementById('btn-reset-no').addEventListener('click', () => {
    document.getElementById('options-confirm').classList.add('gone');
    document.getElementById('options-main').classList.remove('gone');
  });
  document.getElementById('btn-reset-yes').addEventListener('click', () => {
    // 얻은 동물 목록과 정답/오답 횟수 전체 초기화
    progress = {};
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* 무시 */ }
    updateProgressLabels();
    buildTitleFloats();
    closeOptions();
  });

  window.addEventListener('resize', resizeConfetti);
}

init();
