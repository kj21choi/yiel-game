/* =====================================================================
   Coming Home — 주사위 보드게임
   외부 라이브러리 없이 순수 JavaScript 로 구현.

   구조
   ├─ CONFIG        : 보드/플레이어/특수칸 등 모든 튜닝값 (여기만 바꾸면 됨)
   ├─ ITEM_DEFS     : 아이템 메타데이터 (데이터 주도)
   ├─ util          : 공용 헬퍼 (rand, clamp, displayNo ...)
   ├─ Item 시스템   : applyItemEffect(player, key)
   ├─ Player 클래스 : 플레이어 상태
   ├─ Board 클래스  : 칸 메타데이터 + 구불구불한 길 좌표/렌더링
   └─ Game 클래스   : 상태 머신 (턴 흐름 / 특수칸 처리 / 렌더 / 로그)
===================================================================== */

'use strict';

/* =====================================================================
   1. CONFIG — 모든 설정을 한 곳에 모음
      칸 번호 표기: 화면 1~50, 내부 인덱스 0~49.
      특수칸 좌표는 "표시 번호(1~50)" 기준으로 적고 헬퍼로 인덱스 변환.
===================================================================== */
const CONFIG = {
  BOARD_SIZE: 50,            // 보드 칸 수 (index 0 = 시작, BOARD_SIZE-1 = Goal)
  MAX_PLAYERS: 4,
  MIN_PLAYERS: 1,
  MAX_ITEMS: 3,              // 플레이어 최대 보유 아이템 수
  DICE_MIN: 1,
  DICE_MAX: 6,

  // 애니메이션 타이밍(ms)
  STEP_MS: 220,              // 한 칸 이동 시간
  DICE_ROLL_MS: 700,         // 주사위 굴림 애니메이션 시간

  // 캐릭터 4종 — 원본 그림(characters.png)을 crop 한 스프라이트 PNG 사용.
  // color/accent 는 플레이어 카드 테두리 등 UI 강조색으로만 활용.
  CHARACTERS: [
    { id: 'jelly',   name: '젤리',   img: 'img/char-jelly.png',   color: '#c9a77f', accent: '#7a5a3a' },
    { id: 'ppoongi', name: '뽀송이', img: 'img/char-ppoongi.png', color: '#e8d9c0', accent: '#b9a888' },
    { id: 'kongi',   name: '콩이',   img: 'img/char-kongi.png',   color: '#3a3a3a', accent: '#5a5145' },
    { id: 'teddy',   name: '테디',   img: 'img/char-teddy.png',   color: '#a8703f', accent: '#5e3a1e' },
  ],

  // 특수칸 — 모두 "표시 번호(1~50)" 기준. 시작(1)과 Goal(50)은 제외.
  // 한 번호가 여러 타입에 중복되지 않도록 주의해서 배치.
  TRAP_TILES:  [6, 13, 24, 33, 40, 47],
  BONUS_TILES: [4, 11, 20, 27, 37, 44],
  ITEM_TILES:  [3, 9, 15, 26, 35, 46],
  WARP_TILES:  { 8: 22, 17: 5, 31: 45, 42: 28 },   // 요구사항 예시 그대로

  // 특수칸 발동 시 무작위로 고르는 효과 풀
  TRAP_EFFECTS:  ['back3', 'skipTurn', 'loseItem'],
  BONUS_EFFECTS: ['forward3', 'rollAgain', 'gainItem'],

  // 함정/보너스 보정 칸 수
  BACK_STEPS: 3,
  FORWARD_STEPS: 3,
  BOOST_BONUS: 3,            // Boost 아이템: 다음 이동 +3
};

/* =====================================================================
   2. ITEM_DEFS — 아이템 메타데이터 테이블 (데이터 주도)
      key / name(한글) / icon / desc / autoUse
===================================================================== */
const ITEM_DEFS = {
  shield: {
    key: 'shield', name: '방패', icon: '🛡️',
    desc: '함정 효과를 1회 자동으로 막아줘요.',
    autoUse: true,           // 함정 발동 시 자동 사용 (수동 버튼 없음)
  },
  boost: {
    key: 'boost', name: '부스트', icon: '🚀',
    desc: '다음 이동 거리에 +3.',
    autoUse: false,
  },
  diceControl: {
    key: 'diceControl', name: '주사위 조작', icon: '🎯',
    desc: '다음 턴에 주사위 값을 1~6 중 직접 선택.',
    autoUse: false,
  },
  swap: {
    key: 'swap', name: '위치 교환', icon: '🔄',
    desc: '다른 플레이어 1명과 위치를 맞바꿔요.',
    autoUse: false,
  },
  doubleMove: {
    key: 'doubleMove', name: '더블 무브', icon: '✨',
    desc: '다음 이동 거리를 2배로!',
    autoUse: false,
  },
};
const ITEM_KEYS = Object.keys(ITEM_DEFS);

/* =====================================================================
   3. util — 공용 헬퍼
===================================================================== */
const util = {
  /** [min, max] 정수 난수 (양끝 포함) */
  randInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
  /** 배열에서 무작위 1개 */
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  /** value 를 [lo, hi] 범위로 제한 */
  clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
  /** 내부 인덱스(0~49) → 화면 표시 번호(1~50) */
  displayNo: (index) => index + 1,
  /** 화면 표시 번호(1~50) → 내부 인덱스(0~49) */
  toIndex: (no) => no - 1,
  /** 짧은 대기 (애니메이션 동기화용 Promise) */
  delay: (ms) => new Promise((res) => setTimeout(res, ms)),
  /** 캐릭터 스프라이트 <img> 마크업 (className 으로 크기 지정) */
  charImg: (ch, className) =>
    `<img class="${className}" src="${ch.img}" alt="${ch.name}" draggable="false" />`,
};

/* =====================================================================
   4. Item 시스템 — 수동 사용 가능한 아이템의 효과 적용 단일 진입점
      (autoUse 아이템인 shield 는 여기서 다루지 않고 함정 핸들러에서 처리)
      반환: 로그에 남길 메시지 문자열
===================================================================== */
function applyItemEffect(game, player, key) {
  const def = ITEM_DEFS[key];
  switch (key) {
    case 'boost':
      player.pending.boost = true;
      return `${player.name} 이(가) ${def.icon}부스트 사용 — 다음 이동 +${CONFIG.BOOST_BONUS}!`;

    case 'doubleMove':
      player.pending.doubleMove = true;
      return `${player.name} 이(가) ${def.icon}더블 무브 사용 — 다음 이동 2배!`;

    case 'diceControl':
      player.pending.diceControl = true;
      return `${player.name} 이(가) ${def.icon}주사위 조작 사용 — 이번 굴리기에서 값을 선택!`;

    case 'swap': {
      // 자기 외 플레이어 중 (아직 도착 안 한) 가장 앞선 상대와 교환
      const others = game.players.filter((p) => p !== player && !p.finished);
      if (others.length === 0) return null;          // 사용 불가 → 호출부에서 막음
      const target = others.reduce((a, b) => (b.position > a.position ? b : a));
      const tmp = player.position;
      player.position = target.position;
      target.position = tmp;
      return `${player.name} 이(가) ${def.icon}위치 교환 — ${target.name} 와(과) 자리를 맞바꿨어요! ` +
             `(${util.displayNo(target.position)}번 ↔ ${util.displayNo(player.position)}번)`;
    }

    default:
      return null;
  }
}

/* =====================================================================
   5. Player 클래스
===================================================================== */
class Player {
  constructor(id, name, character) {
    this.id = id;
    this.name = name;
    this.character = character;     // CONFIG.CHARACTERS 원소
    this.position = 0;              // 내부 인덱스 (0 = 시작칸)
    this.items = [];                // 보유 아이템 key 배열 (최대 MAX_ITEMS)
    this.skipNextTurn = false;      // 다음 턴 1회 쉬기
    this.finished = false;          // Goal 도착 여부
    // 다음 이동/턴에 적용될 보류 효과
    this.pending = { boost: false, doubleMove: false, diceControl: false, rollAgain: false };
  }

  /** 아이템 추가. 한도 초과 시 false 반환 */
  addItem(key) {
    if (this.items.length >= CONFIG.MAX_ITEMS) return false;
    this.items.push(key);
    return true;
  }

  hasItem(key) {
    return this.items.includes(key);
  }

  /** 특정 아이템 1개 제거 */
  removeItem(key) {
    const i = this.items.indexOf(key);
    if (i >= 0) this.items.splice(i, 1);
  }

  /** 무작위 아이템 1개 제거. 제거한 key 반환(없으면 null) */
  removeRandomItem() {
    if (this.items.length === 0) return null;
    const i = util.randInt(0, this.items.length - 1);
    return this.items.splice(i, 1)[0];
  }
}

/* =====================================================================
   6. Board 클래스 — 칸 메타데이터 + 구불구불한 길 좌표/렌더링
      tilePoints[]: 각 칸의 {x, y} (SVG viewBox 좌표). 칸 DOM·말 배치·
      이동 애니메이션이 모두 이 배열을 재사용 → 좌표 계산 로직 1곳.
===================================================================== */
class Board {
  constructor() {
    this.size = CONFIG.BOARD_SIZE;
    this.tiles = this.buildTiles();   // 칸 메타데이터
    this.tilePoints = [];             // 칸별 좌표 (renderPath 후 채워짐)
  }

  /** 각 칸의 타입 메타데이터 생성 */
  buildTiles() {
    const tiles = [];
    const trapSet = new Set(CONFIG.TRAP_TILES.map(util.toIndex));
    const bonusSet = new Set(CONFIG.BONUS_TILES.map(util.toIndex));
    const itemSet = new Set(CONFIG.ITEM_TILES.map(util.toIndex));
    const warpMap = {};
    for (const [from, to] of Object.entries(CONFIG.WARP_TILES)) {
      warpMap[util.toIndex(Number(from))] = util.toIndex(Number(to));
    }

    for (let i = 0; i < this.size; i++) {
      let type = 'normal';
      let warpTo;
      if (i === 0) type = 'start';
      else if (i === this.size - 1) type = 'goal';
      else if (i in warpMap) { type = 'warp'; warpTo = warpMap[i]; }
      else if (trapSet.has(i)) type = 'trap';
      else if (bonusSet.has(i)) type = 'bonus';
      else if (itemSet.has(i)) type = 'item';
      tiles.push({ index: i, type, warpTo });
    }
    return tiles;
  }

  /**
   * 구불구불한 길 SVG path 를 그리고, 경로를 따라 50개 칸 좌표를 균등 샘플링.
   * 칸 DOM(타일 라벨/아이콘)과 워프 화살표도 함께 렌더.
   */
  render(svg) {
    const VB_W = 1200, VB_H = 840;
    svg.innerHTML = '';
    const NS = 'http://www.w3.org/2000/svg';

    // --- 뱀 모양(serpentine) 길 생성 : 가로 직선 행 + 끝에서 둥근 U턴 ---
    // 위쪽 여백(marginTop)을 크게 줘 출발 돗자리 장식이 viewBox 밖으로 잘리지 않게 함.
    const rows = 5;                       // 가로 행 개수
    const marginX = 150;                  // 행 좌우 끝 위치
    const marginTop = 185;                // 위 여백 (출발 돗자리 장식 공간)
    const marginBottom = 95;              // 아래 여백 (오두막 라벨 공간)
    const left = marginX, right = VB_W - marginX;
    const rowH = (VB_H - marginTop - marginBottom) / (rows - 1);
    const yAt = (r) => marginTop + rowH * r;

    let d = `M ${left} ${yAt(0)}`;
    for (let r = 0; r < rows; r++) {
      const y = yAt(r);
      const goingRight = r % 2 === 0;     // 짝수 행은 →, 홀수 행은 ←
      const endX = goingRight ? right : left;
      d += ` L ${endX} ${y}`;            // 가로 직선
      if (r < rows - 1) {                // 행 끝에서 다음 행으로 둥글게 U턴
        const ny = yAt(r + 1);
        const dir = goingRight ? 1 : -1;
        const bulge = rowH * 0.78;       // 바깥쪽으로 부푸는 정도 (U턴 곡률)
        d += ` C ${endX + dir * bulge} ${y}, ${endX + dir * bulge} ${ny}, ${endX} ${ny}`;
      }
    }

    // 길 외곽선(굵게) + 안쪽(밝게) 2겹
    const pathOuter = document.createElementNS(NS, 'path');
    pathOuter.setAttribute('d', d);
    pathOuter.setAttribute('class', 'trail-outer');
    svg.appendChild(pathOuter);
    const pathInner = document.createElementNS(NS, 'path');
    pathInner.setAttribute('d', d);
    pathInner.setAttribute('class', 'trail-inner');
    svg.appendChild(pathInner);

    // --- 경로를 따라 칸 좌표 균등 샘플링 ---
    const total = pathOuter.getTotalLength();
    this.tilePoints = [];
    for (let i = 0; i < this.size; i++) {
      const t = this.size === 1 ? 0 : i / (this.size - 1);
      const pt = pathOuter.getPointAtLength(total * t);
      this.tilePoints.push({ x: pt.x, y: pt.y });
    }

    // --- 워프 화살표 (출발칸 → 도착칸) ---
    // 마커 정의
    const defs = document.createElementNS(NS, 'defs');
    defs.innerHTML =
      '<marker id="warp-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" ' +
      'orient="auto" markerUnits="strokeWidth">' +
      '<path d="M0,0 L7,3 L0,6 Z" fill="#8b5cf6"/></marker>';
    svg.appendChild(defs);
    this.tiles.forEach((tile) => {
      if (tile.type !== 'warp') return;
      const a = this.tilePoints[tile.index];
      const b = this.tilePoints[tile.warpTo];
      const arrow = document.createElementNS(NS, 'path');
      // 살짝 곡선진 화살표
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2 - 70;     // 위로 볼록하게
      arrow.setAttribute('d', `M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`);
      arrow.setAttribute('class', 'warp-arrow');
      arrow.setAttribute('marker-end', 'url(#warp-arrow)');
      svg.appendChild(arrow);
    });

    // --- 칸 DOM (원형 타일 + 번호/아이콘) ---
    this.tiles.forEach((tile) => {
      const p = this.tilePoints[tile.index];
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', `tile tile-${tile.type}`);
      g.setAttribute('transform', `translate(${p.x}, ${p.y})`);

      const r = (tile.type === 'start' || tile.type === 'goal') ? 34 : 26;
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('r', r);
      circle.setAttribute('class', 'tile-circle');
      g.appendChild(circle);

      // 아이콘 또는 번호
      const label = document.createElementNS(NS, 'text');
      label.setAttribute('class', 'tile-label');
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dy', '0.35em');
      label.textContent = Board.TILE_ICON[tile.type] || util.displayNo(tile.index);
      g.appendChild(label);

      // 시작/Goal 은 추가 장식 (돗자리 / 오두막)
      if (tile.type === 'start') g.appendChild(Board.makeDecoStart(NS));
      if (tile.type === 'goal')  g.appendChild(Board.makeDecoGoal(NS));

      svg.appendChild(g);
    });
  }

  /** 시작칸 장식: 피크닉 돗자리 (체크 담요 + 바구니 + 음식) */
  static makeDecoStart(NS) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'deco deco-start');
    // 캐릭터 말(piece)이 타일 위 ~70 SVG 단위까지 올라오므로 그보다 높게 배치
    g.setAttribute('transform', 'translate(0,-155)');
    g.innerHTML =
      // 위에서 본 마름모꼴 체크 담요 (빨강/흰색 격자)
      '<g>' +
        '<polygon points="0,8 72,40 0,72 -72,40" fill="#e85550" stroke="#fff" stroke-width="2.5"/>' +
        '<g stroke="#fff" stroke-width="2.2" opacity="0.92">' +
          '<line x1="-48" y1="48" x2="24" y2="16"/>' +
          '<line x1="-24" y1="60" x2="48" y2="28"/>' +
          '<line x1="-48" y1="32" x2="24" y2="64"/>' +
          '<line x1="-24" y1="20" x2="48" y2="52"/>' +
        '</g>' +
        '<g stroke="#ffd9d6" stroke-width="1" opacity="0.7">' +
          '<line x1="-60" y1="40" x2="12" y2="8"/>' +
          '<line x1="-12" y1="68" x2="60" y2="36"/>' +
        '</g>' +
      '</g>' +
      // 피크닉 바구니 (담요 위 좌측)
      '<g transform="translate(-30,30)">' +
        '<path d="M-15 0 Q0 -10 15 0 L12 16 Q0 20 -12 16 Z" fill="#c98a4b" stroke="#8a5a2a" stroke-width="2"/>' +
        '<path d="M-15 0 Q0 8 15 0" fill="none" stroke="#8a5a2a" stroke-width="2"/>' +
        '<path d="M-12 -2 Q0 -22 12 -2" fill="none" stroke="#8a5a2a" stroke-width="2.5"/>' +
        '<line x1="-8" y1="2" x2="-7" y2="16" stroke="#8a5a2a" stroke-width="1"/>' +
        '<line x1="0" y1="3" x2="0" y2="18" stroke="#8a5a2a" stroke-width="1"/>' +
        '<line x1="8" y1="2" x2="7" y2="16" stroke="#8a5a2a" stroke-width="1"/>' +
      '</g>' +
      // 음식: 쿠키 + 사과
      '<circle cx="26" cy="40" r="7" fill="#ffd86b" stroke="#e0a93a" stroke-width="1.5"/>' +
      '<circle cx="40" cy="46" r="6" fill="#e8607a" stroke="#c23a55" stroke-width="1.5"/>' +
      '<rect x="34" y="40" width="2" height="3" fill="#5e3a1e"/>' +
      // 라벨: 타일 아래쪽(+40)에 표시 — 그룹 Y=-155 이므로 dy=195 → tile_y+40
      '<text text-anchor="middle" dy="195" class="deco-text"></text>';
    return g;
  }

  /** Goal칸 장식: 굴뚝 연기 나는 통나무 오두막집 (크고 상세하게) */
  static makeDecoGoal(NS) {
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('class', 'deco deco-goal');
    g.setAttribute('transform', 'translate(0,-170)');
    g.innerHTML =
      // 바닥 그림자
      '<ellipse cx="0" cy="58" rx="64" ry="14" fill="#000" opacity="0.12"/>' +
      // 굴뚝 + 연기 (지붕 뒤)
      '<rect x="22" y="-50" width="14" height="30" rx="2" fill="#7a4a2a" stroke="#4a2c16" stroke-width="2"/>' +
      '<rect x="20" y="-52" width="18" height="6" rx="2" fill="#5e3a1e"/>' +
      '<circle class="smoke smoke1" cx="29" cy="-54" r="6" fill="#d8d8d8"/>' +
      '<circle class="smoke smoke2" cx="29" cy="-54" r="6" fill="#d8d8d8"/>' +
      '<circle class="smoke smoke3" cx="29" cy="-54" r="6" fill="#d8d8d8"/>' +
      // 박공 지붕 (나뭇결 판자)
      '<polygon points="0,-58 56,-12 -56,-12" fill="#8a4f2a" stroke="#4a2c16" stroke-width="3" stroke-linejoin="round"/>' +
      '<g stroke="#6e3c1f" stroke-width="2" opacity="0.85">' +
        '<line x1="-40" y1="-12" x2="-12" y2="-46"/>' +
        '<line x1="-20" y1="-12" x2="2" y2="-39"/>' +
        '<line x1="0" y1="-12" x2="18" y2="-34"/>' +
        '<line x1="20" y1="-12" x2="34" y2="-29"/>' +
        '<line x1="40" y1="-12" x2="48" y2="-22"/>' +
      '</g>' +
      '<polygon points="0,-58 56,-12 -56,-12" fill="none" stroke="#a86838" stroke-width="2" opacity="0.5"/>' +
      // 지붕 처마
      '<rect x="-58" y="-14" width="116" height="7" rx="3" fill="#6e3c1f"/>' +
      // 통나무 벽 (가로 통나무 결)
      '<rect x="-48" y="-7" width="96" height="62" rx="4" fill="#c08a4e" stroke="#5e3a1e" stroke-width="3"/>' +
      '<g stroke="#9a6736" stroke-width="2.4" opacity="0.8">' +
        '<line x1="-46" y1="5" x2="46" y2="5"/>' +
        '<line x1="-46" y1="17" x2="46" y2="17"/>' +
        '<line x1="-46" y1="29" x2="46" y2="29"/>' +
        '<line x1="-46" y1="41" x2="46" y2="41"/>' +
      '</g>' +
      // 통나무 끝단(좌우 모서리 원형 단면)
      '<g fill="#b07a44" stroke="#5e3a1e" stroke-width="1.5">' +
        '<circle cx="-48" cy="5" r="4"/><circle cx="-48" cy="17" r="4"/>' +
        '<circle cx="-48" cy="29" r="4"/><circle cx="-48" cy="41" r="4"/>' +
        '<circle cx="48" cy="5" r="4"/><circle cx="48" cy="17" r="4"/>' +
        '<circle cx="48" cy="29" r="4"/><circle cx="48" cy="41" r="4"/>' +
      '</g>' +
      // 창문 (격자 + 따뜻한 불빛)
      '<rect x="-38" y="6" width="22" height="22" rx="2" fill="#ffe08a" stroke="#5e3a1e" stroke-width="2.5"/>' +
      '<line x1="-27" y1="6" x2="-27" y2="28" stroke="#5e3a1e" stroke-width="2"/>' +
      '<line x1="-38" y1="17" x2="-16" y2="17" stroke="#5e3a1e" stroke-width="2"/>' +
      // 문 (아치형 나무문 + 손잡이)
      '<path d="M8 55 V20 Q22 8 36 20 V55 Z" fill="#7a4a26" stroke="#4a2c16" stroke-width="2.5"/>' +
      '<line x1="22" y1="14" x2="22" y2="55" stroke="#5e3a1e" stroke-width="1.5" opacity="0.7"/>' +
      '<circle cx="31" cy="38" r="2.6" fill="#ffd86b"/>' +
      '<text text-anchor="middle" dy="185" class="deco-text"></text>';
    return g;
  }
}

// 특수칸 타입별 아이콘
Board.TILE_ICON = {
  start: '👒',
  goal: '🏠',
  trap: '🕳️',
  bonus: '⭐',
  warp: '🌀',
  item: '🎁',
};

/* =====================================================================
   7. Game 클래스 — 상태 머신
      상태 변경은 명확한 함수 단위로 분리, 변경 후 render() 로 UI 동기화.
===================================================================== */
class Game {
  constructor() {
    this.board = new Board();
    this.players = [];
    this.current = 0;          // 현재 턴 플레이어 인덱스
    this.busy = false;         // 애니메이션/처리 중 입력 잠금
    this.over = false;
    this.logs = [];

    this.dom = {
      setup: document.getElementById('setup-screen'),
      game: document.getElementById('game-screen'),
      countPicker: document.getElementById('count-picker'),
      nameInputs: document.getElementById('name-inputs'),
      startBtn: document.getElementById('start-btn'),
      board: document.getElementById('board'),
      svg: document.getElementById('board-svg'),
      pieces: document.getElementById('pieces'),
      dice: document.getElementById('dice'),
      diceChooser: document.getElementById('dice-chooser'),
      rollBtn: document.getElementById('roll-btn'),
      restartBtn: document.getElementById('restart-btn'),
      currentTurn: document.getElementById('current-turn'),
      playersPanel: document.getElementById('players-panel'),
      statusBanner: document.getElementById('status-banner'),
      winOverlay: document.getElementById('win-overlay'),
      winMessage: document.getElementById('win-message'),
      confetti: document.getElementById('confetti'),
      playAgainBtn: document.getElementById('play-again-btn'),
    };

    this.playerCount = 2;      // 기본 2명
    this.initSetupUI();
    this.bindEvents();
  }

  /* ---------- 설정 화면 ---------- */
  initSetupUI() {
    this.selectCount(2);
  }

  selectCount(n) {
    this.playerCount = util.clamp(n, CONFIG.MIN_PLAYERS, CONFIG.MAX_PLAYERS);
    // 버튼 활성 표시
    [...this.dom.countPicker.children].forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.count) === this.playerCount);
    });
    // 이름 입력칸 렌더 (캐릭터 자동 배정 미리보기 포함)
    this.dom.nameInputs.innerHTML = '';
    for (let i = 0; i < this.playerCount; i++) {
      const ch = CONFIG.CHARACTERS[i];
      const row = document.createElement('div');
      row.className = 'name-row';
      row.innerHTML =
        util.charImg(ch, 'char-thumb') +
        `<input type="text" class="name-input" maxlength="8" ` +
        `value="${ch.name}" data-index="${i}" aria-label="플레이어 ${i + 1} 이름" />`;
      this.dom.nameInputs.appendChild(row);
    }
  }

  bindEvents() {
    this.dom.countPicker.addEventListener('click', (e) => {
      const btn = e.target.closest('.count-btn');
      if (btn) this.selectCount(Number(btn.dataset.count));
    });
    this.dom.startBtn.addEventListener('click', () => this.start());
    this.dom.rollBtn.addEventListener('click', () => this.onRollClick());
    this.dom.restartBtn.addEventListener('click', () => this.restart());
    this.dom.playAgainBtn.addEventListener('click', () => this.restart());
  }

  /* ---------- 게임 시작 ---------- */
  start() {
    // 플레이어 생성
    this.players = [];
    const inputs = [...this.dom.nameInputs.querySelectorAll('.name-input')];
    for (let i = 0; i < this.playerCount; i++) {
      const ch = CONFIG.CHARACTERS[i];
      const name = (inputs[i].value || '').trim() || ch.name;
      this.players.push(new Player(i, name, ch));
    }
    this.current = 0;
    this.over = false;
    this.busy = false;
    this.logs = [];

    // 화면 전환 + 보드 렌더
    this.dom.setup.classList.add('hidden');
    this.dom.game.classList.remove('hidden');
    this.dom.winOverlay.classList.add('hidden');
    this.board.render(this.dom.svg);
    this.buildPieces();
    this.renderPieces();
    this.setDiceFace(1);
    this.log('게임 시작! 무사히 집으로 돌아가세요 🏠');
    this.startTurn();
  }

  get currentPlayer() {
    return this.players[this.current];
  }

  /* ---------- 턴 흐름 ---------- */

  /** 턴 시작: 쉬기 처리 / 아이템 사용 활성화 / 현재 턴 표시 */
  startTurn() {
    if (this.over) return;
    const p = this.currentPlayer;

    // 다음 턴 쉬기 처리
    if (p.skipNextTurn) {
      p.skipNextTurn = false;
      this.log(`${p.name} 은(는) 이번 턴을 쉽니다. 😴`);
      this.render();
      // 잠깐 보여주고 다음 플레이어로
      this.busy = true;
      setTimeout(() => { this.busy = false; this.nextPlayer(); }, 900);
      return;
    }

    this.busy = false;
    this.render();
  }

  /** 주사위 굴리기 버튼 클릭 */
  onRollClick() {
    if (this.over || this.busy) return;
    const p = this.currentPlayer;
    // 주사위 조작 보류 효과가 있으면 값 선택 UI 표시
    if (p.pending.diceControl) {
      this.showDiceChooser();
      return;
    }
    const value = util.randInt(CONFIG.DICE_MIN, CONFIG.DICE_MAX);
    this.rollDice(value);
  }

  /** 주사위 조작: 1~6 선택 버튼 표시 */
  showDiceChooser() {
    const box = this.dom.diceChooser;
    box.innerHTML = '<span class="chooser-label">원하는 값 선택:</span>';
    for (let v = CONFIG.DICE_MIN; v <= CONFIG.DICE_MAX; v++) {
      const b = document.createElement('button');
      b.className = 'chooser-btn';
      b.textContent = v;
      b.addEventListener('click', () => {
        const p = this.currentPlayer;
        p.pending.diceControl = false;
        p.removeItem('diceControl');     // 이미 사용 시작했던 아이템 소비 완료
        box.classList.add('hidden');
        box.innerHTML = '';
        this.rollDice(v);
      });
      box.appendChild(b);
    }
    box.classList.remove('hidden');
    this.dom.rollBtn.disabled = true;
  }

  /** 주사위 굴림 애니메이션 후 이동 */
  async rollDice(value) {
    if (this.busy) return;
    this.busy = true;
    this.dom.rollBtn.disabled = true;

    // 굴림 애니메이션: 잠깐 랜덤 숫자를 빠르게 바꿈
    this.dom.dice.classList.add('rolling');
    const spinEnd = Date.now() + CONFIG.DICE_ROLL_MS;
    while (Date.now() < spinEnd) {
      this.setDiceFace(util.randInt(1, 6));
      await util.delay(80);
    }
    this.dom.dice.classList.remove('rolling');
    this.setDiceFace(value);

    const p = this.currentPlayer;
    this.log(`🎲 ${p.name} 주사위: ${value}`);
    await this.moveBy(p, value);
  }

  /** 주사위 눈(점) 그리기 */
  setDiceFace(n) {
    const pip = '<span class="pip"></span>';
    this.dom.dice.dataset.face = n;
    this.dom.dice.innerHTML = pip.repeat(n);
  }

  /**
   * steps 칸 이동 (boost/doubleMove 보정 포함).
   * 보정 순서: (기본 + BOOST) 후 ×2 (doubleMove).
   */
  async moveBy(player, steps) {
    let total = steps;
    const notes = [];
    if (player.pending.boost) {
      total += CONFIG.BOOST_BONUS;
      player.pending.boost = false;
      player.removeItem('boost');
      notes.push(`부스트 +${CONFIG.BOOST_BONUS}`);
    }
    if (player.pending.doubleMove) {
      total *= 2;
      player.pending.doubleMove = false;
      player.removeItem('doubleMove');
      notes.push('더블 무브 ×2');
    }
    if (notes.length) this.log(`➡️ 보정 적용 (${notes.join(', ')}) → ${total}칸 이동`);

    await this.animateSteps(player, total);

    // Goal 도착/통과 → 즉시 승리
    if (player.position >= this.board.size - 1) {
      player.position = this.board.size - 1;
      this.renderPieces();
      player.finished = true;
      return this.win(player);
    }

    await this.resolveTile(player);
  }

  /** 칸 단위로 한 칸씩 걸어가는 애니메이션 (Goal 통과 시 멈춤) */
  async animateSteps(player, steps) {
    const dir = steps >= 0 ? 1 : -1;
    const count = Math.abs(steps);
    for (let i = 0; i < count; i++) {
      const next = player.position + dir;
      // 경계 클램프 (시작 이전/끝 이후)
      if (next < 0) { player.position = 0; break; }
      player.position = next;
      this.renderPieces();
      await util.delay(CONFIG.STEP_MS);
      if (player.position >= this.board.size - 1) break;   // Goal 통과 즉시 멈춤
    }
  }

  /** 도착칸 타입에 따른 효과 처리 */
  async resolveTile(player) {
    const tile = this.board.tiles[player.position];
    switch (tile.type) {
      case 'trap':  await this.handleTrap(player); break;
      case 'bonus': await this.handleBonus(player); break;
      case 'warp':  await this.handleWarp(player, tile); break;
      case 'item':  await this.handleItem(player); break;
      default: /* normal/start */ break;
    }

    if (this.over) return;
    // rollAgain 보너스 처리 후 턴 종료
    if (player.pending.rollAgain) {
      player.pending.rollAgain = false;
      this.log(`🎲 ${player.name} 한 번 더 굴립니다!`);
      this.busy = false;     // 같은 플레이어가 다시 굴릴 수 있도록 (render 전에 해제)
      this.render();
      return;
    }
    this.nextPlayer();
  }

  /* ---------- 특수칸 핸들러 ---------- */

  async handleTrap(player) {
    // Shield 자동 사용
    if (player.hasItem('shield')) {
      player.removeItem('shield');
      this.log(`🛡️ ${player.name} 의 방패가 함정을 막았어요!`);
      this.flashTile(player.position, 'shield');
      this.render();
      await util.delay(500);
      return;
    }

    const effect = util.pick(CONFIG.TRAP_EFFECTS);
    this.flashTile(player.position, 'trap');
    switch (effect) {
      case 'back3': {
        this.log(`🕳️ 함정! ${player.name} 이(가) ${CONFIG.BACK_STEPS}칸 뒤로 갑니다.`);
        await util.delay(400);
        await this.animateSteps(player, -CONFIG.BACK_STEPS);
        break;
      }
      case 'skipTurn':
        player.skipNextTurn = true;
        this.log(`🕳️ 함정! ${player.name} 은(는) 다음 턴을 쉽니다. 😴`);
        break;
      case 'loseItem': {
        const lost = player.removeRandomItem();
        if (lost) this.log(`🕳️ 함정! ${player.name} 이(가) ${ITEM_DEFS[lost].icon}${ITEM_DEFS[lost].name} 을(를) 잃었어요.`);
        else this.log(`🕳️ 함정! 하지만 ${player.name} 은(는) 잃을 아이템이 없네요.`);
        break;
      }
    }
    this.render();
    await util.delay(400);
  }

  async handleBonus(player) {
    const effect = util.pick(CONFIG.BONUS_EFFECTS);
    this.flashTile(player.position, 'bonus');
    switch (effect) {
      case 'forward3':
        this.log(`⭐ 보너스! ${player.name} 이(가) ${CONFIG.FORWARD_STEPS}칸 앞으로 갑니다.`);
        await util.delay(400);
        await this.animateSteps(player, CONFIG.FORWARD_STEPS);
        // forward3 로 Goal 통과 시 승리 처리 (특수칸 연쇄는 막음)
        if (player.position >= this.board.size - 1) {
          player.position = this.board.size - 1;
          player.finished = true;
          this.renderPieces();
          return this.win(player);
        }
        break;
      case 'rollAgain':
        player.pending.rollAgain = true;
        this.log(`⭐ 보너스! ${player.name} 이(가) 주사위를 한 번 더 굴립니다.`);
        break;
      case 'gainItem':
        this.grantRandomItem(player, '⭐ 보너스!');
        break;
    }
    this.render();
    await util.delay(400);
  }

  async handleWarp(player, tile) {
    this.log(`🌀 워프! ${player.name} 이(가) ${util.displayNo(tile.index)}번 → ${util.displayNo(tile.warpTo)}번 으로 순간이동!`);
    // 워프 애니메이션: 빨려들어갔다(out) 새 위치에서 나타남(in)
    const piece = this.dom.pieces.querySelector(`[data-player="${player.id}"]`);
    if (piece) {
      piece.classList.add('warp-out');
      await util.delay(350);
      // 보이지 않는 동안 transition 없이 즉시 순간이동
      piece.style.transition = 'none';
      player.position = tile.warpTo;
      this.renderPieces();
      // 강제 리플로우로 위치 적용 후 transition 복구
      void piece.offsetWidth;
      piece.style.transition = '';
      piece.classList.remove('warp-out');
      piece.classList.add('warp-in');
      await util.delay(350);
      piece.classList.remove('warp-in');
    } else {
      player.position = tile.warpTo;
      this.renderPieces();
    }
    // 워프 도착칸은 추가 특수효과 미발동 (단, Goal 이면 승리)
    if (player.position >= this.board.size - 1) {
      player.finished = true;
      return this.win(player);
    }
    this.render();
  }

  async handleItem(player) {
    this.flashTile(player.position, 'item');
    this.grantRandomItem(player, '🎁 아이템 칸!');
    this.render();
    await util.delay(400);
  }

  /** 무작위 아이템 1개 지급 (한도 초과 시 로그만) */
  grantRandomItem(player, prefix) {
    const key = util.pick(ITEM_KEYS);
    const def = ITEM_DEFS[key];
    if (player.addItem(key)) {
      this.log(`${prefix} ${player.name} 이(가) ${def.icon}${def.name} 획득!`);
      this.popItemEffect(player);
    } else {
      this.log(`${prefix} 하지만 ${player.name} 의 가방이 가득 찼어요 (최대 ${CONFIG.MAX_ITEMS}개).`);
    }
  }

  /* ---------- 턴 종료 / 승리 / 재시작 ---------- */

  nextPlayer() {
    if (this.over) return;
    this.current = (this.current + 1) % this.players.length;
    this.startTurn();
  }

  win(player) {
    this.over = true;
    this.busy = true;
    this.log(`🏆 ${player.name} 이(가) 집에 도착했어요! 승리! 🎉`);
    this.render();
    this.dom.winMessage.textContent = `${player.name} 승리!`;
    this.dom.winOverlay.classList.remove('hidden');
    this.spawnConfetti();
  }

  restart() {
    this.over = false;
    this.busy = false;
    this.dom.winOverlay.classList.add('hidden');
    this.dom.confetti.innerHTML = '';
    this.dom.diceChooser.classList.add('hidden');
    this.dom.diceChooser.innerHTML = '';
    this.dom.game.classList.add('hidden');
    this.dom.setup.classList.remove('hidden');
    // 설정값 유지한 채 이름 입력 다시 표시
    this.selectCount(this.playerCount);
  }

  /* ---------- 아이템 사용 (플레이어 패널 버튼) ---------- */
  useItem(playerId, key, itemIndex) {
    if (this.over || this.busy) return;
    const p = this.currentPlayer;
    if (p.id !== playerId) return;          // 자기 턴에만
    if (ITEM_DEFS[key].autoUse) return;     // shield 는 자동 — 수동 사용 불가

    // swap 은 교환 대상이 있을 때만
    if (key === 'swap') {
      const others = this.players.filter((q) => q !== p && !q.finished);
      if (others.length === 0) {
        this.log('🔄 교환할 상대가 없어요.');
        this.render();
        return;
      }
    }

    const msg = applyItemEffect(this, p, key);
    if (msg === null) { this.render(); return; }

    // 즉시 소비형(swap)은 바로 제거. 보류형(boost/double/dice)은 효과 발동 시 제거.
    if (key === 'swap') p.removeItem(key);
    this.log(msg);
    this.render();
  }

  /* ---------- 렌더링 ---------- */

  /** 전체 UI 동기화 (현재 턴 / 플레이어 패널 / 버튼 상태) */
  render() {
    this.renderCurrentTurn();
    this.renderPlayersPanel();
    this.renderPieces();
    // 버튼 상태
    const canRoll = !this.over && !this.busy;
    this.dom.rollBtn.disabled = !canRoll;
  }

  renderCurrentTurn() {
    if (this.over) {
      this.dom.currentTurn.innerHTML = '<span class="turn-label">게임 종료</span>';
      return;
    }
    const p = this.currentPlayer;
    this.dom.currentTurn.innerHTML =
      `<span class="turn-label">현재 턴</span>` +
      util.charImg(p.character, 'turn-thumb') +
      `<span class="turn-name">${p.name}</span>`;
  }

  renderPlayersPanel() {
    this.dom.playersPanel.innerHTML = '';
    this.players.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'player-card' +
        (p === this.currentPlayer && !this.over ? ' active' : '') +
        (p.finished ? ' finished' : '');
      card.style.setProperty('--accent', p.character.color);

      // 아이템 칩 (현재 턴 플레이어만 클릭 가능)
      const isTurn = p === this.currentPlayer && !this.over && !this.busy;
      const itemsHtml = p.items.length
        ? p.items.map((key, idx) => {
            const def = ITEM_DEFS[key];
            const usable = isTurn && !def.autoUse;
            return `<button class="item-chip${usable ? ' usable' : ''}" ` +
              `${usable ? '' : 'disabled'} data-pid="${p.id}" data-key="${key}" data-idx="${idx}" ` +
              `title="${def.name}: ${def.desc}${def.autoUse ? ' (자동)' : ''}">` +
              `${def.icon}</button>`;
          }).join('')
        : '<span class="no-items">없음</span>';

      const flags = [];
      if (p.skipNextTurn) flags.push('<span class="flag skip">다음 턴 쉬기</span>');
      if (p.pending.boost) flags.push('<span class="flag">부스트 대기</span>');
      if (p.pending.doubleMove) flags.push('<span class="flag">더블 대기</span>');
      if (p.pending.diceControl) flags.push('<span class="flag">주사위 조작</span>');
      if (p.finished) flags.push('<span class="flag done">도착 🏁</span>');

      card.innerHTML =
        `<div class="pc-head">` +
          util.charImg(p.character, 'pc-thumb') +
          `<div class="pc-name">${p.name}</div>` +
        `</div>` +
        `<div class="pc-row"><span class="pc-key">위치</span>` +
          `<span class="pc-val">${util.displayNo(p.position)} / ${this.board.size}칸</span></div>` +
        `<div class="pc-row"><span class="pc-key">아이템</span>` +
          `<span class="pc-items">${itemsHtml}</span></div>` +
        (flags.length ? `<div class="pc-flags">${flags.join('')}</div>` : '');

      this.dom.playersPanel.appendChild(card);
    });

    // 아이템 사용 이벤트 (위임)
    this.dom.playersPanel.querySelectorAll('.item-chip.usable').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.useItem(Number(btn.dataset.pid), btn.dataset.key, Number(btn.dataset.idx));
      });
    });
  }

  /** 게임 시작 시 캐릭터 말 DOM 을 1회 생성 (이후엔 위치만 갱신해 CSS transition 으로 이동) */
  buildPieces() {
    const layer = this.dom.pieces;
    layer.innerHTML = '';
    this.players.forEach((p) => {
      const piece = document.createElement('div');
      piece.className = 'piece';
      piece.dataset.player = p.id;
      piece.innerHTML = util.charImg(p.character, 'piece-img');
      layer.appendChild(piece);
    });
  }

  /**
   * 캐릭터 말 위치 갱신 (같은 칸이면 살짝 흩뜨림).
   * 말 DOM 은 재사용하므로 left/top 변경이 CSS transition 으로 부드럽게 이동.
   */
  renderPieces() {
    const layer = this.dom.pieces;
    const points = this.board.tilePoints;
    if (!points.length || !this.players.length) return;
    // 말 DOM 이 없으면(첫 렌더/리사이즈) 생성
    if (layer.querySelectorAll('.piece').length !== this.players.length) {
      this.buildPieces();
    }

    // viewBox → 실제 px 비율
    const vb = this.dom.svg.viewBox.baseVal;
    const rect = this.dom.svg.getBoundingClientRect();
    const scaleX = rect.width / vb.width;
    const scaleY = rect.height / vb.height;

    // 같은 칸에 모인 플레이어를 세어 오프셋 분산
    const byTile = {};
    this.players.forEach((p) => {
      (byTile[p.position] = byTile[p.position] || []).push(p);
    });

    this.players.forEach((p) => {
      const pt = points[p.position];
      const mates = byTile[p.position];
      const idx = mates.indexOf(p);
      const n = mates.length;
      // 원형으로 살짝 분산
      const angle = (idx / Math.max(1, n)) * Math.PI * 2;
      const spread = n > 1 ? 16 : 0;
      const ox = Math.cos(angle) * spread;
      const oy = Math.sin(angle) * spread;

      const x = pt.x * scaleX + ox;
      const y = pt.y * scaleY + oy;

      const piece = layer.querySelector(`[data-player="${p.id}"]`);
      if (!piece) return;
      piece.style.left = `${x}px`;
      piece.style.top = `${y}px`;
      piece.style.zIndex = 100 + p.position;
    });
  }

  /**
   * 진행 상황을 상단 중앙 배너에 표시 (가장 최근 1건만).
   * 메시지가 바뀔 때마다 살짝 팝 애니메이션을 줘 변화를 직관적으로 인지.
   */
  log(msg) {
    this.logs.push(msg);
    if (this.logs.length > 200) this.logs.shift();
    const banner = this.dom.statusBanner;
    if (!banner) return;
    banner.textContent = msg;
    // 재트리거를 위해 애니메이션 클래스를 떼었다 붙임
    banner.classList.remove('pulse');
    void banner.offsetWidth;
    banner.classList.add('pulse');
  }

  /* ---------- 시각 효과 ---------- */

  /** 칸을 잠깐 번쩍이게 */
  flashTile(index, kind) {
    const tiles = this.dom.svg.querySelectorAll('.tile');
    const g = tiles[index];
    if (!g) return;
    g.classList.add('flash', `flash-${kind}`);
    setTimeout(() => g.classList.remove('flash', `flash-${kind}`), 700);
  }

  /** 아이템 획득 팝업 효과 (현재 위치 말 위에) */
  popItemEffect(player) {
    const piece = this.dom.pieces.querySelector(`[data-player="${player.id}"]`);
    if (!piece) return;
    const pop = document.createElement('div');
    pop.className = 'item-pop';
    pop.textContent = '🎁';
    piece.appendChild(pop);
    setTimeout(() => pop.remove(), 1000);
  }

  /** 승리 confetti */
  spawnConfetti() {
    const box = this.dom.confetti;
    box.innerHTML = '';
    const colors = ['#e8534e', '#f4c542', '#5cb85c', '#5c9ce8', '#b07ae8', '#ff9ec7'];
    for (let i = 0; i < 80; i++) {
      const c = document.createElement('span');
      c.className = 'confetti-piece';
      c.style.left = `${util.randInt(0, 100)}%`;
      c.style.background = util.pick(colors);
      c.style.animationDelay = `${util.randInt(0, 1500)}ms`;
      c.style.animationDuration = `${util.randInt(1800, 3200)}ms`;
      box.appendChild(c);
    }
  }
}

/* =====================================================================
   부팅 — 창 크기 변경 시 말 위치 재계산
===================================================================== */
let game;
window.addEventListener('DOMContentLoaded', () => {
  game = new Game();
});
window.addEventListener('resize', () => {
  if (game && game.players.length && !game.dom.game.classList.contains('hidden')) {
    game.renderPieces();
  }
});
