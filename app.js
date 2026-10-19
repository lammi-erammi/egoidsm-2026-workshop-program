import { createStore } from './store.js';
import { FIREBASE_CONFIG, EVENT, AGENDA, QUESTIONS, PLAN, ACT, INTRO_MIN } from './config.js';

// ── 기본 도구 ───────────────────────────────────────────────
const $ = (sel, el = document) => el.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const br = s => esc(s).replace(/\n/g, '<br>');
const saved = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} }
};

// 주소 뒤 #k=비밀코드 로 워크샵 방을 구분한다. 진행자는 로그인해서 들어온다.
const hash = new URLSearchParams(location.hash.slice(1));
const PREVIEW = !(FIREBASE_CONFIG && FIREBASE_CONFIG.databaseURL);
const CODE = hash.get('k') || (PREVIEW ? 'preview' : '');

let uid = saved.get('ws-uid');
if (!uid) { uid = 'u' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); saved.set('ws-uid', uid); }
const me = { name: saved.get('ws-name'), team: saved.get('ws-team') };

const S = {
  admin: false,
  meta: undefined, teams: {}, stage: null, presence: {},
  online: true, offset: 0,
  view: 'board', team: me.team, joining: false,
  posterTeam: '', posterNotes: true,
  built: ''
};
let store;
const app = $('#app');
const now = () => Date.now() + S.offset;

const teamList = () => Object.entries(S.meta?.teams || {})
  .map(([id, t]) => ({ id, ...t }))
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
const teamOf = id => teamList().find(t => t.id === id);
const listOf = obj => Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
const fail = () => toast('저장되지 않았어요. 인터넷 연결을 확인해 주세요. (워크샵이 끝나 잠겼을 수도 있어요)');
window.addEventListener('store-error', fail);
// 저장이 되면 true, 막히면 안내를 띄우고 false
const save = p => Promise.resolve(p).then(() => true, () => { fail(); return false; });

// ── 시작 ────────────────────────────────────────────────────
main();

async function main() {
  if (!CODE) {
    app.innerHTML = `<div class="center-msg"><h2>워크샵 링크로 들어와 주세요</h2><p>진행자가 공유한 링크(주소 끝에 #k=… 가 붙은 링크)를 열어 주세요.</p></div>`;
    return;
  }
  try {
    store = await createStore(`w/${CODE}`);
  } catch (e) {
    app.innerHTML = `<div class="center-msg"><h2>연결하지 못했어요</h2><p>인터넷 연결을 확인하고 새로고침해 주세요.</p></div>`;
    return;
  }
  const denied = () => {
    app.innerHTML = `<div class="center-msg"><h2>링크를 다시 확인해 주세요</h2><p>워크샵 링크가 맞지 않거나 만료됐어요. 진행자에게 링크를 다시 받아 주세요.</p></div>`;
  };
  store.onAuth(async user => {
    const admin = user ? await store.isAdmin(user.uid) : false;
    if (user && !admin) {
      toast('진행자로 등록되지 않은 계정이에요. 설정_가이드 5단계를 확인해 주세요');
      store.signOut();
    }
    if (admin === S.admin) return;
    S.admin = admin;
    if (!admin && S.view === 'missions') S.view = 'board';
    S.built = '';
    render();
  });
  store.onServerOffset(v => { S.offset = v; });
  store.onConnection(v => { S.online = v; renderHeader(); if (v) announce(); });
  store.on('meta', v => { S.meta = v; if (!v && PREVIEW) seedPreview(); render(); }, denied);
  store.on('teams', v => { S.teams = v || {}; render(); }, denied);
  store.on('presence', v => { S.presence = v || {}; renderHeader(); render(); renderJoinOverlay(); }, denied);
  store.on('stage', v => { S.stage = v; renderHeader(); markFocus(); }, denied);
  setInterval(tick, 1000);
}

// 미리보기 모드에서는 옆 폴더의 missions.local.json 으로 미션을 채운다 (깃허브에는 올리지 않는 파일)
let seeded = false;
async function seedPreview() {
  if (seeded) return;
  seeded = true;
  try {
    const res = await fetch('../missions.local.json', { cache: 'no-store' });
    if (res.ok) await store.set('meta', await res.json());
  } catch {}
}

// 접속 표시 + '함께한 사람' 명단
function announce() {
  if (!store || !me.name || !me.team) return;
  store.presence(`presence/${me.team}/${uid}`, { name: me.name }).catch(() => {});
  save(store.set(`teams/${me.team}/members/${uid}`, { name: me.name, ts: now() }));
}

// ── 화면 전환 ───────────────────────────────────────────────
function show(key, build, update) {
  if (S.built !== key) { S.built = key; build(); markFocus(); }
  else if (update) update();
}

function render() {
  if (S.meta === undefined) return;
  if (!S.meta) return S.admin ? show('missions', buildMissionsEditor) : show('wait', buildWait);

  const hasTeam = !!teamOf(me.team);
  if (S.joining || !me.name || (!hasTeam && !S.admin)) return show('join:' + teamList().map(t => t.id + t.name).join(), buildJoin);

  if (!teamOf(S.team)) S.team = hasTeam ? me.team : '';
  if (S.view === 'board' && !S.team) S.view = 'all';

  if (S.view === 'board') return show('board:' + S.team, buildBoard, updateBoard);
  if (S.view === 'all') return show('all', buildAll, updateAll);
  if (S.view === 'poster' && S.admin) return show('poster', buildPoster, updatePoster);
  if (S.view === 'poster') { S.view = S.team ? 'board' : 'all'; return render(); }
  if (S.view === 'missions' && S.admin) return show('missions', buildMissionsEditor);
}

function go(view, team) {
  S.view = view;
  if (team !== undefined) S.team = team;
  render();
  window.scrollTo(0, 0);
}

function shell(inner) {
  app.innerHTML = `<div id="hdr"></div><main id="main">${inner}</main>`;
  renderHeader();
}

function buildWait() {
  app.innerHTML = `<div class="center-msg"><h2>진행자가 준비 중이에요</h2><p>잠시 후 자동으로 열려요.</p><p><button class="link" data-act="login">진행자 로그인</button></p></div>`;
}

// ── 진행자 로그인 ───────────────────────────────────────────
function openLogin() {
  const d = $('#loginDialog');
  $('#loginError').textContent = '';
  $('#loginPw').value = '';
  $('#loginNote').textContent = PREVIEW
    ? '미리보기 모드라서 아무 값이나 넣어도 들어가져요. 파이어베이스를 연결하면 진짜 계정만 통과해요.'
    : '파이어베이스에 등록한 진행자 계정으로 로그인해요.';
  d.showModal();
}

$('#loginForm').addEventListener('submit', async e => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const btn = $('#loginGo');
  btn.disabled = true;
  $('#loginError').textContent = '';
  try {
    await store.signIn($('#loginEmail').value.trim(), $('#loginPw').value);
    $('#loginPw').value = '';
    $('#loginDialog').close();
  } catch (err) {
    const code = err?.code || '';
    $('#loginError').textContent =
      code.includes('too-many-requests') ? '여러 번 틀려서 잠시 막혔어요. 몇 분 뒤에 다시 해 주세요.'
      : code.includes('network') ? '인터넷 연결을 확인해 주세요.'
      : '이메일이나 비밀번호가 맞지 않아요.';
  } finally {
    btn.disabled = false;
  }
});

// ── 머리말: 탭, 진행 순서, 타이머 ────────────────────────────
function renderHeader() {
  const hdr = $('#hdr');
  if (!hdr) return;
  const step = S.stage?.step;
  const team = teamOf(me.team);
  hdr.innerHTML = `
    <header class="top">
      <div class="brand"><b>${esc(EVENT.title)}</b><span>${esc(EVENT.program)}</span></div>
      <nav class="tabs">
        ${team || S.team ? `<button data-view="board" class="${S.view === 'board' && (!team || S.team === me.team) ? 'on' : ''}">${team ? '우리 팀 전지' : esc(teamOf(S.team)?.name) + ' 전지'}</button>` : ''}
        <button data-view="all" class="${S.view === 'all' ? 'on' : ''}">전체 팀</button>
        ${S.admin ? `<button data-view="poster" class="${S.view === 'poster' ? 'on' : ''}">A1 출력</button>
        <button data-view="missions" class="${S.view === 'missions' ? 'on' : ''}">미션 편집</button>` : ''}
      </nav>
      <div class="me">
        ${PREVIEW ? '<span class="badge warn" title="파이어베이스 설정 전: 이 컴퓨터의 탭끼리만 공유돼요">미리보기 모드</span>' : ''}
        <span class="dot ${S.online ? 'ok' : 'bad'}" title="${S.online ? '연결됨' : '연결이 끊겨 다시 연결하는 중'}"></span>
        <span class="who">${esc(me.name || '진행자')}${team ? ' · ' + esc(team.name) : S.admin ? ' · 진행자' : ''}</span>
        <button class="link" data-act="change-me">바꾸기</button>
        <button class="link" data-act="${S.admin ? 'logout' : 'login'}">${S.admin ? '진행자 로그아웃' : '진행자 로그인'}</button>
      </div>
    </header>
    <div class="stagebar">
      <ol class="agenda">
        ${AGENDA.map((a, i) => `
          <li class="${i === step ? 'now' : step != null && i < step ? 'done' : ''}" ${S.admin ? `data-act="stage" data-step="${i}" title="이 단계 시작 (${a.minutes}분)"` : ''}>
            <span class="n">${i + 1}</span><span class="t">${esc(a.title)}</span><span class="m">${a.minutes}분</span>
          </li>`).join('')}
      </ol>
      <div class="timer-box">
        <div class="stage-desc">${step != null ? esc(AGENDA[step]?.desc) : '시작 전이에요'}</div>
        <div id="timer" class="timer">--:--</div>
      </div>
    </div>
    ${step != null && AGENDA[step] ? `
    <div class="stage-ask">
      <span class="mode" id="stageMode"></span>
      ${AGENDA[step].ask ? `<span class="ask">💬 ${esc(AGENDA[step].ask)}</span>` : ''}
    </div>` : ''}
    ${!S.online ? '<div class="offline">인터넷 연결이 끊겼어요. 다시 연결되면 적은 내용이 자동으로 올라가요.</div>' : ''}
    ${S.admin ? `
    <div class="adminbar">
      <b>진행자</b>
      <button class="btn sm" data-act="stage-prev">◀ 이전</button>
      <button class="btn sm" data-act="stage-next">다음 ▶</button>
      <button class="btn sm" data-act="stage-plus">+1분</button>
      <button class="btn sm" data-act="stage-pause">${S.stage?.pausedLeft != null ? '다시 시작' : '멈춤'}</button>
      <button class="btn sm ghost" data-act="stage-reset">타이머 끄기</button>
      <span class="sep"></span>
      <button class="btn sm primary" data-act="guide">📋 단계 안내</button>
      <button class="btn sm" data-act="join-qr">접속 QR 띄우기</button>
      <button class="btn sm" data-act="copy-link">참가자 링크 복사</button>
      <button class="btn sm" data-act="backup">백업 받기</button>
    </div>` : ''}`;
  tick();
}

function tick() {
  const el = $('#timer');
  if (!el) return;
  const st = S.stage;
  let left = null;
  if (st?.endsAt) left = st.endsAt - now();
  else if (st?.pausedLeft != null) left = st.pausedLeft;
  if (left == null) { el.textContent = '--:--'; el.className = 'timer'; renderGuideTimer(st, null); return; }
  // 단계 안의 구간(진행자 설명 → 혼자 쓰기 → 나머지)과 그 구간의 남은 시간. 구간이 끝나면 다음 구간으로 저절로 넘어간다
  const mode = $('#stageMode'), a = AGENDA[st.step];
  const ph = a ? phaseNow(a, left) : null;
  if (mode && ph) {
    mode.textContent = `${ph.phase.label} ${fmtClock(ph.left)}`;
    mode.className = 'mode ' + ph.phase.key;
  }
  renderGuideTimer(st, left);
  const over = left < 0;
  const sec = Math.floor(Math.abs(left) / 1000);
  const t = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  el.textContent = over ? `+${t} 초과` : t;
  el.className = 'timer' + (over ? ' over' : left < 60000 ? ' soon' : '') + (st.pausedLeft != null ? ' paused' : '');
}

// ── 단계 안의 구간 ──
// 모든 단계는 진행자 설명(INTRO_MIN분)으로 시작하고, 혼자 쓰는 시간(silent)이 있으면 그다음, 남은 시간은 talk 구간
function phasesOf(a) {
  const intro = a.intro ?? INTRO_MIN, solo = a.silent || 0;
  return [
    { key: 'intro', label: '📣 진행자 설명', min: intro },
    { key: 'solo', label: '🤫 혼자 쓰기', min: solo },
    { key: 'talk', label: a.talk || '🗣 함께 이야기', min: Math.max(0, a.minutes - intro - solo) }
  ].filter(p => p.min > 0);
}
// left = 단계 전체 남은 시간(ms) → 지금 구간과 그 구간의 남은 시간. 시간이 넘치면 마지막 구간에서 음수
function phaseNow(a, left) {
  const list = phasesOf(a);
  let t = a.minutes * 60000 - left;
  for (let k = 0; k < list.length; k++) {
    const len = list[k].min * 60000;
    if (t < len || k === list.length - 1) return { phase: list[k], index: k, left: len - t, list };
    t -= len;
  }
}
const fmtClock = ms => {
  const s = Math.ceil(Math.abs(ms) / 1000);
  return `${ms < 0 ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const fmtMin = m => (m >= 1 ? `${Math.floor(m)}분` : '') + (m % 1 ? `${Math.round(m % 1 * 60)}초` : '');

// 단계 안내 화면의 타이머: 지금 진행 중인 단계를 보고 있을 때만 움직인다
function renderGuideTimer(st, left) {
  const box = $('#gdTimer');
  if (!box) return;
  const i = +box.dataset.step, a = AGENDA[i];
  const live = st && st.step === i && left != null;
  const ph = live ? phaseNow(a, left) : null;
  box.querySelectorAll('[data-phase]').forEach((el, k) => {
    el.classList.toggle('now', !!ph && k === ph.index);
    el.classList.toggle('done', !!ph && k < ph.index);
  });
  const big = $('#gdClock');
  if (big) {
    big.textContent = ph ? fmtClock(ph.left) : '--:--';
    big.className = 'gd-clock' + (ph && ph.left < 0 ? ' over' : ph && ph.left < 15000 ? ' soon' : '') + (st?.pausedLeft != null ? ' paused' : '');
  }
}

// 지금 단계의 칸을 강조하고, 나머지 칸은 살짝 흐리게 한다
function markFocus() {
  const f = AGENDA[S.stage?.step]?.focus;
  const focus = new Set([].concat(f || []).filter(Boolean));
  let any = false;
  document.querySelectorAll('[data-focus]').forEach(el => {
    const on = focus.has(el.dataset.focus);
    el.classList.toggle('focus', on);
    any ||= on;
  });
  document.body.classList.toggle('has-focus', any);
}

// ── 접속 안내 화면 (진행자): 참가자 링크 QR + 지금 접속한 인원 ──
const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const participantLink = () => `${location.origin}${location.pathname}#k=${CODE}`;

function loadQrLib() {
  if (window.qrcode) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = QR_LIB;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function openJoinOverlay() {
  let ov = $('#joinOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'joinOverlay';
    ov.className = 'join-overlay';
    ov.innerHTML = `
      <div class="jo-card">
        <button class="jo-close" data-act="join-qr-close" title="닫기 (Esc)">✕</button>
        <p class="eyebrow">${esc(EVENT.title)} · ${esc(EVENT.program)}</p>
        <h1>핸드폰으로 들어와 주세요</h1>
        <div class="jo-body">
          <div class="jo-qr" id="joQr">QR 만드는 중…</div>
          <div class="jo-side">
            <div class="jo-total"><span>지금 접속</span><b id="joTotal">0</b><span id="joExpected">명</span></div>
            <div class="jo-bar"><i id="joBar"></i></div>
            <ol class="jo-steps"><li>핸드폰 카메라로 QR을 찍어요</li><li>이름을 적고 우리 팀을 골라요</li><li>위쪽 이름 옆 초록 점이 보이면 끝!</li></ol>
            <div class="jo-teams" id="joTeams"></div>
          </div>
        </div>
      </div>`;
    document.body.appendChild(ov);
  }
  ov.hidden = false;
  renderJoinOverlay();
  try {
    await loadQrLib();
    const qr = window.qrcode(0, 'M');
    qr.addData(participantLink());
    qr.make();
    $('#joQr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
  } catch {
    $('#joQr').textContent = 'QR을 만들지 못했어요. 인터넷 연결을 확인해 주세요';
  }
}

function renderJoinOverlay() {
  const ov = $('#joinOverlay');
  if (!ov || ov.hidden || !S.meta) return;
  // 팀 집계에서 뺄 이름(예: 아무 팀에나 들어가는 정균님)은 팀 숫자에서만 빼고 전체 접속에는 센다
  const counts = teamList().map(t => ({ name: t.name, n: teamOnline(t.id).length, exp: +t.expected || 0 }));
  const total = Object.values(S.presence).reduce((sum, p) => sum + Object.keys(p || {}).length, 0);
  const expected = +S.meta.expected || counts.reduce((sum, c) => sum + c.exp, 0);
  $('#joTotal').textContent = total;
  $('#joExpected').textContent = expected ? `/ ${expected}명` : '명';
  $('#joBar').style.width = expected ? Math.min(100, total / expected * 100) + '%' : '0';
  $('#joTeams').innerHTML = counts.map(c => {
    const done = c.exp && c.n >= c.exp;
    return `<span class="${done ? 'done' : c.n ? 'on' : ''}">${esc(c.name)} <b>${c.n}${c.exp ? '/' + c.exp : ''}</b></span>`;
  }).join('');
}

// ── 단계 안내 화면 (진행자): 단계를 누르면 그 단계에서 할 일·예시·진행 멘트를 크게 보여 준다 ──
function openGuide(i) {
  if (i === AGENDA.length) return openFinish();
  const a = AGENDA[i];
  if (!a) return;
  if (!a.guide) { if (i === 0) openJoinOverlay(); return; }
  // 접속 QR 화면이 떠 있으면 닫는다 (안 닫으면 안내를 닫았을 때 QR이 다시 보인다)
  if ($('#joinOverlay')) $('#joinOverlay').hidden = true;
  let ov = $('#guideOverlay');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'guideOverlay';
    ov.className = 'guide-overlay';
    document.body.appendChild(ov);
  }
  const g = a.guide;
  const qs = [].concat(a.focus || []).map(f => QUESTIONS.find(q => q.id === f)).filter(Boolean);
  // 여러 줄 예시(\n)는 첫 줄을 굵게, 나머지는 한 줄씩 작게
  const item = x => {
    const [head, ...rest] = String(x).split('\n');
    return rest.length ? `<b>${esc(head)}</b>${rest.map(r => `<span class="gd-ex-line">${esc(r)}</span>`).join('')}` : esc(x);
  };
  const list = (arr, cls) => arr?.length ? `<ul class="${cls}">${arr.map(x => `<li>${item(x)}</li>`).join('')}</ul>` : '';
  ov.dataset.step = i;
  ov.innerHTML = `
    <div class="gd-card">
      <button class="jo-close" data-act="guide-close" title="닫기 (Esc)">✕</button>
      <div class="gd-head">
        <div>
          <p class="eyebrow">진행 순서 ${i + 1} / ${AGENDA.length} · 모두 ${a.minutes}분</p>
          <h1>${esc(a.title)}</h1>
          ${qs.length ? `<p class="gd-q">${qs.map(q => esc(q.text)).join('<br>')}</p>` : ''}
        </div>
        <div class="gd-timer"><div id="gdClock" class="gd-clock">--:--</div></div>
      </div>
      <div class="gd-goal">${br(g.goal)}${g.note ? `<small class="gd-note">${esc(g.note)}</small>` : ''}</div>
      <div class="gd-phases" id="gdTimer" data-step="${i}">
        ${phasesOf(a).map((p, k) => `
          <div class="gd-phase ${p.key}" data-phase="${p.key}" data-act="phase-jump" data-step="${i}" data-k="${k}" title="눌러서 이 구간부터 타이머 시작">
            <div class="gd-ph-head"><b>${esc(p.label)}</b><span>${fmtMin(p.min)}</span></div>
            ${list((g.flow || {})[p.key], 'gd-do')}
          </div>`).join('')}
      </div>
      <div class="gd-grid">
        ${g.good?.length || g.bad?.length ? `<section>
          ${g.good?.length ? `<h4>👍 좋은 예</h4>${list(g.good, 'gd-good')}` : ''}
          ${g.bad?.length ? `<h4>👎 피해야 할 예</h4>${list(g.bad, 'gd-bad')}` : ''}
        </section>` : ''}
        ${g.say ? `<section><h4>💬 진행자 질문</h4><p class="gd-say">“${esc(g.say)}”</p></section>` : ''}
      </div>
      <div class="gd-nav">
        <button class="btn sm" data-act="guide-go" data-step="${i - 1}" ${i <= 0 ? 'disabled' : ''}>◀ 이전 단계 안내</button>
        ${S.stage?.step === i ? '<span class="gd-now">▶ 지금 진행 중</span>' : `<button class="btn sm primary" data-act="stage" data-step="${i}">이 단계 시작 (${a.minutes}분 타이머)</button>`}
        <button class="btn sm" data-act="guide-go" data-step="${i + 1}">${i === AGENDA.length - 1 ? '마무리 ▶' : '다음 단계 안내 ▶'}</button>
      </div>
    </div>`;
  ov.hidden = false;
  tick();
}

// 마무리 화면: 마지막 단계 안내에서 '마무리'를 누르면 오늘 만든 것을 숫자로 보여 주고 인사한다
function openFinish() {
  const ov = $('#guideOverlay');
  if (!ov) return;
  const teams = teamList();
  const sum = f => teams.reduce((n, t) => n + f(t.id), 0);
  const stats = [
    ['참여한 팀', teams.filter(t => notesOf(t.id).length).length, '개'],
    ['붙인 포스트잇', sum(id => notesOf(id).length), '장'],
    ['팀 핵심 과제', sum(id => plansOf(id).length), '개'],
    ['내가 할 실행안', sum(id => pinsOf(id, 'q3').length), '개']
  ];
  ov.dataset.step = AGENDA.length;
  ov.innerHTML = `
    <div class="gd-card gd-finish">
      <button class="jo-close" data-act="guide-close" title="닫기 (Esc)">✕</button>
      <p class="eyebrow">${esc(EVENT.title)} · ${esc(EVENT.program)}</p>
      <h1>🎉 수고하셨습니다!</h1>
      <p class="gd-goal">12월 말 필사즉생 목표를 위해 팀이 할 일과 내가 할 일을 정했어요.<br>오늘 정한 실행안은 내일부터 바로 시작해요.</p>
      <div class="gd-stats">${stats.map(([k, v, u]) => `<div><b>${v}</b><span>${u}</span><small>${k}</small></div>`).join('')}</div>
      <p class="gd-say">💬 “각 팀 전지는 A1으로 출력해 팀 자리에 붙여 둘게요. 12월 31일에 이 숫자로 다시 만나요!”</p>
      <div class="gd-nav">
        <button class="btn sm" data-act="guide-go" data-step="${AGENDA.length - 1}">◀ 실행안 확정 안내</button>
        <button class="btn sm primary" data-act="guide-close">닫기</button>
      </div>
    </div>`;
  ov.hidden = false;
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if ($('#joinOverlay') && !$('#joinOverlay').hidden) $('#joinOverlay').hidden = true;
  if ($('#guideOverlay') && !$('#guideOverlay').hidden) $('#guideOverlay').hidden = true;
});

const uncountedNames = () => new Set((S.meta?.uncounted || []).map(n => String(n).trim()).filter(Boolean));
const teamOnline = teamId => {
  const skip = uncountedNames();
  return listOf(S.presence[teamId]).filter(p => !skip.has(String(p.name || '').trim()));
};

// ── 들어가기 (이름·팀 고르기) ───────────────────────────────
function buildJoin() {
  const teams = teamList();
  let pick = teamOf(me.team) ? me.team : '';
  app.innerHTML = `
    <div class="join"><div class="join-card">
      <p class="eyebrow">${esc(EVENT.title)} · ${esc(EVENT.program)}</p>
      <h1>목표 달성 실행 계획</h1>
      <p class="sub">이름과 팀을 고르면 우리 팀 전지가 열려요. 팀원이 적는 내용이 바로바로 보여요.</p>
      <label class="field">이름<input id="joinName" maxlength="20" placeholder="예: 김예람" value="${esc(me.name)}"></label>
      <div class="field">우리 팀</div>
      <div class="team-pick">${teams.map(t => `<button type="button" data-team="${esc(t.id)}" class="${t.id === pick ? 'on' : ''}">${esc(t.name)}</button>`).join('')}</div>
      <button id="joinGo" class="btn primary big">들어가기</button>
      ${S.admin
        ? '<button id="joinAdmin" class="btn ghost">팀 없이 진행자로 들어가기</button>'
        : '<button class="link center" data-act="login">진행자 로그인</button>'}
    </div></div>`;
  app.querySelectorAll('.team-pick button').forEach(b => b.onclick = () => {
    pick = b.dataset.team;
    app.querySelectorAll('.team-pick button').forEach(x => x.classList.toggle('on', x === b));
  });
  const enter = team => {
    const name = $('#joinName').value.trim();
    if (!name) { toast('이름을 적어 주세요'); $('#joinName').focus(); return; }
    if (!team && !S.admin) { toast('팀을 골라 주세요'); return; }
    if (me.team && me.team !== team) {
      save(store.remove(`presence/${me.team}/${uid}`));
      save(store.remove(`teams/${me.team}/members/${uid}`));
    }
    me.name = name; me.team = team || '';
    saved.set('ws-name', me.name); saved.set('ws-team', me.team);
    S.joining = false; S.team = me.team; S.view = me.team ? 'board' : 'all';
    announce();
    render();
  };
  $('#joinGo').onclick = () => enter(pick);
  if (S.admin) $('#joinAdmin').onclick = () => enter('');
  $('#joinName').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) enter(pick); };
}

// ── 팀 전지 ─────────────────────────────────────────────────
function buildBoard() {
  shell(`
    <div class="board-wrap">
    <section class="board ${canEditTeam() ? '' : 'readonly'}">
      ${canEditTeam() ? '' : '<div class="readonly-note">👀 다른 팀 전지예요. 볼 수만 있어요</div>'}
      <div class="board-title">
        <h1 id="boardName"></h1>
        <div class="online" id="online"></div>
      </div>
      <div class="missions" data-focus="mission" id="missions"></div>
      <div class="cols">
        ${QUESTIONS.map((q, i) => `
          <div class="col ${q.id}" data-focus="${q.id}">
            <div class="col-head"><span class="qnum">${i + 1}</span><p>${esc(q.text)}</p></div>
            ${i < 2 ? `<div id="gapBox-${q.id}"></div>` : ''}
            <div class="pin-count" id="pins-${q.id}"></div>
            ${q.id === 'q3' ? '<div class="plan-pick" id="planPick"></div>' : ''}
            <form class="composer" data-q="${q.id}">
              <textarea rows="2" maxlength="500" placeholder="${q.id === 'q3' ? '내가 할 일을 적어요' : '생각을 적고 Enter로 붙이기'}"></textarea>
              ${q.id === 'q3' ? `<div class="act-fields">${ACT.fields.map(f => `
                <label><span>${esc(f.label)}</span><input name="${f.key}" maxlength="${f.max}" placeholder="${esc(f.hint)}"></label>`).join('')}
              </div>` : ''}
              <button class="btn primary">붙이기</button>
            </form>
            <div class="notes" id="notes-${q.id}"></div>
          </div>`).join('')}
      </div>
      <!-- '12월까지 팀 핵심 과제' 칸은 2번 칸의 ⭐ 포스트잇과 겹쳐서 없앴다 (전지 넣기·빼기·고치기·지우기는 ⭐ 포스트잇에서) -->
      <div class="signers" id="signers"></div>
    </section>
    <aside class="live-preview">
      <div class="lp-head">
        <b>A1 전지 미리보기</b>
        <span class="lbl">팀이 고른 내용이 바로 반영돼요</span>
      </div>
      <div class="poster-frame" id="lpFrame"><div class="poster-scale" id="lpScale"></div></div>
    </aside>
    </div>`);
  updateBoard();
  document.fonts?.ready.then(() => { if (S.built.startsWith('board:')) renderLivePreview(); });
}

// 팀 전지 오른쪽 미리보기: A1 전지를 줄여서 그대로 보여 준다
function renderLivePreview() {
  const box = $('#lpScale'), frame = $('#lpFrame');
  if (!box || !frame) return;
  box.innerHTML = posterHtml(S.team);
  const poster = box.firstElementChild;
  fitStickies(poster);
  const scale = frame.clientWidth / poster.offsetWidth;
  box.style.transform = `scale(${scale})`;
  frame.style.height = poster.offsetHeight * scale + 'px';
}

const sortNotes = arr => arr.sort((a, b) => Object.keys(b.likes || {}).length - Object.keys(a.likes || {}).length || a.ts - b.ts);

// ── 목표 = 2026 팀퀘스트 (미션 편집에서 숫자를 고친다) ──
// meta.quests.company = 회사 목표(운영부서·그로스·CEO실도 같은 목표), meta.quests[팀 id] = 브랜드처럼 따로 목표가 있는 팀
// 1억 아래는 만 원 단위로 (예: 0.6 → 6,000만)
const fmtEok = v => Math.abs(v) < 1 && v !== 0
  ? `${(Math.round(v * 1000) * 10).toLocaleString('ko-KR')}만`
  : `${(Math.round(v * 10) / 10).toLocaleString('ko-KR')}억`;
function questOf(teamId) {
  const qs = S.meta?.quests || {};
  const own = teamId && qs[teamId];
  const q = own || qs.company;
  if (!q || !(+q.target)) return null;
  const target = +q.target, actual = +q.actual || 0;
  return { target, actual, rate: actual / target * 100, left: Math.max(0, target - actual), shared: !own };
}
// 원인 분석용 월 평균: 지금까지 월 평균(달성÷지난 달 수), 필요했던 월 평균(목표÷12), 남은 기간 필요한 월 평균
// 지난 달 수는 미션 편집의 '기준'(예: 9월)에서 숫자를 읽는다
function monthlyOf(teamId) {
  const q = questOf(teamId);
  const m = parseInt(String(S.meta?.questAsOf || '').match(/\d+/)?.[0], 10);
  if (!q || !(m >= 1 && m <= 12)) return null;
  return { months: m, avg: q.actual / m, need: q.target / 12 };
}
// 1번 칸(원인 분석): 지금까지 월 평균과 필요했던 월 평균
function monthlyHtml(teamId, cls = '') {
  const mo = monthlyOf(teamId);
  if (!mo) return '';
  const short = mo.avg < mo.need;
  return `
    <div class="gap-box ${cls}">
      <div><span>지금까지 월 평균 (${mo.months}개월)</span><b class="${short ? 'bad' : 'good'}">${fmtEok(mo.avg)}</b></div>
      <div><span>달성하려면 필요했던 월 평균</span><b>${fmtEok(mo.need)}</b></div>
    </div>`;
}

// ── 12월 말 필사즉생 목표 (월 매출, 억) ──
// meta.mustWin.company = 회사(운영부서·그로스·CEO실도 같은 목표), meta.mustWin[팀 id] = 브랜드처럼 따로 정한 팀
// 자기 퀘스트가 따로 있는 팀(브랜드)은 회사 목표를 물려받지 않는다 → 값이 없으면 '정하는 중'
function mustWinOf(teamId) {
  const mw = S.meta?.mustWin || {};
  const ownQuest = !!(teamId && S.meta?.quests?.[teamId]);
  const v = teamId && mw[teamId] != null && mw[teamId] !== '' ? mw[teamId] : (ownQuest ? null : mw.company);
  return +v > 0 ? +v : null;
}
function mustWinLine(teamId, cls = '') {
  const v = mustWinOf(teamId);
  // 전지(아웃라인 PDF)에는 이모지 글꼴이 없어서 🔥는 화면에서만
  return `<div class="must-win ${cls}">${cls ? '' : '🔥 '}12월 말 필사즉생 목표 <b>${v ? `월 ${fmtEok(v)}` : '정하는 중'}</b></div>`;
}
// 2번 칸(팀 전략): 필사즉생 목표와 지금까지 월 평균의 차이
function mustWinGapHtml(teamId, cls = '') {
  const v = mustWinOf(teamId);
  if (!v) return `<div class="gap-box ${cls}"><div><span>12월 말 필사즉생 목표</span><b>정하는 중</b></div></div>`;
  const mo = monthlyOf(teamId);
  const more = mo ? v - mo.avg : null;
  return `
    <div class="gap-box ${cls}">
      <div><span>12월 말 필사즉생 목표</span><b class="bad">월 ${fmtEok(v)}</b></div>
      ${mo ? `<div><span>지금까지 월 평균 (${mo.months}개월)</span><b>${fmtEok(mo.avg)}</b></div>
      <div><span>목표까지</span><b class="${more > 0 ? 'bad' : 'good'}">${more > 0 ? `월 ${fmtEok(more)} 더` : '이미 넘었어요'}</b></div>` : ''}
    </div>`;
}

function questHtml(q, cls = '', name = '2026 팀 퀘스트') {
  if (!q) return '';
  const asOf = S.meta?.questAsOf ? `${esc(S.meta.questAsOf)}까지` : '지금까지';
  return `
    <div class="quest ${cls}">
      <div class="q-line"><b>${fmtEok(q.target)}</b><span>${name} 매출 목표</span></div>
      <div class="q-bar"><i style="width:${Math.min(100, q.rate).toFixed(1)}%"></i></div>
      <div class="q-now">${asOf} <b>${fmtEok(q.actual)}</b> · 달성률 <b>${q.rate.toFixed(1)}%</b> · 남은 <b>${fmtEok(q.left)}</b></div>
    </div>`;
}

function companyCard(c) {
  return `
    <div class="mcard company">
      <div class="label">회사 · ${esc(c.name || '에고이즘')}</div>
      ${c.mission ? `<h4>미션</h4><p class="big">${br(c.mission)}</p>` : '<p class="empty">미션이 아직 없어요</p>'}
      ${questHtml(questOf(''), '', '2026 전사 퀘스트')}
    </div>`;
}

// 팀 카드: 부서 미션(예: 운영부서) + 팀·브랜드 미션 + 퀘스트(자기 퀘스트가 없으면 전사 퀘스트) + 필사즉생 목표
function teamCard(t) {
  const any = t.deptMission || t.mission;
  const q = questOf(t.id);
  return `
    <div class="mcard team">
      <div class="label">우리 팀 · ${esc(t.name)}${t.dept ? ` (${esc(t.dept)})` : ''}</div>
      ${t.deptMission ? `<h4>${esc(t.dept || '부서')} 미션</h4><p class="big">${br(t.deptMission)}</p>` : ''}
      ${t.mission ? `<h4>${t.deptMission ? '팀 미션' : '미션'}</h4><p class="${t.deptMission ? 'mid' : 'big'}">${br(t.mission)}</p>` : ''}
      ${!any ? '<p class="empty">미션이 아직 없어요</p>' : ''}
      ${questHtml(q, '', '2026 팀 퀘스트')}
      ${mustWinLine(t.id)}
    </div>`;
}

function updateBoard() {
  const team = teamOf(S.team);
  if (!team) return;
  const data = S.teams[S.team] || {};
  const c = S.meta.company || {};
  $('#boardName').textContent = team.name;

  const online = listOf(S.presence[S.team]);
  $('#online').innerHTML = `<span class="lbl">지금 접속 ${online.length}명</span>` +
    online.map(p => `<span class="chip ${p.id === uid ? 'me' : ''}">${esc(p.name)}</span>`).join('');

  $('#missions').innerHTML = companyCard(c) + teamCard(team);
  if ($('#gapBox-q1')) $('#gapBox-q1').innerHTML = monthlyHtml(S.team);
  if ($('#gapBox-q2')) $('#gapBox-q2').innerHTML = mustWinGapHtml(S.team);

  const notes = notesOf(S.team);
  for (const q of QUESTIONS) {
    const pins = pinsOf(S.team, q.id);
    const max = pinMaxOf(q.id);
    const full = pins.length >= max;
    // 전지에 붙인 포스트잇이 맨 위, 나머지는 공감 순.
    // 2번 칸은 핵심 과제로 올린 것이 맨 위 (과제 순서대로 → 전지 번호 1~5와 같은 차례)
    const planRank = new Map(plansOf(S.team).map((p, i) => [p.from, i]));
    const rank = x => x.slot ? -1 : planRank.has(x.n.id) ? planRank.get(x.n.id) : Infinity;
    const list = sortNotes(notes.filter(n => n.q === q.id))
      .map(n => ({ n, slot: pinSlotOf(S.team, q.id, n.id) }))
      .sort((a, b) => (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1));
    $(`#pins-${q.id}`).innerHTML = (q.fit
      ? `📌 전지에 붙인 실행안 <b>${pins.length}장</b> <span class="lbl">— 전지에 자리가 남는 동안 더 붙일 수 있어요</span>`
      : max
      ? `📌 전지에 붙인 포스트잇 <b>${pins.length}/${max}</b>` + (full ? ' <span class="lbl">— 바꾸려면 하나를 떼어 주세요</span>' : '')
      : `⭐ 핵심 과제 <b>${plansOf(S.team).length}</b>개 · 🖼 전지에 넣은 과제 <b>${posterPlansOf(S.team).length}/${PLAN.posterMax}</b> <span class="lbl">— 포스트잇의 '⭐ 핵심 과제로'를 누르고, 🖼로 전지에 넣을 ${PLAN.posterMax}개를 골라요</span>` + orphanPlansHtml(S.team))
      + (q.id === 'q3' ? planTallyHtml(S.team, pins) : '');
    $(`#notes-${q.id}`).innerHTML = list.length
      ? list.map(({ n, slot }) => noteHtml(n, slot, full)).join('')
      : '<p class="empty">아직 붙은 포스트잇이 없어요</p>';
  }

  const members = membersOf(S.team);
  $('#signers').innerHTML = members.length
    ? `<span class="lbl">함께한 사람</span>${members.map(m => `<span class="sign">${esc(m.name)}</span>`).join('')}`
    : '';

  renderPlanPick();
  renderLivePreview();
  cleanupDeadPins(S.team);
}

// 2번 칸 포스트잇 없이 남은 핵심 과제 (예전에 직접 적은 과제 등) — 칸이 없어졌으니 여기서 넣기·빼기·지우기
function orphanPlansHtml(teamId) {
  const notes = S.teams[teamId]?.notes || {};
  const list = plansOf(teamId).filter(p => !isNote(notes[p.from]));
  if (!list.length) return '';
  const poster = posterPlansOf(teamId);
  return `<div class="orphan-plans"><span class="lbl">포스트잇 없이 남은 핵심 과제</span>${list.map(p => {
    const k = poster.findIndex(x => x.id === p.id);
    return `<div class="op">${k >= 0 ? `<i style="--c:${PLAN_COLORS[k]}">${k + 1}</i>` : ''}<span>${esc(p.what)}</span>
      <button class="link" data-act="plan-poster" data-plan="${esc(p.id)}">${k >= 0 ? '🖼 빼기' : '🖼 전지에 넣기'}</button>
      <button class="link" data-act="plan-del" data-plan="${esc(p.id)}">지우기</button></div>`;
  }).join('')}</div>`;
}

// 과제별로 전지에 붙은 실행안 수 (0장인 과제는 ⚠ — 누가 맡을지 정해야 함)
function planTallyHtml(teamId, pins) {
  const list = posterPlansOf(teamId);
  if (!list.length) return '';
  const notes = S.teams[teamId]?.notes || {};
  const cnt = list.map(p => pins.filter(x => linkOf(teamId, notes[x.note])?.plan.id === p.id).length);
  return `<div class="plan-tally"><span class="lbl">과제별 전지 실행안</span>${list.map((p, k) =>
    `<span class="pt ${cnt[k] ? '' : 'zero'}" style="--c:${PLAN_COLORS[k]}" title="${esc(p.what)}"><i>${k + 1}</i>${cnt[k]}장${cnt[k] ? '' : ' ⚠'}</span>`).join('')}${
    // 전지 밖 과제·과제 없는 실행안도 세어서 위 'n/8'과 합계가 맞게
    (() => { const other = pins.length - cnt.reduce((a, b) => a + b, 0); return other > 0 ? `<span class="pt zero" title="전지에 없는 과제와 이어졌거나 과제가 없는 실행안"><i>?</i>과제 밖 ${other}장</span>` : ''; })()}</div>`;
}

function noteHtml(n, pinSlot, pinsFull) {
  const likes = Object.keys(n.likes || {}).length;
  const liked = !!n.likes?.[uid];
  const mine = n.uid === uid || S.admin;
  const pinText = pinSlot ? S.teams[S.team]?.pins?.[n.q]?.[pinSlot]?.text : '';
  const max = pinMaxOf(n.q);
  const promoted = isPromoted(S.team, n.id);
  const ln = n.q === 'q3' ? linkOf(S.team, n) : null;
  // 2번 칸: 핵심 과제로 올린 포스트잇에는 전지 번호(1~5)와 넣기·빼기·고치기·빼기 버튼
  const plan = n.q === 'q2' ? plansOf(S.team).find(p => p.from === n.id) : null;
  const posterList = plan ? posterPlansOf(S.team) : [];
  const pk = plan ? posterList.findIndex(p => p.id === plan.id) : -1;
  const planTag = n.q === 'q2'
    ? (plan ? `<div class="note-plan ${pk >= 0 ? '' : 'off'}" style="--c:${pk >= 0 ? PLAN_COLORS[pk] : '#9ca3af'}"><i>${pk >= 0 ? pk + 1 : '·'}</i>${pk >= 0 ? '🖼 전지에 들어감' : '전지 밖 핵심 과제'}${plan.what !== n.text ? ` · 과제 이름: ${esc(plan.what)}` : ''}</div>` : '')
    : n.q !== 'q3' ? ''
    : ln ?`<div class="note-plan" style="--c:${ln.color}"><i>${ln.num ?? '·'}</i>${esc(ln.plan.what)}${ln.num ? '' : ' (전지 밖 과제)'}</div>`
    : '<div class="note-plan none"><i>?</i>이어진 핵심 과제가 없어요</div>';
  return `
    <div class="note ${esc(n.q)} ${n.uid === uid ? 'mine' : ''} ${pinSlot || promoted ? 'pinned' : ''}" data-id="${esc(n.id)}">
      ${pinSlot ? '<span class="pin-badge">📌 전지에 붙음</span>' : promoted ? '<span class="pin-badge">⭐ 핵심 과제</span>' : ''}
      ${planTag}
      <div class="note-text">${br(n.text)}</div>
      ${n.q === 'q3' ? `<div class="note-meta">${actMeta(n) ? esc(actMeta(n)) : '<span class="warn">마감일·확인할 지표가 없어요 — 고치기로 채워 주세요</span>'}</div>` : ''}
      ${pinSlot && pinText !== n.text ? `<div class="pin-text">전지에는: “${esc(pinText)}”</div>` : ''}
      <div class="note-foot">
        <span class="by">${esc(n.name)}</span>
        <button class="like ${liked ? 'on' : ''}" data-act="like" title="공감">♥ ${likes || ''}</button>
        ${!max ? '' : pinSlot
          ? `<button class="pin on" data-act="unpin" data-slot="${pinSlot}" title="전지에서 떼기">📌 떼기</button>`
          : `<button class="pin" data-act="pin" ${pinsFull ? `disabled title="이 칸은 ${max}장이 다 찼어요"` : `title="A1 전지에 붙여요 (${isFitQ(n.q) ? '전지에 자리가 남는 동안' : `이 칸은 ${max}장까지`})"`}>📌 전지에 붙이기</button>`}
        ${n.q === 'q2' && !plan ? `<button class="pin" data-act="promote" title="이 아이디어를 '${esc(PLAN.title)}'로 올려요">⭐ 핵심 과제로</button>` : ''}
        ${plan ? `${pk >= 0
            ? `<button class="pin on" data-act="plan-poster" data-plan="${esc(plan.id)}" title="A1 전지에서 빼기">🖼 전지에서 빼기</button>`
            : `<button class="pin" data-act="plan-poster" data-plan="${esc(plan.id)}" ${posterList.length >= PLAN.posterMax ? `disabled title="전지에는 ${PLAN.posterMax}개까지예요. 하나를 빼고 넣어 주세요"` : 'title="A1 전지에 넣기"'}>🖼 전지에 넣기</button>`}
          <button class="link" data-act="plan-edit" data-plan="${esc(plan.id)}">과제 이름 고치기</button>
          <button class="link" data-act="plan-del" data-plan="${esc(plan.id)}">⭐ 과제에서 빼기</button>` : ''}
        ${mine && n.q === 'q3' ? '<button class="link" data-act="relink" title="위에서 고른 핵심 과제로 바꿔요">과제 바꾸기</button>' : ''}
        ${mine ? '<button class="link" data-act="edit">고치기</button><button class="link" data-act="del">지우기</button>' : ''}
      </div>
    </div>`;
}

// ── 전지에 붙일 포스트잇: 질문마다 정해진 장수(pinMax)만큼 p1~p8 자리가 있다 (규칙은 p1~p8 허용) ──
// 자리에는 포스트잇 id와 전지에 들어갈 글(40자까지)을 따로 담는다. 원래 포스트잇은 그대로 둔다.
const PIN_LEN = 40;
const PIN_SLOTS = Array.from({ length: 20 }, (_, i) => 'p' + (i + 1)); // 규칙도 p1~p20
const isFitQ = q => !!QUESTIONS.find(x => x.id === q)?.fit;

// 이 포스트잇을 전지에 더 붙여도 실행안 글씨가 줄지 않고 전지가 넘치지 않는지, 화면 밖에 미리 그려 본다
function posterFitsWith(teamId, q, slot, pin) {
  const pins = (S.teams[teamId] ||= {}).pins ||= {};
  const slots = (pins[q] ||= {});
  const keepNotes = S.posterNotes;
  slots[slot] = pin; S.posterNotes = true;
  try {
    const holder = measuredPoster(teamId);
    const poster = holder.firstElementChild, plan = poster.querySelector('.p-plan');
    const ok = parseFloat(poster.style.getPropertyValue('--act')) >= ACT_MAX && (!plan || plan.scrollHeight <= plan.clientHeight + 1);
    holder.remove();
    return ok;
  } finally {
    delete slots[slot]; S.posterNotes = keepNotes;
  }
}
const pinMaxOf = q => QUESTIONS.find(x => x.id === q)?.pinMax || 0;
const pinSlotsFor = q => PIN_SLOTS.slice(0, pinMaxOf(q));
// 자리 하나하나를 '살아 있는 자리'와 '버려진 자리'로 나눈다.
// 버려진 자리 = 원래 포스트잇이 지워졌거나, 같은 포스트잇이 두 자리에 붙은 경우의 뒤쪽 자리
// 글과 질문이 있는 포스트잇만 (반쯤 지워진 찌꺼기는 보이지 않게)
const isNote = n => n && typeof n.text === 'string' && n.text && n.q;
const notesOf = teamId => listOf(S.teams[teamId]?.notes).filter(isNote);

function pinSlots(teamId, q) {
  const notes = S.teams[teamId]?.notes || {};
  const seen = new Set();
  const live = [], dead = [];
  // 자리 이름(p1~p8)과 상관없이 먼저 붙인 순서로 pinMax 장까지 살아 있는 자리
  // (예: 원인이 4장 → 3장으로 줄었을 때 p4에 붙은 것도 3장 안이면 그대로 센다)
  const max = pinMaxOf(q);
  PIN_SLOTS
    .map(slot => ({ slot, ...(S.teams[teamId]?.pins?.[q]?.[slot] || {}) }))
    .filter(p => p.ts)
    .sort((a, b) => a.ts - b.ts)
    .forEach(p => {
      if (live.length < max && p.text && isNote(notes[p.note]) && !seen.has(p.note)) { seen.add(p.note); live.push(p); }
      else dead.push(p);
    });
  return { live, dead };
}
const pinsOf = (teamId, q) => pinSlots(teamId, q).live;
const pinSlotOf = (teamId, q, noteId) => pinsOf(teamId, q).find(p => p.note === noteId)?.slot;

// 버려진 자리를 치운다 (한 번만 시도. 규칙상 못 지우는 사람이면 조용히 넘어가고, 화면에는 원래 안 보인다)
const cleaning = new Set();
function cleanupDeadPins(teamId) {
  for (const q of QUESTIONS) {
    for (const p of pinSlots(teamId, q.id).dead) {
      const path = `teams/${teamId}/pins/${q.id}/${p.slot}`;
      if (cleaning.has(path)) continue;
      cleaning.add(path);
      store.remove(path).catch(() => {}).finally(() => setTimeout(() => cleaning.delete(path), 5000));
    }
  }
}

// 포스트잇이 핵심 과제로 올라가 있는지는 과제 쪽을 보고 판단한다 (과제를 지우면 다시 올릴 수 있게)
const isPromoted = (teamId, noteId) => plansOf(teamId).some(p => p.from === noteId);

// 같은 사람이 핸드폰·노트북 두 곳에서 들어와도 이름은 한 번만
function membersOf(teamId) {
  const seen = new Set();
  return listOf(S.teams[teamId]?.members)
    .sort((a, b) => a.ts - b.ts)
    .filter(m => m.name && !seen.has(m.name.trim()) && seen.add(m.name.trim()));
}

async function pinNote(note, noteId) {
  if (pinSlotOf(S.team, note.q, noteId)) return toast('이미 전지에 붙어 있어요');
  let text = note.text;
  if (text.length > PIN_LEN) {
    const short = await editText(`전지에는 ${PIN_LEN}자까지 들어가요. 전지에 넣을 글로 줄여 주세요 (원래 포스트잇은 그대로예요)`, text, PIN_LEN);
    if (!short) return;
    if (short.length > PIN_LEN) return toast(`${PIN_LEN}자를 넘었어요 (${short.length}자)`);
    text = short;
  }
  if (!S.teams[S.team]?.notes?.[noteId]) return toast('그사이 이 포스트잇이 지워졌어요');
  // 버려진 자리는 먼저 비우고 쓴다
  for (const p of pinSlots(S.team, note.q).dead) await store.remove(`teams/${S.team}/pins/${note.q}/${p.slot}`).catch(() => {});
  const live = pinsOf(S.team, note.q);
  const taken = new Set(live.map(p => p.slot));
  const slot = live.length < pinMaxOf(note.q) && PIN_SLOTS.find(k => !taken.has(k));
  if (!slot) return toast(`이 칸은 전지에 ${pinMaxOf(note.q)}장까지 붙일 수 있어요. 하나를 떼고 붙여 주세요`);
  const pin = { note: noteId, text, ts: now(), by: uid };
  if (isFitQ(note.q) && !posterFitsWith(S.team, note.q, slot, pin)) {
    return toast('전지가 꽉 찼어요. 하나를 떼고 붙여 주세요');
  }
  try {
    await store.set(`teams/${S.team}/pins/${note.q}/${slot}`, pin);
  } catch {
    toast('방금 다른 사람이 먼저 붙여서 자리가 찼어요. 목록을 보고 다시 해 주세요');
  }
}

// ── 12월까지 실행 계획: 팀마다 r1~r20 자리만 있다 (규칙에서도 같은 자리만 허용) ──
// 한 줄 = 실행안·담당·기한·확인할 지표. 네 칸이 모두 찬 줄만 쓴다.
// onPoster 가 켜진 줄만 A1 전지에 들어간다 (posterMax 개까지, 넘치면 순서상 앞의 것만)
const PLAN_SLOTS = Array.from({ length: PLAN.max }, (_, i) => 'r' + (i + 1));
const isPlan = p => p && PLAN.fields.every(f => typeof p[f.key] === 'string' && p[f.key].trim());
const plansOf = teamId => listOf(S.teams[teamId]?.plan).filter(isPlan).sort((a, b) => (a.order ?? a.ts) - (b.order ?? b.ts));
const posterPlansOf = teamId => plansOf(teamId).filter(p => p.onPoster).slice(0, PLAN.posterMax);
// 전지에 넣은 핵심 과제 1~5번의 색 (전지 가운데 번호 동그라미와 실행안 포스트잇의 번호가 같은 색)
const PLAN_COLORS = ['#ff6b4a', '#2f7de1', '#16a37a', '#c2410c', '#7c3aed'];
// 내 실행안 고치기 창의 첫 칸 (나머지 칸은 ACT.fields)
const ACT_TEXT = { key: 'text', label: '내가 할 일', max: 500, hint: '무엇을 할지' };
// 실행안 아래 작은 줄: 마감일 10/24 · 확인 구성안 3개
const actMeta = n => ACT.fields.filter(f => n?.[f.key]).map(f => `${f.key === 'metric' ? '확인' : f.label} ${n[f.key]}`).join(' · ');

// ── 내 실행안(q3) ↔ 팀 핵심 과제 ──
// 실행안 포스트잇에 과제 자리(plan)와 그 과제가 만들어진 시각(planTs)을 같이 적는다.
// 과제를 지우고 같은 자리에 새 과제가 들어와도 예전 실행안이 엉뚱하게 이어지지 않게 시각까지 맞춰 본다.
function linkOf(teamId, n) {
  if (!n?.plan) return null;
  const p = plansOf(teamId).find(x => x.id === n.plan && x.ts === n.planTs);
  if (!p) return null;
  const k = posterPlansOf(teamId).findIndex(x => x.id === p.id);
  return { plan: p, num: k >= 0 ? k + 1 : null, color: k >= 0 ? PLAN_COLORS[k % PLAN_COLORS.length] : '#9ca3af' };
}
// 실행안을 쓰기 전에 고른 과제 (이 기기에서만 기억)
let pickPlan = null;
function renderPlanPick() {
  const box = $('#planPick');
  if (!box) return;
  const list = posterPlansOf(S.team);
  if (pickPlan && !list.some(p => p.id === pickPlan.id && p.ts === pickPlan.ts)) pickPlan = null;
  box.innerHTML = list.length
    ? `<div class="lbl">어느 핵심 과제를 위한 일인가요? 먼저 고르고 써요</div>
       <div class="pp-list">${list.map((p, k) => `<button type="button" class="pp ${pickPlan?.id === p.id ? 'on' : ''}" data-act="pick-plan" data-id="${esc(p.id)}" style="--c:${PLAN_COLORS[k]}"><i>${k + 1}</i><span>${esc(p.what)}</span></button>`).join('')}</div>`
    : '<div class="lbl">④단계에서 전지에 넣을 핵심 과제(🖼)를 고르면, 여기서 과제를 골라 실행안을 써요</div>';
}

// 입력 창 (핵심 과제 / 내 실행안 고치기): 모든 칸을 채우면 값, 취소하면 null
function planDialog(title, values = {}, fields = PLAN.fields) {
  const d = $('#planDialog');
  $('#planTitle').textContent = title;
  // 창 위 안내: 핵심 과제는 과제 이름만, 내 실행안은 세 칸 모두
  if ($('#planNote')) $('#planNote').textContent = fields === PLAN.fields
    ? '얼마나·언제까지 숫자를 넣어 과제를 적어요. 담당자·마감일·확인할 지표는 3번 칸 내 실행안에 적어요.'
    : `${fields.map(f => f.label).join('·')}을 모두 채워야 저장돼요.`;
  $('#planFields').innerHTML = fields.map(f => `
    <label class="field">${esc(f.label)} <small>${f.max}자까지</small>
      <input name="${f.key}" maxlength="${f.max}" placeholder="${esc(f.hint)}" value="${esc(String(values[f.key] || '').slice(0, f.max))}" required>
    </label>`).join('');
  d.returnValue = '';
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    // '저장'을 누르는 순간 값을 받는다 (창 닫힘 신호는 브라우저 상태에 따라 늦을 수 있어서 기다리지 않음)
    $('#planForm').onsubmit = e => {
      if (e.submitter?.value !== 'ok') return;
      const v = {};
      for (const f of fields) v[f.key] = $(`#planFields [name=${f.key}]`).value.trim().slice(0, f.max);
      finish(fields.every(f => v[f.key]) ? v : null);
    };
    d.onclose = () => finish(null);
    d.showModal();
    $('#planFields input')?.focus();
  });
}

async function addPlan(values, from) {
  if (!isPlan(values)) { toast('핵심 과제를 적어 주세요'); return false; }
  const used = S.teams[S.team]?.plan || {};
  const slot = PLAN_SLOTS.find(k => !used[k]);
  if (!slot) { toast(`핵심 과제는 ${PLAN.max}개까지예요. 하나를 고치거나 지워 주세요`); return false; }
  const ts = now();
  // 전지 자리가 남아 있으면 처음부터 전지에 넣어 둔다 (나중에 🖼로 빼거나 바꿀 수 있다)
  const onPoster = posterPlansOf(S.team).length < PLAN.posterMax;
  try {
    await store.set(`teams/${S.team}/plan/${slot}`, { ...values, onPoster, name: me.name || '진행자', uid, ts, order: ts, ...(from ? { from } : {}) });
    return true;
  } catch {
    toast('방금 다른 사람이 먼저 써서 자리가 찼어요. 목록을 보고 다시 해 주세요');
    return false;
  }
}

function editText(title, text, maxLength = 500) {
  const d = $('#editDialog');
  $('#editTitle').textContent = title;
  $('#editText').maxLength = maxLength;
  $('#editText').value = text;
  d.returnValue = '';
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    d.querySelector('form').onsubmit = e => { if (e.submitter?.value === 'ok') finish($('#editText').value.trim()); };
    d.onclose = () => finish(null);
    d.showModal();
  });
}

// ── 전체 팀 보기 ────────────────────────────────────────────
function buildAll() {
  shell(`<section class="all"><div class="all-head"><h1>전체 팀</h1><p>팀마다 지금 적고 있는 내용이 실시간으로 보여요.</p></div><div class="all-grid" id="allGrid"></div></section>`);
  updateAll();
}

function updateAll() {
  const grid = $('#allGrid');
  if (!grid) return;
  grid.innerHTML = teamList().map(t => {
    const d = S.teams[t.id] || {};
    const notes = notesOf(t.id);
    const all = plansOf(t.id);
    const plans = posterPlansOf(t.id);
    const online = teamOnline(t.id).length;
    return `
      <article class="tcard ${t.id === me.team ? 'mine' : ''}">
        <header><h3>${esc(t.name)}</h3><span class="lbl">접속 ${online}${+t.expected ? ' / ' + t.expected : ''}명</span></header>
        <div class="counts">${QUESTIONS.map((q, i) => `<span class="cnt ${q.id}" title="${esc(q.text)}">${i + 1}. ${notes.filter(n => n.q === q.id).length}장</span>`).join('')}</div>
        <div class="lbl">핵심 과제 ${all.length}개 · 전지에 ${plans.length}개</div>
        <ol class="mini-plan">${plans.length ? plans.map(p => `<li>${esc(p.what)}</li>`).join('') : '<li class="empty">전지에 넣은 핵심 과제 없음</li>'}</ol>
        <button class="btn sm" data-act="open-team" data-team="${esc(t.id)}">전지 보기</button>
      </article>`;
  }).join('');
}

// ── A1 출력 ─────────────────────────────────────────────────
function buildPoster() {
  if (!teamOf(S.posterTeam)) S.posterTeam = S.team || teamList()[0]?.id || '';
  shell(`
    <section class="poster-view">
      <div class="poster-controls">
        <label>팀 <select id="pTeam">${teamList().map(t => `<option value="${esc(t.id)}" ${t.id === S.posterTeam ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
        <label><input type="checkbox" id="pNotes" ${S.posterNotes ? 'checked' : ''}> 포스트잇 넣기</label>
        <button class="btn primary" id="pOutline">아웃라인 PDF 저장 (인쇄소용)</button>
        <button class="btn" id="pPrint">인쇄 창으로 보기</button>
        <p class="hint"><b>아웃라인 PDF</b>는 글자를 모두 선으로 바꾼 A1 파일(오프린트미 가이드: 작업 596×842mm, 재단 594×840mm)이라 그대로 인쇄소에 넘기면 돼요. 파일 이름은 <b>경영팀_프로그램_팀이름.pdf</b>. 포스트잇은 팀이 📌로 고른 것(${QUESTIONS.filter(q => q.pinMax).map(q => q.fit ? `${esc(q.poster)}은 글씨가 줄지 않는 만큼` : `${esc(q.poster)} ${q.pinMax}장`).join(', ')})만 들어가요. 팀 전략 아이디어는 핵심 과제로 정리돼 전지에는 따로 넣지 않아요.</p>
      </div>
      <div class="poster-frame" id="pFrame"><div class="poster-scale" id="pScale"></div></div>
    </section>`);
  $('#pTeam').onchange = e => { S.posterTeam = e.target.value; updatePoster(); };
  $('#pNotes').onchange = e => { S.posterNotes = e.target.checked; updatePoster(); };
  // 글꼴이 다 받아진 뒤에 다시 그려야 포스트잇 칸 높이가 맞는다
  Promise.all([document.fonts.load("700 80px Pretendard", '가'), document.fonts.load("80px 'Poor Story'", '가')]).catch(() => {}).then(updatePoster);
  $('#pPrint').onclick = () => {
    const holder = measuredPoster(S.posterTeam);
    $('#poster-print').innerHTML = holder.innerHTML;
    holder.remove();
    // PDF로 저장할 때 파일 이름이 페이지 제목을 따라간다 → 경영팀_프로그램_그로스팀.pdf
    const title = document.title;
    document.title = posterFileName();
    window.addEventListener('afterprint', () => { document.title = title; }, { once: true });
    window.print();
  };
  $('#pOutline').onclick = saveOutlinePdf;
  updatePoster();
  document.fonts?.ready.then(updatePoster);
}

function updatePoster() {
  const box = $('#pScale');
  if (!box) return;
  box.innerHTML = posterHtml(S.posterTeam);
  fitStickies(box.firstElementChild);
  fitPoster();
}

const posterFileName = () => `경영팀_프로그램_${(teamOf(S.posterTeam)?.name || '').replace(/[\\/:*?"<>|\s]+/g, '')}`;

// 글자를 모두 선으로 바꾼 A1 PDF를 바로 내려받는다 (outline-pdf.js)
async function saveOutlinePdf() {
  const btn = $('#pOutline');
  const label = btn.textContent;
  btn.disabled = true;
  const holder = measuredPoster(S.posterTeam);
  try {
    const { outlinePdf } = await import('./outline-pdf.js');
    const { blob, missing } = await outlinePdf(holder.firstElementChild, msg => { btn.textContent = msg; });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = posterFileName() + '.pdf';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(missing ? `저장했어요. 다만 글꼴에 없는 글자 ${missing}개가 빈칸으로 들어갔어요` : '아웃라인 PDF를 저장했어요');
  } catch (err) {
    console.error(err);
    toast('PDF를 만들지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요');
  } finally {
    holder.remove();
    btn.disabled = false;
    btn.textContent = label;
  }
}

// 줄이지 않은 실제 크기 전지를 화면 밖에 그리고 포스트잇 크기까지 맞춘다 (PDF·인쇄용). 다 쓰면 remove()
function measuredPoster(teamId) {
  const holder = document.createElement('div');
  holder.className = 'poster-measure';
  holder.innerHTML = posterHtml(teamId);
  document.body.appendChild(holder);
  fitStickies(holder.firstElementChild);
  return holder;
}

// 1) 핵심 과제·실행안 글씨: 핵심 과제 칸에 다 들어가는 가장 큰 크기 (같이 2pt씩 줄인다)
// 2) 원인 포스트잇 글씨: 칸 안에 다 들어가는 가장 큰 크기
const PLAN_MAX = 54, PLAN_KEEP = 42, PLAN_MIN = 36, ACT_MAX = 30, ACT_MIN = 18;
const STICKY_MAX = 44, STICKY_MIN = 20;
function fitStickies(poster) {
  if (!poster) return;
  // 0) 제목(팀 이름 + 목표 달성 실행 계획)은 한 줄. 팀 이름이 길어 넘칠 때만 줄인다
  const title = poster.querySelector('.p-title');
  if (title) {
    let size = 96;
    poster.style.setProperty('--title', size + 'pt');
    while (size > 60 && title.scrollWidth > title.clientWidth + 1) {
      size -= 4;
      poster.style.setProperty('--title', size + 'pt');
    }
  }
  // 1) 핵심 과제 칸(과제 + 그 아래 실행안)이 남은 높이 안에 들어가는 가장 큰 글씨
  const plan = poster.querySelector('.p-plan');
  if (plan) {
    let size = PLAN_MAX, act = ACT_MAX;
    const set = () => { poster.style.setProperty('--plan', size + 'pt'); poster.style.setProperty('--act', act + 'pt'); };
    set();
    // 과제 글씨를 PLAN_KEEP까지 먼저 줄이고, 그래도 넘치면 실행안 글씨, 마지막으로 과제 글씨를 더 줄인다
    while ((size > PLAN_MIN || act > ACT_MIN) && plan.scrollHeight > plan.clientHeight + 1) {
      if (size > PLAN_KEEP) size -= 2;
      else if (act > ACT_MIN) act -= 2;
      else size -= 2;
      set();
    }
  }
  const cols = [...poster.querySelectorAll('.p-sec')];
  if (!cols.length) return;
  // 칸이 넘치지 않고, 포스트잇 한 장 한 장 안에서도 글이 넘치지 않는 크기
  const stickies = [...poster.querySelectorAll('.p-sticky')];
  const fits = () => cols.every(c => c.scrollHeight <= c.clientHeight + 1) && stickies.every(s => s.scrollHeight <= s.clientHeight + 1);
  let size = STICKY_MAX;
  poster.style.setProperty('--sticky', size + 'pt');
  while (size > STICKY_MIN && !fits()) {
    size -= 2;
    poster.style.setProperty('--sticky', size + 'pt');
  }
}

function fitPoster() {
  const frame = $('#pFrame'), box = $('#pScale');
  if (!frame || !box) return;
  const poster = box.firstElementChild;
  const scale = frame.clientWidth / poster.offsetWidth;
  box.style.transform = `scale(${scale})`;
  frame.style.height = poster.offsetHeight * scale + 'px';
}
window.addEventListener('resize', () => {
  fitPoster();
  if (S.built.startsWith('board:')) renderLivePreview();
});

// 전지의 포스트잇 줄: 원인(q1)은 미션 박스 바로 아래 한 줄, 실행안(q3)은 핵심 과제 아래 4장씩 두 줄
// 질문마다 pinMax 칸짜리 같은 크기 판. 고른 포스트잇이 적어도 칸 자리는 그대로 둔다
function posterSection(teamId, qid, num) {
  const q = QUESTIONS.find(x => x.id === qid);
  if (!q || !pinMaxOf(qid)) return '';
  const pins = pinsOf(teamId, qid);
  const notes = S.teams[teamId]?.notes || {};
  const body = !pins.length
    ? '<div class="p-empty">📌 전지에 붙일 포스트잇을 골라 주세요</div>'
    : pinSlotsFor(qid).map((_, k) => {
      if (!pins[k]) return '<div class="p-slot"></div>';
      // 실행안은 아래 줄에 이어진 핵심 과제 번호(전지 가운데와 같은 색) + 쓴 사람 이름
      const n = notes[pins[k].note], ln = qid === 'q3' ? linkOf(teamId, n) : null;
      const foot = qid === 'q3'
        ? `<em>${ln?.num ? `<i style="--c:${ln.color}">${ln.num}</i>` : '<i class="none"></i>'}<b>${esc(n?.name || '')}</b></em>` : '';
      return `<div class="p-sticky ${qid}"><span>${br(pins[k].text)}</span>${foot}</div>`;
    }).join('');
  return `
    <div class="p-sec ${qid}">
      <div class="p-q"><span>${num}</span>${esc(q.poster || q.short)}</div>
      <div class="p-stickies">${body}</div>
    </div>`;
}

// 전지에 붙인 실행안(q3)을 이어진 핵심 과제별로 모은다. 전지 밖 과제·과제 없음은 null 묶음
function actsByPlan(teamId) {
  const notes = S.teams[teamId]?.notes || {};
  const map = new Map();
  for (const pin of pinsOf(teamId, 'q3')) {
    const n = notes[pin.note], ln = linkOf(teamId, n);
    const key = ln?.num ? ln.plan.id : null;
    if (!map.has(key)) map.set(key, []);
    // 과제 아래에 모이니 앞머리 "[과제 이름]"은 뺀다
    map.get(key).push({ text: String(pin.text).replace(/^\s*\[[^\]]*\]\s*/, '') || pin.text, name: n?.name || '', meta: actMeta(n) });
  }
  return map;
}
// 실행안 카드: 왼쪽 띠는 과제 색, 바탕은 그 색을 아주 옅게 (PDF에서도 같은 색이 나오게 직접 섞는다)
const tint = (hex, a) => {
  const v = parseInt(hex.slice(1), 16), mix = c => Math.round(c * a + 255 * (1 - a));
  return `rgb(${mix(v >> 16)}, ${mix((v >> 8) & 255)}, ${mix(v & 255)})`;
};
function actsHtml(list, color) {
  if (!list?.length) return '';
  return `<div class="p-acts">${list.map(a => `<span class="p-act" style="border-left-color:${color};background:${tint(color, .12)}"><span>${esc(a.text)}${a.meta ? `<small>${esc(a.meta)}</small>` : ''}</span>${a.name ? `<b>${esc(a.name)}</b>` : ''}</span>`).join('')}</div>`;
}

function posterHtml(teamId) {
  const t = teamOf(teamId);
  if (!t) return '<div class="poster"></div>';
  const c = S.meta.company || {};
  const plans = posterPlansOf(teamId);
  const members = membersOf(teamId);
  const colors = PLAN_COLORS;
  const cq = questOf(''), tq = questOf(teamId);
  const acts = actsByPlan(teamId);
  return `
    <div class="poster" style="--sticky:${STICKY_MAX}pt;--plan:${PLAN_MAX}pt">
      <h1 class="p-title"><span class="p-team">${esc(t.name)}</span>목표 달성 실행 계획</h1>
      <div class="p-missions">
        <div class="p-m">
          <b>${esc(c.name || '에고이즘')}의 미션</b><p>${br(c.mission)}</p>
          ${questHtml(cq, 'p-quest', '2026 전사 퀘스트')}
        </div>
        <div class="p-m">
          ${t.deptMission ? `<b>${esc(t.dept || '부서')}의 미션</b><p>${br(t.deptMission)}</p>` : ''}
          ${t.mission ? `<b>${esc(t.name)}의 미션</b><p class="${t.deptMission ? 'mid' : ''}">${br(t.mission)}</p>` : ''}
          ${!t.deptMission && !t.mission ? `<b>${esc(t.name)}의 미션</b><p class="sm">(미션을 정하는 중이에요)</p>` : ''}
          ${questHtml(tq, 'p-quest', '2026 팀 퀘스트')}
          ${(() => {
            // 원인 분석용 월 평균은 포스트잇 칸 대신 팀 퀘스트 아래에 한 줄로 (포스트잇 칸 높이를 맞추려고)
            const mo = monthlyOf(teamId);
            return mo ? `<div class="p-avg"><span>지금까지 월 평균 <b class="${mo.avg < mo.need ? 'bad' : 'good'}">${fmtEok(mo.avg)}</b></span><span>달성하려면 필요했던 월 평균 <b>${fmtEok(mo.need)}</b></span></div>` : '';
          })()}
          ${mustWinLine(teamId, 'p-must')}
        </div>
      </div>
      ${S.posterNotes ? posterSection(teamId, 'q1', 1) : ''}
      <div class="p-plan">
        <h2>${esc(PLAN.title)}</h2>
        <ol>
          ${plans.map((p, i) => `
            <li style="--c:${colors[i % colors.length]}">
              <span class="p-n">${i + 1}</span>
              <div><div class="p-what">${esc(p.what)}</div>
              ${S.posterNotes ? actsHtml(acts.get(p.id), colors[i % colors.length]) : ''}</div>
            </li>`).join('') || '<li class="empty">🖼 전지에 넣을 핵심 과제를 골라 주세요</li>'}
        </ol>
        ${S.posterNotes && acts.get(null)?.length ? `<div class="p-etc"><b>그 밖의 실행안</b>${actsHtml(acts.get(null), '#9ca3af')}</div>` : ''}
      </div>
      <div class="p-sign"><b>함께한 사람</b>${members.map(m => `<span>${esc(m.name)}</span>`).join('')}</div>
    </div>`;
}

// ── 미션 편집 (진행자) ──────────────────────────────────────
function buildMissionsEditor() {
  const m = S.meta || { company: {}, teams: {} };
  const c = m.company || {};
  const rows = teamList();
  const body = `
    <section class="editor">
      <h1>미션 편집</h1>
      <p class="sub">여기 적은 내용은 파이어베이스에만 저장되고 깃허브 코드에는 남지 않아요.</p>
      <div class="ed-block">
        <h3>회사</h3>
        <label class="field">이름<input id="cName" value="${esc(c.name || '에고이즘')}"></label>
        <label class="field">미션<textarea id="cMission" rows="2">${esc(c.mission)}</textarea></label>
        <div class="quest-row">
          <label class="field">2026 전사 퀘스트 목표 (억)<input id="qcTarget" type="number" step="0.1" min="0" value="${esc(m.quests?.company?.target ?? '')}"></label>
          <label class="field">달성 (억)<input id="qcActual" type="number" step="0.1" min="0" value="${esc(m.quests?.company?.actual ?? '')}"></label>
          <label class="field">기준 (예: 9월)<input id="qAsOf" value="${esc(m.questAsOf || '')}" placeholder="9월"></label>
          <label class="field">🔥 12월 말 필사즉생 월 매출 (억)<input id="mwCompany" type="number" step="0.1" min="0" value="${esc(m.mustWin?.company ?? '')}"></label>
        </div>
        <p class="sub">회사 목표는 운영부서·그로스·CEO실 팀에도 같이 쓰여요. 브랜드처럼 따로 목표가 있는 팀은 아래 팀 줄에 적어요. 매달 손익이 나오면 숫자만 고치고 저장하면 돼요.</p>
        <label class="field">워크샵 전체 참가 인원 (접속 현황 'n / 전체'에 쓰여요)<input id="cExpected" type="number" min="0" value="${esc(m.expected ?? '')}"></label>
        <label class="field">팀 인원 집계에서 뺄 이름 (쉼표로 구분, 전체 접속 인원에는 들어가요)<input id="cUncounted" value="${esc((m.uncounted || []).join(', '))}" placeholder="예: 박정균"></label>
      </div>
      <div class="ed-block">
        <h3>팀 <small>순서대로 화면에 나와요</small></h3>
        <div id="teamRows">${rows.map(teamRow).join('')}</div>
        <button class="btn" id="addTeam">+ 팀 추가</button>
      </div>
      <div class="ed-actions"><button class="btn primary big" id="saveMeta">저장</button></div>
      <details class="ed-block">
        <summary>JSON으로 한 번에 넣기</summary>
        <p class="sub">missions.local.json 내용을 붙여 넣고 ‘JSON 저장’을 누르면 위 내용을 통째로 바꿔요.</p>
        <textarea id="metaJson" rows="8">${esc(S.meta ? JSON.stringify(S.meta, null, 2) : '')}</textarea>
        <button class="btn" id="saveJson">JSON 저장</button>
      </details>
      ${S.meta ? `
      <div class="ed-block">
        <h3>샘플 데이터 <small>A1 전지가 어떻게 나오는지 미리 볼 때</small></h3>
        <p class="sub">팀마다 포스트잇·핵심 과제·이름(홍길동 등 가짜 이름)을 채워요. 샘플만 골라서 지울 수 있고, 사람들이 적은 내용은 그대로 남아요.</p>
        <textarea id="sampleJson" rows="4" placeholder="sample.local.json 내용을 여기에 붙여 넣어요 (내 컴퓨터 미리보기에서는 비워 둬도 돼요)"></textarea>
        <div class="row-btns">
          <button class="btn" id="seedSample">샘플 넣기</button>
          <button class="btn ghost" id="clearSample">샘플 지우기</button>
        </div>
      </div>
      <div class="ed-block">
        <h3>접속 기록 <small>A1 전지 '함께한 사람'에 찍히는 이름</small></h3>
        <p class="sub">리허설·시험으로 들어왔던 이름을 지워요. 포스트잇·핵심 과제는 그대로 남고, 샘플 이름은 '샘플 지우기'로 따로 지워요. 지금 화면을 열어 둔 사람은 다시 열면 이름이 다시 올라가요.</p>
        <p class="sub" id="memberList"></p>
        <div class="row-btns"><button class="btn ghost" id="clearMembers">접속 기록 지우기</button></div>
      </div>` : ''}
    </section>`;
  if (S.meta) shell(body); else app.innerHTML = `<main id="main">${body}</main>`;

  $('#addTeam').onclick = () => $('#teamRows').insertAdjacentHTML('beforeend', teamRow({ id: 't' + Date.now().toString(36), name: '', dept: '', deptMission: '', mission: '' }));
  if (S.meta) {
    $('#seedSample').onclick = seedSample;
    $('#clearSample').onclick = clearSample;
    $('#clearMembers').onclick = clearMembers;
    const names = realMembers();
    $('#memberList').textContent = names.length
      ? `지금 기록 ${names.length}명: ${names.map(m => `${teamOf(m.tid)?.name || m.tid} ${m.name}`).join(', ')}`
      : '지금 남아 있는 접속 기록이 없어요.';
  }
  $('#teamRows').onclick = e => { if (e.target.dataset.act === 'row-del' && confirm('이 팀을 목록에서 뺄까요? (이미 적은 포스트잇은 저장소에 남아요)')) e.target.closest('.trow').remove(); };
  $('#saveMeta').onclick = async () => {
    const teams = {};
    const quests = {};
    const num = el => (el.value.trim() === '' ? null : +el.value);
    const mustWin = {};
    if (num($('#qcTarget'))) quests.company = { target: num($('#qcTarget')), actual: num($('#qcActual')) || 0 };
    if (num($('#mwCompany'))) mustWin.company = num($('#mwCompany'));
    app.querySelectorAll('.trow').forEach((r, i) => {
      const name = $('.tName', r).value.trim();
      if (!name) return;
      teams[r.dataset.id] = {
        name, order: i,
        expected: +$('.tExpected', r).value || 0,
        dept: $('.tDept', r).value.trim(),
        deptMission: $('.tDeptMission', r).value.trim(),
        mission: $('.tMission', r).value.trim()
      };
      const target = num($('.tqTarget', r));
      if (target) quests[r.dataset.id] = { target, actual: num($('.tqActual', r)) || 0 };
      const mw = num($('.tMustWin', r));
      if (mw) mustWin[r.dataset.id] = mw;
    });
    const ok = await save(store.set('meta', {
      expected: +$('#cExpected').value || 0,
      uncounted: $('#cUncounted').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      questAsOf: $('#qAsOf').value.trim(),
      quests,
      mustWin,
      company: { name: $('#cName').value.trim(), mission: $('#cMission').value.trim() },
      teams
    }));
    if (ok) toast('저장했어요');
  };
  $('#saveJson').onclick = async () => {
    try {
      const v = JSON.parse($('#metaJson').value);
      if (!v.company || !v.teams) throw new Error();
      if (!(await save(store.set('meta', v)))) return;
      S.built = '';
      toast('저장했어요');
      render();
    } catch { toast('JSON 모양이 맞지 않아요. company 와 teams 가 있어야 해요'); }
  };
}

// 샘플: 옆 폴더 sample.local.json (깃허브에 올리지 않는 파일) 을 읽어 팀마다 채운다.
// 모든 샘플에는 sample: true 가 붙어 있어서 '샘플 지우기'로 그것만 지운다.
// 붙여 넣은 내용이 있으면 그걸 쓰고, 없으면 옆 폴더 파일을 찾아본다.
async function seedSample() {
  let src;
  const pasted = $('#sampleJson')?.value.trim();
  try {
    if (pasted) {
      src = JSON.parse(pasted);
    } else {
      const res = await fetch('../sample.local.json', { cache: 'no-store' });
      if (!res.ok) throw new Error();
      src = await res.json();
    }
    if (typeof src !== 'object' || Array.isArray(src)) throw new Error();
  } catch {
    return toast(pasted ? '샘플 JSON 모양이 맞지 않아요' : '아래 칸에 sample.local.json 내용을 붙여 넣고 다시 눌러 주세요');
  }
  // 예전 샘플이 남아 있으면 먼저 지운다. 남겨 두면 같은 이름의 포스트잇만 새 글로 바뀌고
  // 전지 자리·핵심 과제는 예전 것이 남아서 번호가 엇갈린다 (찬 자리는 규칙상 덮어쓸 수 없어 따로 먼저 지움)
  const old = sampleCleanup(Object.keys(src).filter(teamOf));
  if (Object.keys(old).length) {
    try { await store.update('teams', old); }
    catch (err) { console.error(err); return toast('예전 샘플을 지우지 못했어요. 진행자 로그인을 확인해 주세요'); }
  }
  const kept = (path, v) => v && !(path in old); // 지금 지운 샘플 자리는 빈 자리로 본다
  const t0 = now() - 3600000;
  const up = {};
  for (const [tid, s] of Object.entries(src)) {
    if (!teamOf(tid)) continue;
    (s.members || []).forEach((name, i) => { up[`${tid}/members/s${i}`] = { name, ts: t0 + i, sample: true }; });
    for (const q of QUESTIONS) {
      const list = s[q.id] || [];
      // 샘플 한 장 = [글, 공감 수, 쓴 사람(없으면 팀원 중 차례로), (실행안만) 과제 번호, 마감일, 확인할 지표]
      list.forEach(([text, likes = 0, by, , when, metric], i) => {
        const l = {};
        for (let k = 0; k < likes; k++) l['s' + k] = true;
        up[`${tid}/notes/s_${q.id}_${i}`] = { q: q.id, text, name: by || s.members[(i + 1) % s.members.length], uid: 'sample', ts: t0 + 1000 * i, likes: l, sample: true, ...(when ? { when } : {}), ...(metric ? { metric } : {}) };
      });
      // 공감 많은 순으로 전지에 붙여 둔다. 이미 찬 자리(사람이 붙인 것)는 건드리지 않고 빈 자리에만
      // (규칙이 찬 자리 덮어쓰기를 막아서, 하나라도 겹치면 샘플 전체가 저장되지 않는다)
      const usedPins = Object.fromEntries(Object.entries(S.teams[tid]?.pins?.[q.id] || {}).filter(([k, v]) => kept(`${tid}/pins/${q.id}/${k}`, v)));
      const room = Math.max(0, pinMaxOf(q.id) - Object.keys(usedPins).length);
      const freePins = PIN_SLOTS.filter(k => !usedPins[k]).slice(0, room);
      const pinnedNotes = new Set(Object.values(usedPins).map(p => p?.note));
      list.map(([text, likes = 0], i) => ({ text, likes, i, note: `s_${q.id}_${i}` }))
        .filter(p => !pinnedNotes.has(p.note))
        .sort((a, b) => b.likes - a.likes)
        .slice(0, freePins.length)
        .forEach((p, k) => {
          up[`${tid}/pins/${q.id}/${freePins[k]}`] = { note: p.note, text: p.text.slice(0, PIN_LEN), ts: t0 + k, by: 'sample', sample: true };
        });
    }
    // 핵심 과제도 빈 자리에만. 샘플 한 줄 = [핵심 과제, 담당, 기한, 확인할 지표]
    // n번째 과제는 팀 전략 n번째 아이디어(s_q2_n)에서 올린 것으로 잇는다
    const usedPlan = S.teams[tid]?.plan || {};
    const freePlan = PLAN_SLOTS.filter(k => !kept(`${tid}/plan/${k}`, usedPlan[k]));
    let posterRoom = PLAN.posterMax - posterPlansOf(tid).filter(p => !(`${tid}/plan/${p.id}` in old)).length;
    (s.plan || []).slice(0, freePlan.length).forEach((row, i) => {
      const v = {};
      PLAN.fields.forEach((f, k) => { v[f.key] = String(row[k] || '').slice(0, f.max); });
      const onPoster = posterRoom-- > 0;
      const from = (s.q2 || [])[i] ? { from: `s_q2_${i}` } : {};
      if (isPlan(v)) up[`${tid}/plan/${freePlan[i]}`] = { ...v, ...from, onPoster, name: '샘플', uid: 'sample', ts: t0 + i, order: t0 + i, sample: true };
    });
    // 샘플 실행안 = [글, 공감, 쓴 사람, 이어진 과제 번호(0부터)]. 번호가 없으면 "[결산] …"처럼
    // 앞머리 말이 과제 이름에 들어간 첫 핵심 과제와 잇는다
    (s.q3 || []).forEach(([text, , , idx], i) => {
      const key = String(text).match(/^\[([^\]]+)\]/)?.[1]?.trim();
      const j = Number.isInteger(idx) ? idx : key ? (s.plan || []).findIndex(row => String(row[0] || '').includes(key)) : -1;
      const note = up[`${tid}/notes/s_q3_${i}`];
      if (note && j >= 0 && j < freePlan.length && up[`${tid}/plan/${freePlan[j]}`]) Object.assign(note, { plan: freePlan[j], planTs: t0 + j });
    });
  }
  try {
    await store.update('teams', up);
    toast('샘플을 넣었어요. 예전 샘플은 지우고, 사람이 쓴 자리는 그대로 두었어요');
  } catch (err) {
    console.error(err);
    toast('샘플을 넣지 못했어요. 진행자 로그인과 파이어베이스 규칙 게시를 확인해 주세요');
  }
}

async function clearSample() {
  if (!confirm('샘플로 넣은 내용만 지울까요? (사람들이 적은 내용은 남아요)')) return;
  const up = sampleCleanup(Object.keys(S.teams));
  if (!Object.keys(up).length) return toast('지울 샘플이 없어요');
  if (await save(store.update('teams', up))) toast('샘플을 지웠어요');
}

// 사람이 들어와서 남은 접속 기록(샘플 이름 제외) — 전지 '함께한 사람'에 찍히는 이름
const realMembers = () => Object.entries(S.teams || {}).flatMap(([tid, d]) =>
  Object.entries(d?.members || {}).filter(([, m]) => m && !m.sample).map(([id, m]) => ({ tid, id, name: m.name })));

async function clearMembers() {
  const list = realMembers();
  if (!list.length) return toast('지울 접속 기록이 없어요');
  if (!confirm(`접속 기록 ${list.length}명을 지울까요?\n${list.map(m => `${teamOf(m.tid)?.name || m.tid} ${m.name}`).join(', ')}\n\n포스트잇·핵심 과제는 그대로 남아요.`)) return;
  const up = {};
  for (const m of list) up[`${m.tid}/members/${m.id}`] = null;
  if (await save(store.update('teams', up))) { toast('접속 기록을 지웠어요'); buildMissionsEditor(); }
}

// 팀들의 샘플 흔적을 지우는 경로 묶음 { 'gulgang/notes/s_q1_0': null, … }
function sampleCleanup(teamIds) {
  const up = {};
  for (const tid of teamIds) {
    const d = S.teams[tid] || {};
    for (const part of ['notes', 'plan', 'agree', 'members']) {
      for (const [id, v] of Object.entries(d[part] || {})) if (v?.sample) up[`${tid}/${part}/${id}`] = null;
    }
    for (const [q, slots] of Object.entries(d.pins || {})) {
      // 샘플 자리 + 사람이 샘플 포스트잇에 붙인 자리 (포스트잇이 지워지면 버려진 자리가 되므로 같이 지운다)
      for (const [slot, v] of Object.entries(slots || {})) {
        if (v?.sample || d.notes?.[v?.note]?.sample) up[`${tid}/pins/${q}/${slot}`] = null;
      }
    }
    // 샘플 포스트잇에서 만든 실행 계획도 같이 (포스트잇을 지우면 그 계획도 지우는 것과 같은 기준)
    for (const [id, p] of Object.entries(d.plan || {})) {
      if (!p?.sample && p?.from && d.notes?.[p.from]?.sample) up[`${tid}/plan/${id}`] = null;
    }
  }
  return up;
}

function teamRow(t) {
  return `
    <div class="trow" data-id="${esc(t.id)}">
      <div class="tcol">
        <input class="tName" placeholder="팀 이름" value="${esc(t.name)}">
        <input class="tDept" placeholder="부서 (예: 운영부서)" value="${esc(t.dept)}">
        <label class="tExp">참가 인원 <input class="tExpected" type="number" min="0" value="${esc(t.expected ?? '')}">명</label>
      </div>
      <textarea class="tDeptMission" rows="2" placeholder="부서 미션">${esc(t.deptMission)}</textarea>
      <textarea class="tMission" rows="2" placeholder="팀·브랜드 미션 (없으면 비워 두기)">${esc(t.mission)}</textarea>
      <div class="tcol">
        <label class="tExp">팀 퀘스트 목표 <input class="tqTarget" type="number" step="0.1" min="0" value="${esc(S.meta?.quests?.[t.id]?.target ?? '')}">억</label>
        <label class="tExp">달성 <input class="tqActual" type="number" step="0.1" min="0" value="${esc(S.meta?.quests?.[t.id]?.actual ?? '')}">억</label>
        <label class="tExp">🔥 필사즉생 월 <input class="tMustWin" type="number" step="0.1" min="0" value="${esc(S.meta?.mustWin?.[t.id] ?? '')}">억</label>
        <span class="lbl">퀘스트를 비우면 회사 목표·필사즉생과 같아요. 퀘스트가 따로 있는 팀은 필사즉생도 따로 적어요</span>
      </div>
      <button class="link" data-act="row-del">빼기</button>
    </div>`;
}

// ── 클릭·입력 처리 ──────────────────────────────────────────
// 참가자는 자기 팀 전지만 고칠 수 있다 (다른 팀 전지는 '전체 팀'에서 구경만). 진행자는 모든 팀
const EDIT_ACTS = new Set(['pick-plan', 'relink', 'like', 'promote', 'edit', 'del', 'pin', 'unpin', 'plan-edit', 'plan-del', 'plan-up', 'plan-down', 'plan-poster']);
const canEditTeam = () => S.admin || S.team === me.team;

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act], [data-view]');
  if (!el || !store) return;
  if (el.dataset.view) {
    if (el.dataset.view === 'board') return go('board', me.team || S.team); // '우리 팀 전지'는 항상 내 팀으로
    return go(el.dataset.view);
  }
  const act = el.dataset.act;
  if (EDIT_ACTS.has(act) && !canEditTeam()) return toast('다른 팀 전지는 볼 수만 있어요');
  const teamPath = `teams/${S.team}`;
  const noteId = el.closest('.note')?.dataset.id;
  const planId = el.dataset.plan || el.closest('#plan li')?.dataset.id;
  const note = noteId && isNote(S.teams[S.team]?.notes?.[noteId]) ? S.teams[S.team].notes[noteId] : null;

  switch (act) {
    case 'change-me': S.joining = true; S.built = ''; return render();
    case 'login': return openLogin();
    case 'logout': return store.signOut();
    case 'open-team': return go('board', el.dataset.team);

    // 포스트잇을 누르는 사이 다른 사람이 지웠을 수 있다 → 지워진 포스트잇에는 아무것도 쓰지 않는다
    case 'like':
      if (!note) return;
      return save(store.set(`${teamPath}/notes/${noteId}/likes/${uid}`, note.likes?.[uid] ? null : true));
    case 'pick-plan': {
      const p = posterPlansOf(S.team).find(x => x.id === el.dataset.id);
      pickPlan = !p || pickPlan?.id === p.id ? null : { id: p.id, ts: p.ts };
      renderPlanPick();
      if (pickPlan) $('.composer[data-q="q3"] textarea')?.focus();
      return;
    }
    case 'relink': {
      if (!note) return;
      if (!pickPlan) return toast('3번 칸 위에서 바꿀 핵심 과제를 먼저 고르고 눌러 주세요');
      return save(store.update(`${teamPath}/notes/${noteId}`, { plan: pickPlan.id, planTs: pickPlan.ts }));
    }
    case 'promote': {
      if (!note || isPromoted(S.team, noteId)) return;
      if (plansOf(S.team).length >= PLAN.max) return toast(`핵심 과제는 ${PLAN.max}개까지예요. 하나를 고치거나 지워 주세요`);
      const v = await planDialog('핵심 과제로 올리기', { what: note.text });
      if (v) await addPlan(v, noteId);
      return;
    }
    case 'edit': {
      if (!note) return;
      const before = note.text;
      // 내 실행안은 할 일·마감일·확인할 지표를 한 창에서 고친다
      const isAct = note.q === 'q3';
      const v = isAct ? await planDialog('내 실행안 고치기', note, [ACT_TEXT, ...ACT.fields]) : null;
      const text = isAct ? v?.text : await editText('포스트잇 고치기', before);
      if (!text || (!isAct && text === before)) return;
      if (!S.teams[S.team]?.notes?.[noteId]) return toast('그사이 이 포스트잇이 지워졌어요');
      const up = { [`notes/${noteId}/text`]: text };
      if (isAct) for (const f of ACT.fields) up[`notes/${noteId}/${f.key}`] = v[f.key];
      // 전지에 붙어 있고 전지 글이 원래 포스트잇과 같았다면 전지 글도 같이 고친다 (한 번에 저장)
      const slot = pinSlotOf(S.team, note.q, noteId);
      const pin = slot && S.teams[S.team].pins[note.q][slot];
      if (pin && pin.text === before) {
        if (text.length <= PIN_LEN) up[`pins/${note.q}/${slot}/text`] = text;
        else toast(`전지에는 ${PIN_LEN}자까지라 전지에 붙은 글은 그대로예요. 바꾸려면 떼고 다시 붙여 주세요`);
      }
      return save(store.update(teamPath, up));
    }
    case 'del': {
      if (!note) return;
      // 이 포스트잇으로 만든 실행 계획도 같이 지운다 (지우기 전에 알려 준다)
      const linkedPlans = Object.entries(S.teams[S.team]?.plan || {}).filter(([, p]) => p?.from === noteId);
      const msg = linkedPlans.length
        ? `이 포스트잇을 지울까요?\n이 포스트잇으로 만든 핵심 과제 ${linkedPlans.length}개도 함께 지워져요.`
        : '이 포스트잇을 지울까요?';
      if (!confirm(msg)) return;
      // 포스트잇·전지 자리·실행 계획을 한 번에 지운다 (일부만 지워지는 일이 없게)
      const up = { [`notes/${noteId}`]: null };
      for (const slot of PIN_SLOTS) {
        if (S.teams[S.team]?.pins?.[note.q]?.[slot]?.note === noteId) up[`pins/${note.q}/${slot}`] = null;
      }
      for (const [id] of linkedPlans) up[`plan/${id}`] = null;
      return save(store.update(teamPath, up));
    }
    case 'pin':
      if (note) await pinNote(note, noteId);
      return;
    case 'unpin':
      if (!note) return;
      return save(store.remove(`${teamPath}/pins/${note.q}/${el.dataset.slot}`));

    case 'plan-edit': {
      const p = S.teams[S.team]?.plan?.[planId];
      if (!p) return;
      const v = await planDialog('핵심 과제 고치기', p);
      if (!v) return;
      if (!S.teams[S.team]?.plan?.[planId]) return toast('그사이 이 과제가 지워졌어요');
      return save(store.update(`${teamPath}/plan/${planId}`, v));
    }
    case 'plan-poster': {
      const p = S.teams[S.team]?.plan?.[planId];
      if (!p) return;
      const on = posterPlansOf(S.team).some(x => x.id === planId);
      if (!on && posterPlansOf(S.team).length >= PLAN.posterMax) return toast(`전지에는 ${PLAN.posterMax}개까지 넣을 수 있어요. 하나를 빼고 넣어 주세요`);
      return save(store.update(`${teamPath}/plan/${planId}`, { onPoster: !on }));
    }
    case 'plan-del':
      // 2번 칸 포스트잇은 그대로 남고, 핵심 과제만 빠진다. 이어진 실행안은 '이어진 핵심 과제가 없어요'로 바뀐다
      if (planId && confirm('이 핵심 과제를 뺄까요?\n2번 칸 포스트잇은 그대로 남아요. 이 과제와 이어진 실행안은 다시 과제를 골라야 해요.')) save(store.remove(`${teamPath}/plan/${planId}`));
      return;
    case 'plan-up':
    case 'plan-down': {
      const list = plansOf(S.team);
      const i = list.findIndex(p => p.id === planId);
      const j = act === 'plan-up' ? i - 1 : i + 1;
      if (i < 0 || !list[j]) return;
      const oi = list[i].order ?? list[i].ts, oj = list[j].order ?? list[j].ts;
      return save(store.update(`${teamPath}/plan`, { [`${list[i].id}/order`]: oj, [`${list[j].id}/order`]: oi === oj ? oi + 1 : oi }));
    }

    // 진행자 타이머
    case 'stage': {
      const step = +el.dataset.step;
      startStep(step);
      // 접속 안내 단계는 QR을, 나머지는 그 단계 안내를 화면 가운데에 크게
      if ($('#guideOverlay')) $('#guideOverlay').hidden = true;
      if (step === 0) openJoinOverlay(); else openGuide(step);
      return;
    }
    case 'join-qr': return openJoinOverlay();
    case 'join-qr-close': $('#joinOverlay').hidden = true; return;
    case 'guide': return openGuide(Math.max(1, S.stage?.step ?? 1));
    case 'guide-go': return openGuide(+el.dataset.step);
    case 'guide-close': $('#guideOverlay').hidden = true; return;
    case 'phase-jump': {
      // 구간 상자를 누르면 그 구간 처음부터 타이머를 다시 흘린다 (설명이 일찍 끝났을 때 다음 구간으로 넘기기)
      // 남은 시간 = 그 구간부터 끝까지의 시간. 앞에서 아낀 시간은 단계 전체에서 줄어든다
      if (!S.admin) return;
      const step = +el.dataset.step, k = +el.dataset.k;
      const list = phasesOf(AGENDA[step]);
      const rest = list.slice(k).reduce((s, p) => s + p.min, 0) * 60000;
      if (S.stage?.step !== step) return toast('이 단계를 먼저 시작해 주세요');
      if (S.stage.pausedLeft != null) return save(store.set('stage', { step, pausedLeft: rest }));
      return save(store.set('stage', { step, endsAt: now() + rest }));
    }
    case 'stage-prev': return startStep(Math.max(0, (S.stage?.step ?? 1) - 1));
    case 'stage-next': return startStep(Math.min(AGENDA.length - 1, (S.stage?.step ?? -1) + 1));
    case 'stage-plus': {
      const st = S.stage;
      if (st?.endsAt) return save(store.update('stage', { endsAt: st.endsAt + 60000 }));
      if (st?.pausedLeft != null) return save(store.update('stage', { pausedLeft: st.pausedLeft + 60000 }));
      return;
    }
    case 'stage-pause': {
      const st = S.stage;
      if (st?.endsAt) return save(store.set('stage', { step: st.step, pausedLeft: st.endsAt - now() }));
      if (st?.pausedLeft != null) return save(store.set('stage', { step: st.step, endsAt: now() + st.pausedLeft }));
      return;
    }
    case 'stage-reset': return save(store.remove('stage'));
    case 'copy-link': {
      const link = participantLink();
      try { await navigator.clipboard.writeText(link); toast('참가자 링크를 복사했어요'); }
      catch { prompt('이 링크를 복사해 주세요', link); }
      return;
    }
    case 'backup': return backup();
  }
});

function startStep(i) {
  if (!AGENDA[i]) return;
  save(store.set('stage', { step: i, endsAt: now() + AGENDA[i].minutes * 60000 }));
}

function backup() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), meta: S.meta, teams: S.teams }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `워크샵_백업_${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.addEventListener('submit', e => {
  // 실행 계획 직접 입력 (네 칸 모두 required 라서 빈칸이면 브라우저가 먼저 막는다)
  if (e.target.id === 'planComposer') {
    e.preventDefault();
    if (!S.team) return;
    if (!canEditTeam()) return toast('다른 팀 전지는 볼 수만 있어요');
    const form = e.target, v = {};
    for (const f of PLAN.fields) v[f.key] = form.elements[f.key].value.trim();
    addPlan(v).then(ok => { if (ok) { form.reset(); form.elements[PLAN.fields[0].key].focus(); } });
    return;
  }
  const form = e.target.closest('.composer');
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector('textarea');
  const text = input.value.trim();
  if (!text || !S.team) return;
  if (!canEditTeam()) return toast('다른 팀 전지는 볼 수만 있어요');
  // 내 실행안은 마감일·확인할 지표까지 적어야 붙는다 (담당자 = 쓴 사람)
  const extra = {};
  if (form.dataset.q === 'q3') {
    for (const f of ACT.fields) {
      const el = form.elements[f.key];
      extra[f.key] = el.value.trim().slice(0, f.max);
      if (!extra[f.key]) { toast(`${f.label}도 적어 주세요`); el.focus(); return; }
    }
  }
  // 내 실행안은 어느 핵심 과제를 위한 일인지 골라야 붙는다 (전지에 넣은 과제가 아직 없으면 그냥 붙인다)
  const link = {};
  if (form.dataset.q === 'q3' && posterPlansOf(S.team).length) {
    if (!pickPlan) {
      toast('어느 핵심 과제를 위한 일인지 위에서 먼저 골라 주세요');
      const box = $('#planPick');
      box?.classList.remove('nudge'); void box?.offsetWidth; box?.classList.add('nudge');
      return;
    }
    Object.assign(link, { plan: pickPlan.id, planTs: pickPlan.ts });
  }
  store.push(`teams/${S.team}/notes`, { q: form.dataset.q, text, name: me.name || '진행자', uid, ts: now(), ...link, ...extra });
  form.querySelectorAll('textarea, input').forEach(x => { x.value = ''; });
  // 다음 실행안이 엉뚱한 과제에 붙지 않게, 붙이고 나면 과제 선택을 비운다
  if (form.dataset.q === 'q3' && pickPlan) { pickPlan = null; renderPlanPick(); }
  input.focus();
});

// 포스트잇 칸: Enter = 붙이기, Shift+Enter = 줄바꿈 (한글 입력 중 Enter는 무시)
document.addEventListener('keydown', e => {
  if (e.target.matches('.composer textarea') && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    // 내 실행안: 마감일·확인할 지표 칸이 비어 있으면 그 칸으로 넘어간다
    const empty = [...e.target.form.querySelectorAll('.act-fields input')].find(x => !x.value.trim());
    if (empty) return empty.focus();
    e.target.form.requestSubmit();
  }
});
