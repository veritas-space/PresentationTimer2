/* =========================================================
   発表タイマー script.js（統合パネル版）
   設計仕様書 Ver.2.2 の動作仕様を踏襲
   ========================================================= */
'use strict';
 
/* ---------- 定数（5.4 表示色 / 5.6 スケール / 10.2 音声） ---------- */
 
const COLOR_PRESENTATION = '#5AFF07';   // 発表モード・通常     RGB(90,255,7)
const COLOR_QA           = '#FEFF15';   // 質疑応答モード・通常 RGB(254,255,21)
const COLOR_DISCUSSION   = '#19D3FF';   // 内部討議・通常       RGB(25,211,255)
const COLOR_OVERTIME     = '#F80201';   // 超過中（全モード共通）RGB(248,2,1)
 
const BASE_PANEL_WIDTH = 1400;          // 統合パネル integratedPanel のスケール1.0時の幅（style.css の 1400px と一致させること）
const SCALE_MIN = 0.5;
const SCALE_MAX = 3.0;
 
const MAX_TOTAL_SEC = 5999;             // 99分59秒
 
// 鈴種ごとの音声ファイル（変更時はここ1か所のみ修正すればよい）
const BELL_SOUND_FILES = {
  1: 'chime1.wav',   // 1鈴
  2: 'chime2.wav',   // 2鈴
  3: 'chime3.wav'    // 3鈴
};
 
// モード名の多言語対応（表示言語ごとの「発表」「質疑応答」に相当する文字列）
const MODE_LABELS = {
  ja: { presentation: '発表',        qa: '質疑応答', discussion: '内部討議' },
  en: { presentation: 'Presentation', qa: 'Q&A',     discussion: 'Internal Discussion' },
  zh: { presentation: '报告',        qa: '提问环节', discussion: '内部讨论' }
};
const DEFAULT_LANGUAGE = 'ja';
 
// モードの切替順（「モード」ボタンで 発表 → 質疑応答 → 内部討議 → 発表 …。無効モードは飛ばす）
const MODE_ORDER = ['presentation', 'qa', 'discussion'];
 
// モードごとの入力欄ID接頭辞
const MODE_PREFIX = { presentation: 'pres', qa: 'qa', discussion: 'dis' };
 
/* ---------- 7.1 state（タイマー状態） ---------- */
 
const state = {
  mode: 'presentation',   // 'presentation' | 'qa' | 'discussion'
  running: false,
  remainingSec: 600,
  overtime: false,
  overtimeSec: 0,
  intervalId: null,
  firedFlags: { pre1: false, pre2: false, end: false }
};
 
/* ---------- 7.2 settings（設定値） ---------- */
 
const settings = {
  presentation: {
    enabled: true,
    totalSec: 600,
    pre1: { enabled: false, offsetSec: 60, bellType: 1 },
    pre2: { enabled: false, offsetSec: 30, bellType: 2 },
    end:  { enabled: false, bellType: 3 }
  },
  qa: {
    enabled: true,
    totalSec: 300,
    pre1: { enabled: false, offsetSec: 60, bellType: 1 },
    pre2: { enabled: false, offsetSec: 30, bellType: 2 },
    end:  { enabled: false, bellType: 3 }
  },
  discussion: {
    enabled: true,
    totalSec: 300,
    pre1: { enabled: false, offsetSec: 60, bellType: 1 },
    pre2: { enabled: false, offsetSec: 30, bellType: 2 },
    end:  { enabled: false, bellType: 3 }
  }
};
 
/* ---------- 7.3 uiState（表示パネルの大きさ／表示言語） ---------- */
 
const uiState = {
  scale: 1.0,
  panelWidthPx: BASE_PANEL_WIDTH,
  language: DEFAULT_LANGUAGE,  // 'ja' | 'en' | 'zh'
  showModeLabel: true          // モード名（キャプション）の表示 ON/OFF
};
 
/* ---------- 内部作業用 ---------- */
 
let resizeStartX = 0;
let resizeStartWidth = BASE_PANEL_WIDTH;
let resizing = false;
let audioUnlocked = false;
const preloadedAudio = {};
 
const $ = (id) => document.getElementById(id);
 
/* =========================================================
   モードの有効／無効
   ========================================================= */
 
function enabledModes() {
  return MODE_ORDER.filter((m) => settings[m].enabled);
}
 
// currentMode の次の有効モード（有効モードが他になければ currentMode のまま）
function nextEnabledMode(currentMode) {
  const start = MODE_ORDER.indexOf(currentMode);
  for (let i = 1; i <= MODE_ORDER.length; i++) {
    const m = MODE_ORDER[(start + i) % MODE_ORDER.length];
    if (settings[m].enabled) return m;
  }
  return currentMode;
}
 
// 「モード」ボタンは、有効モードが2つ以上あるときだけ押せる
function updateModeButton() {
  $('btnMode').disabled = enabledModes().length < 2;
}
 
// 入力欄の有効／無効チェックに合わせて、設定ブロックの入力欄を灰色（入力不可）にする
function refreshModeBlocks() {
  Object.keys(MODE_PREFIX).forEach((m) => {
    const pfx = MODE_PREFIX[m];
    const block = $(pfx === 'pres' ? 'presentationSettings' : pfx + 'Settings');
    const enabled = $(pfx + 'ModeEnabled').checked;
    block.classList.toggle('is-disabled', !enabled);
    block.querySelectorAll('input, select').forEach((el) => {
      if (el.id !== pfx + 'ModeEnabled') el.disabled = !enabled;
    });
  });
}
 
/* =========================================================
   5.2 タイマー表示
   ========================================================= */
 
function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
 
function renderTime() {
  const sec = state.overtime ? state.overtimeSec : state.remainingSec;
  $('timeDisplay').textContent = formatTime(sec);
}
 
/* =========================================================
   5.3 モード名表示
   ========================================================= */
 
function renderModeLabel() {
  const labels = MODE_LABELS[uiState.language] || MODE_LABELS[DEFAULT_LANGUAGE];
  $('modeLabel').textContent = labels[state.mode];
}
 
/* =========================================================
   5.4 表示色（タイマー表示とモード名表示へ同一色を適用）
   ========================================================= */
 
function updateDisplayColor() {
  let color;
  if (state.overtime) {
    color = COLOR_OVERTIME;
  } else if (state.mode === 'presentation') {
    color = COLOR_PRESENTATION;
  } else if (state.mode === 'qa') {
    color = COLOR_QA;
  } else {
    color = COLOR_DISCUSSION;
  }
  $('timeDisplay').style.color = color;
  $('modeLabel').style.color = color;
}
 
function renderAll() {
  updateDisplayColor();
  renderTime();
  renderModeLabel();
}
 
/* =========================================================
   10.2 音声再生
   ========================================================= */
 
function playBell(bellType) {
  const file = BELL_SOUND_FILES[bellType] || BELL_SOUND_FILES[1];
  const audio = new Audio(file);
  audio.play().catch(() => { /* 再生不可の場合は無視 */ });
}
 
// 初回のユーザー操作で自動再生制限を解除する
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const a = new Audio(BELL_SOUND_FILES[1]);
  a.volume = 0;
  a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
}
 
function preloadBellSounds() {
  Object.keys(BELL_SOUND_FILES).forEach((key) => {
    const a = new Audio();
    a.preload = 'auto';
    a.src = BELL_SOUND_FILES[key];
    preloadedAudio[key] = a;
  });
}
 
/* =========================================================
   10.1 予鈴・終鈴の鳴動判定
   ========================================================= */
 
function checkPreBell(n) {
  const key = (n === 1) ? 'pre1' : 'pre2';
  const conf = settings[state.mode][key];
  if (!conf.enabled) return;
  if (state.overtime) return;
  if (state.firedFlags[key]) return;
  if (state.remainingSec !== conf.offsetSec) return;
 
  playBell(conf.bellType);
  state.firedFlags[key] = true;
}
 
function checkEndBell() {
  const conf = settings[state.mode].end;
  if (!conf.enabled) return;
  if (state.firedFlags.end) return;
  if (state.remainingSec !== 0) return;
 
  playBell(conf.bellType);
  state.firedFlags.end = true;
}
 
/* =========================================================
   11. メインループ
   ========================================================= */
 
function tick() {
  if (!state.running) return;
 
  if (!state.overtime) {
    state.remainingSec -= 1;
    if (state.remainingSec <= 0) {
      state.remainingSec = 0;
      state.overtime = true;
      state.overtimeSec = 0;
    }
  } else {
    state.overtimeSec += 1;
  }
 
  checkPreBell(1);
  checkPreBell(2);
  checkEndBell();
 
  updateDisplayColor();
  renderTime();
  renderModeLabel();
}
 
/* =========================================================
   9. ボタン動作
   ========================================================= */
 
// 9.1 開始
function startTimer() {
  unlockAudio();
  if (state.running) return;                 // 二重起動防止
  state.running = true;
  state.intervalId = setInterval(tick, 1000);
}
 
// 9.2 停止
function stopTimer() {
  if (state.intervalId !== null) {
    clearInterval(state.intervalId);
    state.intervalId = null;
  }
  state.running = false;
  // remainingSec / overtimeSec / overtime / firedFlags は保持する
}
 
// 9.3 モード
function toggleMode() {
  const next = nextEnabledMode(state.mode);
  if (next === state.mode) return;           // 有効モードが1つだけなら何もしない
  stopTimer();
  state.mode = next;
  state.remainingSec = settings[state.mode].totalSec;
  state.overtime = false;
  state.overtimeSec = 0;
  resetFiredFlags();
  renderAll();
}
 
// 9.4 リセット
function resetTimer() {
  stopTimer();
  state.remainingSec = settings[state.mode].totalSec;
  state.overtime = false;
  state.overtimeSec = 0;
  resetFiredFlags();
  renderAll();
}
 
function resetFiredFlags() {
  state.firedFlags.pre1 = false;
  state.firedFlags.pre2 = false;
  state.firedFlags.end  = false;
}
 
/* =========================================================
   言語選択（表示パネルの外側にある languageSelector）
   ========================================================= */
 
// モード名（キャプション）表示のON/OFF。タイマーの計測状態には影響しない
function onCaptionToggle(e) {
  uiState.showModeLabel = e.target.checked;
  $('displayPanel').classList.toggle('caption-off', !uiState.showModeLabel);
}
 
// 言語セレクトボックス変更時：表示言語を切り替え、モード名表示のみ更新する
// （タイマーの計測状態・残り時間には一切影響しない）
function onLanguageChange(e) {
  const lang = e.target.value;
  uiState.language = MODE_LABELS[lang] ? lang : DEFAULT_LANGUAGE;
  renderModeLabel();
}
 
/* =========================================================
   6.4 入力検証 / 6.5 設定反映
   ========================================================= */
 
// 数値入力欄が空（未入力）の場合は 0 を入力する
function fillEmptyNumberInputs() {
  document.querySelectorAll('#settingsPanel input[type="number"]').forEach((el) => {
    if (el.value.trim() === '') el.value = '0';
  });
}
 
function readInt(id) {
  const raw = $(id).value.trim();
  if (raw === '' || !/^-?\d+$/.test(raw)) return NaN;
  return parseInt(raw, 10);
}
 
/**
 * 6.4 の検証を上から順に実施する。
 * @returns {string|null} エラーメッセージ。問題なければ null。
 */
function validateSettings() {
  // 有効モードが1つもない場合は反映できない
  if (!MODE_ORDER.some((m) => $(MODE_PREFIX[m] + 'ModeEnabled').checked)) {
    return 'いずれか1つ以上のモードを有効にしてください。';
  }
 
  // 検証対象は有効なモードのみ（無効モードの入力値は検証しない）
  const prefixes = MODE_ORDER
    .map((m) => MODE_PREFIX[m])
    .filter((pfx) => $(pfx + 'ModeEnabled').checked);
 
  // 検証対象の収集（未チェックの予鈴は検証しない）
  const minFields = [];
  const secFields = [];
  prefixes.forEach((pfx) => {
    minFields.push(pfx + 'Min');
    secFields.push(pfx + 'Sec');
    [1, 2].forEach((n) => {
      if ($(pfx + 'Pre' + n + 'Enabled').checked) {
        minFields.push(pfx + 'Pre' + n + 'Min');
        secFields.push(pfx + 'Pre' + n + 'Sec');
      }
    });
  });
  const allFields = minFields.concat(secFields);
 
  // No.1 数値妥当性
  for (const id of allFields) {
    if (Number.isNaN(readInt(id))) {
      return '数値を正しく入力してください。';
    }
  }
 
  // No.2 分の範囲
  for (const id of minFields) {
    const v = readInt(id);
    if (v < 0 || v > 99) {
      return '分は0〜99の範囲で入力してください。';
    }
  }
 
  // No.3 秒の範囲
  for (const id of secFields) {
    const v = readInt(id);
    if (v < 0 || v > 59) {
      return '秒は0〜59の範囲で入力してください。';
    }
  }
 
  // No.4 持ち時間上限
  for (const pfx of prefixes) {
    const total = readInt(pfx + 'Min') * 60 + readInt(pfx + 'Sec');
    if (total < 0 || total > MAX_TOTAL_SEC) {
      return '時間は0秒〜99分59秒の範囲で設定してください。';
    }
  }
 
  // No.5 予鈴オフセット
  for (const pfx of prefixes) {
    const total = readInt(pfx + 'Min') * 60 + readInt(pfx + 'Sec');
    for (const n of [1, 2]) {
      if (!$(pfx + 'Pre' + n + 'Enabled').checked) continue;
      const offset = readInt(pfx + 'Pre' + n + 'Min') * 60 + readInt(pfx + 'Pre' + n + 'Sec');
      if (offset < 1 || offset >= total) {
        return '予鈴の時間は、設定した持ち時間より前になるように設定してください。';
      }
    }
  }
 
  return null;
}
 
/** 入力欄の内容を settings へ取り込む */
function collectSettings() {
  [['pres', 'presentation'], ['qa', 'qa'], ['dis', 'discussion']].forEach(([pfx, key]) => {
    const target = settings[key];
    target.enabled = $(pfx + 'ModeEnabled').checked;
    if (!target.enabled) return;                // 無効モードの設定値は取り込まない
    target.totalSec = readInt(pfx + 'Min') * 60 + readInt(pfx + 'Sec');
 
    [1, 2].forEach((n) => {
      const slot = (n === 1) ? 'pre1' : 'pre2';
      target[slot].enabled   = $(pfx + 'Pre' + n + 'Enabled').checked;
      target[slot].offsetSec = readInt(pfx + 'Pre' + n + 'Min') * 60 + readInt(pfx + 'Pre' + n + 'Sec');
      target[slot].bellType  = parseInt($(pfx + 'Pre' + n + 'Bell').value, 10);
    });
 
    target.end.enabled  = $(pfx + 'EndEnabled').checked;
    target.end.bellType = parseInt($(pfx + 'EndBell').value, 10);
  });
}
 
// 6.5 設定反映ボタンの処理
function applySettings() {
  unlockAudio();
 
  // 手順0: 未入力の数値欄を 0 にする
  fillEmptyNumberInputs();
 
  // 手順1: 検証
  const error = validateSettings();
  if (error !== null) {
    $('settingsError').textContent = error;
    return;                                   // 設定・表示とも変更しない
  }
  $('settingsError').textContent = '';
 
  // 手順2: 停止
  stopTimer();
 
  // 手順3: 設定の確定
  collectSettings();
 
  // 手順4〜6: 最初の有効モード・設定時間・超過解除
  state.mode = enabledModes()[0];
  state.remainingSec = settings[state.mode].totalSec;
  state.overtime = false;
  state.overtimeSec = 0;
 
  // 手順7: 鳴動フラグ初期化
  resetFiredFlags();
 
  // 手順8: 表示更新
  padTimeInputs();
  updateModeButton();
  renderAll();
}
 
/* =========================================================
   5.6 手動リサイズ（対象は統合パネル integratedPanel 全体）
   ========================================================= */
 
// 統合パネル全体（表示・操作ボタン・言語バー・設定）を一括して拡大・縮小する
function applyScale(scale) {
  $('integratedPanel').style.setProperty('--scale', scale);
}

// 初期表示：ウィンドウ幅に収まる倍率（最大1.0）
function initialScale() {
  const avail = (document.documentElement.clientWidth || window.innerWidth) - 48;
  return Math.min(1.0, Math.max(SCALE_MIN, avail / BASE_PANEL_WIDTH));
}

// 時間入力欄に ▲▼ ボタンを付ける（キーボード入力とクリックの両方で設定できる）
// 秒は 59 の次が 00、00 の前が 59 に回り込む。分は 0〜99 の範囲で止まる
function initSpinButtons() {
  const ICON_UP   = '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M5 0l5 6H0z"/></svg>';
  const ICON_DOWN = '<svg viewBox="0 0 10 6" aria-hidden="true"><path d="M0 0h10L5 6z"/></svg>';
  document.querySelectorAll('.time-field input[type="number"]').forEach((input) => {
    const wrap = document.createElement('span');
    wrap.className = 'spin-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    [['spin-up', ICON_UP, 1, '増やす'], ['spin-down', ICON_DOWN, -1, '減らす']].forEach(([cls, icon, dir, label]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'spin-btn ' + cls;
      btn.tabIndex = -1;
      btn.setAttribute('aria-label', label);
      btn.innerHTML = icon;
      btn.addEventListener('mousedown', (e) => e.preventDefault());   // 入力欄のフォーカスを保つ
      btn.addEventListener('click', () => stepTimeInput(input, dir));
      wrap.appendChild(btn);
    });
  });
}

function stepTimeInput(input, dir) {
  if (input.disabled) return;
  const min = parseInt(input.min, 10) || 0;
  const max = parseInt(input.max, 10);
  let v = parseInt(input.value, 10);
  if (Number.isNaN(v)) v = 0;
  v += dir;
  if (max === 59) {                       // 秒：回り込み
    if (v > max) v = min;
    if (v < min) v = max;
  } else {                                // 分：範囲内で止める
    v = Math.min(Math.max(v, min), max);
  }
  input.value = String(v);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

// 時間入力欄（MM:SS）を常に2桁で表示する
function padTimeInputs() {
  document.querySelectorAll('.time-field input[type="number"]').forEach((el) => {
    const v = el.value.trim();
    if (/^\d$/.test(v)) el.value = '0' + v;
  });
}
 
function onResizeMove(dx) {
  const newWidth = resizeStartWidth + dx;
  let scale = newWidth / BASE_PANEL_WIDTH;
  scale = Math.min(Math.max(scale, SCALE_MIN), SCALE_MAX);
  uiState.scale = scale;
  uiState.panelWidthPx = BASE_PANEL_WIDTH * scale;
  applyScale(scale);
}
 
function initResizeHandle() {
  const handle = $('resizeHandle');
 
  handle.addEventListener('pointerdown', (e) => {
    resizing = true;
    resizeStartX = e.clientX;
    // 現在幅は uiState を正とする（レイアウト未確定時の 0 取得を避ける）
    resizeStartWidth = uiState.panelWidthPx;
    if (typeof handle.setPointerCapture === 'function') {
      handle.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
  });
 
  handle.addEventListener('pointermove', (e) => {
    if (!resizing) return;
    onResizeMove(e.clientX - resizeStartX);
  });
 
  const endDrag = (e) => {
    if (!resizing) return;
    resizing = false;
    if (typeof handle.hasPointerCapture === 'function' && handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}
 
/* =========================================================
   13. 初期化シーケンス
   ========================================================= */
 
function init() {
  // 手順1: 初期値は HTML の value / checked 属性で設定済み
  // 手順2: 入力欄の初期値から settings を構築
  collectSettings();
 
  // 手順3〜4: 状態の初期化
  state.mode = enabledModes()[0];
  state.running = false;
  state.overtime = false;
  state.overtimeSec = 0;
  state.remainingSec = settings[state.mode].totalSec;
 
  // 手順5: 鳴動フラグ初期化
  resetFiredFlags();
 
  // 手順6: スケール初期化
  uiState.scale = initialScale();
  uiState.panelWidthPx = BASE_PANEL_WIDTH * uiState.scale;
  applyScale(uiState.scale);
 
  // 手順6b: 表示言語の初期化（languageSelector の初期選択値に合わせる）
  uiState.language = MODE_LABELS[$('langSelect').value] ? $('langSelect').value : DEFAULT_LANGUAGE;
 
  // 手順7: ボタンのイベント登録
  $('btnStart').addEventListener('click', startTimer);
  $('btnStop').addEventListener('click', stopTimer);
  $('btnMode').addEventListener('click', toggleMode);
  $('btnReset').addEventListener('click', resetTimer);
  $('btnApplySettings').addEventListener('click', applySettings);
  $('langSelect').addEventListener('change', onLanguageChange);
  $('captionShow').addEventListener('change', onCaptionToggle);
  onCaptionToggle({ target: $('captionShow') });   // ブラウザが保持したチェック状態に合わせる
  // 入力欄からフォーカスが外れた時点でも、空欄を 0 にする
  $('settingsPanel').addEventListener('focusout', (e) => {
    if (e.target.matches('input[type="number"]') && e.target.value.trim() === '') e.target.value = '0';
    padTimeInputs();
  });
  // ▲▼クリックや入力確定（change）でも2桁表示に整える
  $('settingsPanel').addEventListener('change', (e) => {
    if (e.target.matches('.time-field input')) padTimeInputs();
  });
  padTimeInputs();
  initSpinButtons();
  MODE_ORDER.forEach((m) => {
    $(MODE_PREFIX[m] + 'ModeEnabled').addEventListener('change', refreshModeBlocks);
  });
  refreshModeBlocks();
  updateModeButton();
 
  // 手順8: リサイズハンドル
  initResizeHandle();
 
  // 手順9: 音声の先読み
  preloadBellSounds();
 
  // 手順10: 初期表示
  renderAll();
}
 
document.addEventListener('DOMContentLoaded', init);
