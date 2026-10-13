import { createStore } from './store.js';
import { FIREBASE_CONFIG, EVENT, AGENDA, QUESTIONS, PLAN } from './config.js';

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
    ${step != null && (AGENDA[step]?.ask || AGENDA[step]?.silent) ? `
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
  if (left == null) { el.textContent = '--:--'; el.className = 'timer'; return; }
  // 단계 시작 뒤 처음 몇 분은 '혼자 쓰기', 그다음은 '함께 이야기'
  const mode = $('#stageMode'), a = AGENDA[st.step];
  if (mode && a?.silent) {
    const soloLeft = left - (a.minutes - a.silent) * 60000;
    if (soloLeft > 0) {
      const s = Math.ceil(soloLeft / 1000);
      mode.textContent = `🤫 혼자 쓰는 시간 ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      mode.className = 'mode solo';
    } else {
      mode.textContent = '🗣 함께 이야기하고 📌 고르기';
      mode.className = 'mode talk';
    }
  }
  const over = left < 0;
  const sec = Math.floor(Math.abs(left) / 1000);
  const t = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  el.textContent = over ? `+${t} 초과` : t;
  el.className = 'timer' + (over ? ' over' : left < 60000 ? ' soon' : '') + (st.pausedLeft != null ? ' paused' : '');
}

// 지금 단계의 칸을 강조하고, 나머지 칸은 살짝 흐리게 한다
function markFocus() {
  const focus = AGENDA[S.stage?.step]?.focus;
  let any = false;
  document.querySelectorAll('[data-focus]').forEach(el => {
    const on = !!focus && el.dataset.focus === focus;
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

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#joinOverlay') && !$('#joinOverlay').hidden) $('#joinOverlay').hidden = true;
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
            <form class="composer" data-q="${q.id}">
              <textarea rows="2" maxlength="500" placeholder="${esc(q.hint || '생각을 적고 Enter')} — Enter로 붙이기"></textarea>
              <button class="btn primary">붙이기</button>
            </form>
            <div class="notes" id="notes-${q.id}"></div>
          </div>`).join('')}
      </div>
      <div class="paper" data-focus="plan">
        <div class="paper-head">
          <h2>${esc(PLAN.title)}</h2>
          <p>실행안 포스트잇의 <b>‘계획으로’</b>를 누르거나 아래에 직접 적어요. ${PLAN.fields.map(f => f.label).join('·')} <b>네 칸을 모두</b> 채워야 해요. <b>${PLAN.max}개까지</b> 쓸 수 있고, 그중 <b>🖼 ${PLAN.posterMax}개</b>를 골라 A1 전지 가운데에 크게 넣어요.</p>
        </div>
        <div class="pin-count" id="planCount"></div>
        <ol class="plan" id="plan"></ol>
        <form class="plan-composer" id="planComposer">
          ${PLAN.fields.map(f => `
            <label class="pf pf-${f.key}"><span>${esc(f.label)}</span>
              <input name="${f.key}" maxlength="${f.max}" placeholder="${esc(f.hint)}" required>
            </label>`).join('')}
          <button class="btn primary">계획에 넣기</button>
        </form>
        <div class="signers" id="signers"></div>
      </div>
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
const fmtEok = v => `${(Math.round(v * 10) / 10).toLocaleString('ko-KR')}억`;
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
  return { months: m, avg: q.actual / m, need: q.target / 12, needLeft: m < 12 ? q.left / (12 - m) : null, rest: 12 - m };
}
// part 'past' = 원인 분석(지금까지·필요했던 월 평균), 'left' = 12월까지 할 일(남은 기간 필요한 월 평균)
function monthlyHtml(teamId, part, cls = '') {
  const mo = monthlyOf(teamId);
  if (!mo) return '';
  if (part === 'left') {
    return mo.needLeft == null ? '' : `
      <div class="gap-box ${cls}">
        <div><span>남은 ${mo.rest}개월 동안 필요한 월 평균</span><b class="bad">${fmtEok(mo.needLeft)}</b></div>
      </div>`;
  }
  const short = mo.avg < mo.need;
  return `
    <div class="gap-box ${cls}">
      <div><span>지금까지 월 평균 (${mo.months}개월)</span><b class="${short ? 'bad' : 'good'}">${fmtEok(mo.avg)}</b></div>
      <div><span>달성하려면 필요했던 월 평균</span><b>${fmtEok(mo.need)}</b></div>
    </div>`;
}

function questHtml(q, cls = '') {
  if (!q) return '';
  const asOf = S.meta?.questAsOf ? `${esc(S.meta.questAsOf)}까지` : '지금까지';
  return `
    <div class="quest ${cls}">
      <div class="q-line"><b>${fmtEok(q.target)}</b><span>2026 팀퀘스트 매출 목표</span></div>
      <div class="q-bar"><i style="width:${Math.min(100, q.rate).toFixed(1)}%"></i></div>
      <div class="q-now">${asOf} <b>${fmtEok(q.actual)}</b> · 달성률 <b>${q.rate.toFixed(1)}%</b> · 남은 <b>${fmtEok(q.left)}</b></div>
    </div>`;
}

function companyCard(c) {
  return `
    <div class="mcard company">
      <div class="label">회사 · ${esc(c.name || '에고이즘')}</div>
      ${c.mission ? `<h4>미션</h4><p class="big">${br(c.mission)}</p>` : '<p class="empty">미션이 아직 없어요</p>'}
      ${questHtml(questOf(''))}
    </div>`;
}

// 팀 카드: 부서 미션(예: 운영부서) + 팀·브랜드 미션 + 팀퀘스트 목표
function teamCard(t) {
  const any = t.deptMission || t.mission;
  const q = questOf(t.id);
  return `
    <div class="mcard team">
      <div class="label">우리 팀 · ${esc(t.name)}${t.dept ? ` (${esc(t.dept)})` : ''}</div>
      ${t.deptMission ? `<h4>${esc(t.dept || '부서')} 미션</h4><p class="big">${br(t.deptMission)}</p>` : ''}
      ${t.mission ? `<h4>${t.deptMission ? '팀 미션' : '미션'}</h4><p class="${t.deptMission ? 'mid' : 'big'}">${br(t.mission)}</p>` : ''}
      ${!any ? '<p class="empty">미션이 아직 없어요</p>' : ''}
      ${questHtml(q)}
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
  if ($('#gapBox-q1')) $('#gapBox-q1').innerHTML = monthlyHtml(S.team, 'past');
  if ($('#gapBox-q2')) $('#gapBox-q2').innerHTML = monthlyHtml(S.team, 'left');

  const notes = notesOf(S.team);
  for (const q of QUESTIONS) {
    const pins = pinsOf(S.team, q.id);
    const full = pins.length >= PIN_MAX;
    // 전지에 붙인 포스트잇이 맨 위, 나머지는 공감 순
    const list = sortNotes(notes.filter(n => n.q === q.id))
      .map(n => ({ n, slot: pinSlotOf(S.team, q.id, n.id) }))
      .sort((a, b) => (b.slot ? 1 : 0) - (a.slot ? 1 : 0));
    $(`#pins-${q.id}`).innerHTML = `📌 전지에 붙인 포스트잇 <b>${pins.length}/${PIN_MAX}</b>` +
      (full ? ' <span class="lbl">— 바꾸려면 하나를 떼어 주세요</span>' : '');
    $(`#notes-${q.id}`).innerHTML = list.length
      ? list.map(({ n, slot }) => noteHtml(n, slot, full)).join('')
      : '<p class="empty">아직 붙은 포스트잇이 없어요</p>';
  }

  const plans = plansOf(S.team);
  const onPoster = posterPlansOf(S.team);
  const posterFull = onPoster.length >= PLAN.posterMax;
  $('#planCount').innerHTML = `계획 <b>${plans.length}/${PLAN.max}</b> · 🖼 전지에 넣은 계획 <b>${onPoster.length}/${PLAN.posterMax}</b>` +
    (posterFull ? ' <span class="lbl">— 바꾸려면 하나를 빼 주세요</span>' : '');
  $('#plan').innerHTML = plans.length
    ? plans.map((p, i) => {
      const on = onPoster.some(x => x.id === p.id);
      return `
      <li data-id="${esc(p.id)}" class="${on ? 'on-poster' : ''}">
        <span class="pn">${i + 1}</span>
        <div class="pbody">
          ${on ? '<span class="pin-badge">🖼 전지에 들어감</span>' : ''}
          <div class="pwhat">${esc(p.what)}</div>
          <div class="pmeta"><span>담당 <b>${esc(p.who)}</b></span><span>기한 <b>${esc(p.when)}</b></span><span>확인 <b>${esc(p.metric)}</b></span></div>
        </div>
        <span class="aact">
          ${on
            ? '<button class="pin on" data-act="plan-poster" title="A1 전지에서 빼기">🖼 빼기</button>'
            : `<button class="pin" data-act="plan-poster" ${posterFull ? `disabled title="전지에는 ${PLAN.posterMax}개까지예요"` : 'title="A1 전지에 넣기"'}>🖼 전지에 넣기</button>`}
          <button class="icon" data-act="plan-up" ${i === 0 ? 'disabled' : ''} title="위로">▲</button>
          <button class="icon" data-act="plan-down" ${i === plans.length - 1 ? 'disabled' : ''} title="아래로">▼</button>
          <button class="link" data-act="plan-edit">고치기</button>
          <button class="link" data-act="plan-del">지우기</button>
        </span>
      </li>`;
    }).join('')
    : '<li class="empty">아직 실행 계획이 없어요</li>';

  // 다 차면 입력 칸을 막는다
  const full = plans.length >= PLAN.max;
  $('#planComposer').classList.toggle('full', full);
  $('#planComposer').querySelectorAll('input, button').forEach(x => { x.disabled = full; });
  $('#planComposer button').textContent = full ? `${PLAN.max}개가 다 찼어요` : '계획에 넣기';

  const members = membersOf(S.team);
  $('#signers').innerHTML = members.length
    ? `<span class="lbl">함께한 사람</span>${members.map(m => `<span class="sign">${esc(m.name)}</span>`).join('')}`
    : '';

  renderLivePreview();
  cleanupDeadPins(S.team);
}

function noteHtml(n, pinSlot, pinsFull) {
  const likes = Object.keys(n.likes || {}).length;
  const liked = !!n.likes?.[uid];
  const mine = n.uid === uid || S.admin;
  const pinText = pinSlot ? S.teams[S.team]?.pins?.[n.q]?.[pinSlot]?.text : '';
  return `
    <div class="note ${esc(n.q)} ${n.uid === uid ? 'mine' : ''} ${pinSlot ? 'pinned' : ''}" data-id="${esc(n.id)}">
      ${pinSlot ? '<span class="pin-badge">📌 전지에 붙음</span>' : ''}
      <div class="note-text">${br(n.text)}</div>
      ${pinSlot && pinText !== n.text ? `<div class="pin-text">전지에는: “${esc(pinText)}”</div>` : ''}
      <div class="note-foot">
        <span class="by">${esc(n.name)}</span>
        <button class="like ${liked ? 'on' : ''}" data-act="like" title="공감">♥ ${likes || ''}</button>
        ${pinSlot
          ? `<button class="pin on" data-act="unpin" data-slot="${pinSlot}" title="전지에서 떼기">📌 떼기</button>`
          : `<button class="pin" data-act="pin" ${pinsFull ? `disabled title="이 질문은 ${PIN_MAX}장이 다 찼어요"` : `title="A1 전지에 붙여요 (질문마다 ${PIN_MAX}장)"`}>📌 전지에 붙이기</button>`}
        <button class="link" data-act="promote" title="이 내용을 '${esc(PLAN.title)}'으로 올려요 (담당·기한·숫자를 채워요)">${isPromoted(S.team, n.id) ? '계획에 있음' : '계획으로'}</button>
        ${mine ? '<button class="link" data-act="edit">고치기</button><button class="link" data-act="del">지우기</button>' : ''}
      </div>
    </div>`;
}

// ── 전지에 붙일 포스트잇: 질문마다 p1~p4 네 자리만 있다 (규칙에서도 같은 자리만 허용) ──
// 자리에는 포스트잇 id와 전지에 들어갈 글(40자까지)을 따로 담는다. 원래 포스트잇은 그대로 둔다.
const PIN_MAX = 4, PIN_LEN = 40;
const PIN_SLOTS = ['p1', 'p2', 'p3', 'p4'];
// 자리 하나하나를 '살아 있는 자리'와 '버려진 자리'로 나눈다.
// 버려진 자리 = 원래 포스트잇이 지워졌거나, 같은 포스트잇이 두 자리에 붙은 경우의 뒤쪽 자리
// 글과 질문이 있는 포스트잇만 (반쯤 지워진 찌꺼기는 보이지 않게)
const isNote = n => n && typeof n.text === 'string' && n.text && n.q;
const notesOf = teamId => listOf(S.teams[teamId]?.notes).filter(isNote);

function pinSlots(teamId, q) {
  const notes = S.teams[teamId]?.notes || {};
  const seen = new Set();
  const live = [], dead = [];
  PIN_SLOTS
    .map(slot => ({ slot, ...(S.teams[teamId]?.pins?.[q]?.[slot] || {}) }))
    .filter(p => p.ts)
    .sort((a, b) => a.ts - b.ts)
    .forEach(p => {
      if (p.text && isNote(notes[p.note]) && !seen.has(p.note)) { seen.add(p.note); live.push(p); }
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

// 포스트잇이 실행 계획으로 올라가 있는지는 계획 쪽을 보고 판단한다 (계획을 지우면 다시 올릴 수 있게)
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
  const taken = new Set(pinsOf(S.team, note.q).map(p => p.slot));
  const slot = PIN_SLOTS.find(k => !taken.has(k));
  if (!slot) return toast(`이 질문은 전지에 ${PIN_MAX}장까지 붙일 수 있어요. 하나를 떼고 붙여 주세요`);
  try {
    await store.set(`teams/${S.team}/pins/${note.q}/${slot}`, { note: noteId, text, ts: now(), by: uid });
  } catch {
    toast('방금 다른 사람이 먼저 붙여서 자리가 찼어요. 목록을 보고 다시 해 주세요');
  }
}

// ── 12월까지 실행 계획: 팀마다 r1~r20 자리만 있다 (규칙에서도 같은 자리만 허용) ──
// 한 줄 = 실행안·담당·기한·확인할 숫자. 네 칸이 모두 찬 줄만 쓴다.
// onPoster 가 켜진 줄만 A1 전지에 들어간다 (posterMax 개까지, 넘치면 순서상 앞의 것만)
const PLAN_SLOTS = Array.from({ length: PLAN.max }, (_, i) => 'r' + (i + 1));
const isPlan = p => p && PLAN.fields.every(f => typeof p[f.key] === 'string' && p[f.key].trim());
const plansOf = teamId => listOf(S.teams[teamId]?.plan).filter(isPlan).sort((a, b) => (a.order ?? a.ts) - (b.order ?? b.ts));
const posterPlansOf = teamId => plansOf(teamId).filter(p => p.onPoster).slice(0, PLAN.posterMax);

// 실행 계획 입력 창: 네 칸을 채우면 값, 취소하면 null
function planDialog(title, values = {}) {
  const d = $('#planDialog');
  $('#planTitle').textContent = title;
  $('#planFields').innerHTML = PLAN.fields.map(f => `
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
      for (const f of PLAN.fields) v[f.key] = $(`#planFields [name=${f.key}]`).value.trim().slice(0, f.max);
      finish(isPlan(v) ? v : null);
    };
    d.onclose = () => finish(null);
    d.showModal();
    $('#planFields input')?.focus();
  });
}

async function addPlan(values, from) {
  if (!isPlan(values)) { toast(`${PLAN.fields.map(f => f.label).join('·')} 네 칸을 모두 채워 주세요`); return false; }
  const used = S.teams[S.team]?.plan || {};
  const slot = PLAN_SLOTS.find(k => !used[k]);
  if (!slot) { toast(`실행 계획은 ${PLAN.max}개까지예요. 하나를 고치거나 지워 주세요`); return false; }
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
        <div class="lbl">실행 계획 ${all.length}개 · 전지에 ${plans.length}개</div>
        <ol class="mini-plan">${plans.length ? plans.map(p => `<li>${esc(p.what)} <span class="lbl">· ${esc(p.who)} · ${esc(p.when)}</span></li>`).join('') : '<li class="empty">전지에 넣은 실행 계획 없음</li>'}</ol>
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
        <p class="hint"><b>아웃라인 PDF</b>는 글자를 모두 선으로 바꾼 A1 파일(오프린트미 가이드: 작업 596×842mm, 재단 594×840mm)이라 그대로 인쇄소에 넘기면 돼요. 파일 이름은 <b>경영팀_프로그램_팀이름.pdf</b>. 포스트잇은 팀이 📌로 고른 것(질문마다 ${PIN_MAX}장까지)만 들어가요.</p>
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

// 1) 실행 계획 글씨: 크게 쓰되, 아래 포스트잇 칸이 PLAN_ROOM_MM 보다 좁아지면 조금씩 줄인다
// 2) 포스트잇 글씨: 칸 안에 다 들어가는 가장 큰 크기로 맞춘다 (세 칸 모두 같은 크기)
const PLAN_MAX = 54, PLAN_MIN = 40, PLAN_ROOM_MM = 215;
const STICKY_MAX = 36, STICKY_MIN = 20;
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
  const notes = poster.querySelector('.p-notes');
  if (notes) {
    const mm = poster.offsetWidth / 596;
    let size = PLAN_MAX;
    poster.style.setProperty('--plan', size + 'pt');
    while (size > PLAN_MIN && notes.offsetHeight < PLAN_ROOM_MM * mm) {
      size -= 2;
      poster.style.setProperty('--plan', size + 'pt');
    }
  }
  const cols = [...poster.querySelectorAll('.p-col')];
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

function posterHtml(teamId) {
  const t = teamOf(teamId);
  if (!t) return '<div class="poster"></div>';
  const c = S.meta.company || {};
  const plans = posterPlansOf(teamId);
  const members = membersOf(teamId);
  const colors = ['#ff6b4a', '#2f7de1', '#16a37a', '#c2410c', '#7c3aed'];
  const cq = questOf(''), tq = questOf(teamId);
  return `
    <div class="poster" style="--sticky:${STICKY_MAX}pt;--plan:${PLAN_MAX}pt">
      <h1 class="p-title"><span class="p-team">${esc(t.name)}</span>목표 달성 실행 계획</h1>
      <div class="p-missions">
        <div class="p-m">
          <b>${esc(c.name || '에고이즘')}의 미션</b><p>${br(c.mission)}</p>
          ${questHtml(cq, 'p-quest')}
        </div>
        <div class="p-m">
          ${t.deptMission ? `<b>${esc(t.dept || '부서')}의 미션</b><p>${br(t.deptMission)}</p>` : ''}
          ${t.mission ? `<b>${esc(t.name)}의 미션</b><p class="${t.deptMission ? 'mid' : ''}">${br(t.mission)}</p>` : ''}
          ${!t.deptMission && !t.mission ? `<b>${esc(t.name)}의 미션</b><p class="sm">(미션을 정하는 중이에요)</p>` : ''}
          ${questHtml(tq, 'p-quest')}
        </div>
      </div>
      <div class="p-plan">
        <h2>${esc(PLAN.title)}</h2>
        <ol>
          ${plans.map((p, i) => `
            <li style="--c:${colors[i % colors.length]}">
              <span class="p-n">${i + 1}</span>
              <div><div class="p-what">${esc(p.what)}</div>
              <div class="p-meta"><span>담당 <b>${esc(p.who)}</b></span><span>기한 <b>${esc(p.when)}</b></span><span>확인 <b>${esc(p.metric)}</b></span></div></div>
            </li>`).join('') || '<li class="empty">🖼 전지에 넣을 실행 계획을 골라 주세요</li>'}
        </ol>
      </div>
      ${S.posterNotes ? `
      <div class="p-notes">
        ${QUESTIONS.map((q, i) => `
          <div class="p-col">
            <div class="p-q"><span>${i + 1}</span>${esc(q.poster || q.short)}</div>
            <div class="p-gapslot">${i === 0 ? monthlyHtml(teamId, 'past', 'p-gap') : i === 1 ? monthlyHtml(teamId, 'left', 'p-gap') : ''}</div>
            <div class="p-stickies">${(() => {
              // 질문마다 PIN_MAX 칸짜리 같은 크기 판. 고른 포스트잇이 적어도 칸 자리는 그대로 둔다
              const pins = pinsOf(teamId, q.id);
              if (!pins.length) return '<div class="p-empty">📌 전지에 붙일 포스트잇을 골라 주세요</div>';
              return PIN_SLOTS.map((_, k) => pins[k]
                ? `<div class="p-sticky ${q.id}"><span>${br(pins[k].text)}</span></div>`
                : '<div class="p-slot"></div>').join('');
            })()}</div>
          </div>`).join('')}
      </div>` : '<div class="p-spacer"></div>'}
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
          <label class="field">2026 팀퀘스트 목표 (억)<input id="qcTarget" type="number" step="0.1" min="0" value="${esc(m.quests?.company?.target ?? '')}"></label>
          <label class="field">달성 (억)<input id="qcActual" type="number" step="0.1" min="0" value="${esc(m.quests?.company?.actual ?? '')}"></label>
          <label class="field">기준 (예: 9월)<input id="qAsOf" value="${esc(m.questAsOf || '')}" placeholder="9월"></label>
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
        <p class="sub">팀마다 포스트잇·실행 계획·이름(홍길동 등 가짜 이름)을 채워요. 샘플만 골라서 지울 수 있고, 사람들이 적은 내용은 그대로 남아요.</p>
        <textarea id="sampleJson" rows="4" placeholder="sample.local.json 내용을 여기에 붙여 넣어요 (내 컴퓨터 미리보기에서는 비워 둬도 돼요)"></textarea>
        <div class="row-btns">
          <button class="btn" id="seedSample">샘플 넣기</button>
          <button class="btn ghost" id="clearSample">샘플 지우기</button>
        </div>
      </div>` : ''}
    </section>`;
  if (S.meta) shell(body); else app.innerHTML = `<main id="main">${body}</main>`;

  $('#addTeam').onclick = () => $('#teamRows').insertAdjacentHTML('beforeend', teamRow({ id: 't' + Date.now().toString(36), name: '', dept: '', deptMission: '', mission: '' }));
  if (S.meta) {
    $('#seedSample').onclick = seedSample;
    $('#clearSample').onclick = clearSample;
  }
  $('#teamRows').onclick = e => { if (e.target.dataset.act === 'row-del' && confirm('이 팀을 목록에서 뺄까요? (이미 적은 포스트잇은 저장소에 남아요)')) e.target.closest('.trow').remove(); };
  $('#saveMeta').onclick = async () => {
    const teams = {};
    const quests = {};
    const num = el => (el.value.trim() === '' ? null : +el.value);
    if (num($('#qcTarget'))) quests.company = { target: num($('#qcTarget')), actual: num($('#qcActual')) || 0 };
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
    });
    const ok = await save(store.set('meta', {
      expected: +$('#cExpected').value || 0,
      uncounted: $('#cUncounted').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
      questAsOf: $('#qAsOf').value.trim(),
      quests,
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
  const t0 = now() - 3600000;
  const up = {};
  for (const [tid, s] of Object.entries(src)) {
    if (!teamOf(tid)) continue;
    (s.members || []).forEach((name, i) => { up[`${tid}/members/s${i}`] = { name, ts: t0 + i, sample: true }; });
    for (const q of QUESTIONS) {
      const list = s[q.id] || [];
      list.forEach(([text, likes = 0], i) => {
        const l = {};
        for (let k = 0; k < likes; k++) l['s' + k] = true;
        up[`${tid}/notes/s_${q.id}_${i}`] = { q: q.id, text, name: s.members[(i + 1) % s.members.length], uid: 'sample', ts: t0 + 1000 * i, likes: l, sample: true };
      });
      // 공감 많은 순으로 전지에 붙여 둔다. 이미 찬 자리(사람이 붙인 것)는 건드리지 않고 빈 자리에만
      // (규칙이 찬 자리 덮어쓰기를 막아서, 하나라도 겹치면 샘플 전체가 저장되지 않는다)
      const usedPins = S.teams[tid]?.pins?.[q.id] || {};
      const freePins = PIN_SLOTS.filter(k => !usedPins[k]);
      const pinnedNotes = new Set(Object.values(usedPins).map(p => p?.note));
      list.map(([text, likes = 0], i) => ({ text, likes, i, note: `s_${q.id}_${i}` }))
        .filter(p => !pinnedNotes.has(p.note))
        .sort((a, b) => b.likes - a.likes)
        .slice(0, freePins.length)
        .forEach((p, k) => {
          up[`${tid}/pins/${q.id}/${freePins[k]}`] = { note: p.note, text: p.text.slice(0, PIN_LEN), ts: t0 + k, by: 'sample', sample: true };
        });
    }
    // 실행 계획도 빈 자리에만. 샘플 한 줄 = [실행안, 담당, 기한, 확인할 숫자]
    const usedPlan = S.teams[tid]?.plan || {};
    const freePlan = PLAN_SLOTS.filter(k => !usedPlan[k]);
    let posterRoom = PLAN.posterMax - posterPlansOf(tid).length;
    (s.plan || []).slice(0, freePlan.length).forEach((row, i) => {
      const v = {};
      PLAN.fields.forEach((f, k) => { v[f.key] = String(row[k] || '').slice(0, f.max); });
      const onPoster = posterRoom-- > 0;
      if (isPlan(v)) up[`${tid}/plan/${freePlan[i]}`] = { ...v, onPoster, name: '샘플', uid: 'sample', ts: t0 + i, order: t0 + i, sample: true };
    });
  }
  try {
    await store.update('teams', up);
    toast('샘플을 넣었어요. 이미 사람이 쓴 자리는 그대로 두고 빈 자리에만 넣었어요');
  } catch (err) {
    console.error(err);
    toast('샘플을 넣지 못했어요. 진행자 로그인과 파이어베이스 규칙 게시를 확인해 주세요');
  }
}

async function clearSample() {
  if (!confirm('샘플로 넣은 내용만 지울까요? (사람들이 적은 내용은 남아요)')) return;
  const up = {};
  for (const [tid, d] of Object.entries(S.teams)) {
    for (const part of ['notes', 'plan', 'agree', 'members']) {
      for (const [id, v] of Object.entries(d[part] || {})) if (v?.sample) up[`${tid}/${part}/${id}`] = null;
    }
    for (const [q, slots] of Object.entries(d.pins || {})) {
      // 샘플 자리 + 사람이 샘플 포스트잇에 붙인 자리 (포스트잇이 지워지면 버려진 자리가 되므로 같이 지운다)
      for (const [slot, v] of Object.entries(slots || {})) {
        if (v?.sample || d.notes?.[v?.note]?.sample) up[`${tid}/pins/${q}/${slot}`] = null;
      }
    }
  }
  if (!Object.keys(up).length) return toast('지울 샘플이 없어요');
  if (await save(store.update('teams', up))) toast('샘플을 지웠어요');
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
        <label class="tExp">팀퀘스트 목표 <input class="tqTarget" type="number" step="0.1" min="0" value="${esc(S.meta?.quests?.[t.id]?.target ?? '')}">억</label>
        <label class="tExp">달성 <input class="tqActual" type="number" step="0.1" min="0" value="${esc(S.meta?.quests?.[t.id]?.actual ?? '')}">억</label>
        <span class="lbl">비우면 회사 목표와 같아요</span>
      </div>
      <button class="link" data-act="row-del">빼기</button>
    </div>`;
}

// ── 클릭·입력 처리 ──────────────────────────────────────────
// 참가자는 자기 팀 전지만 고칠 수 있다 (다른 팀 전지는 '전체 팀'에서 구경만). 진행자는 모든 팀
const EDIT_ACTS = new Set(['like', 'promote', 'edit', 'del', 'pin', 'unpin', 'plan-edit', 'plan-del', 'plan-up', 'plan-down', 'plan-poster']);
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
  const planId = el.closest('#plan li')?.dataset.id;
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
    case 'promote': {
      if (!note || isPromoted(S.team, noteId)) return;
      if (plansOf(S.team).length >= PLAN.max) return toast(`실행 계획은 ${PLAN.max}개까지예요. 하나를 고치거나 지워 주세요`);
      const v = await planDialog('실행 계획으로 올리기', { what: note.text });
      if (v) await addPlan(v, noteId);
      return;
    }
    case 'edit': {
      if (!note) return;
      const before = note.text;
      const text = await editText('포스트잇 고치기', before);
      if (!text || text === before) return;
      if (!S.teams[S.team]?.notes?.[noteId]) return toast('그사이 이 포스트잇이 지워졌어요');
      const up = { [`notes/${noteId}/text`]: text };
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
      if (!note || !confirm('이 포스트잇을 지울까요?')) return;
      // 포스트잇과 전지 자리를 한 번에 지운다 (둘 중 하나만 지워지는 일이 없게)
      const up = { [`notes/${noteId}`]: null };
      for (const slot of PIN_SLOTS) {
        if (S.teams[S.team]?.pins?.[note.q]?.[slot]?.note === noteId) up[`pins/${note.q}/${slot}`] = null;
      }
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
      const v = await planDialog('실행 계획 고치기', p);
      if (!v) return;
      if (!S.teams[S.team]?.plan?.[planId]) return toast('그사이 이 계획이 지워졌어요');
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
      if (planId && confirm('이 실행 계획을 지울까요?')) save(store.remove(`${teamPath}/plan/${planId}`));
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
      if (step === 0) openJoinOverlay(); // 접속·안내 단계: QR을 화면 가운데에 크게
      return;
    }
    case 'join-qr': return openJoinOverlay();
    case 'join-qr-close': $('#joinOverlay').hidden = true; return;
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
  const input = form.querySelector('textarea, input');
  const text = input.value.trim();
  if (!text || !S.team) return;
  if (!canEditTeam()) return toast('다른 팀 전지는 볼 수만 있어요');
  store.push(`teams/${S.team}/notes`, { q: form.dataset.q, text, name: me.name || '진행자', uid, ts: now() });
  input.value = '';
  input.focus();
});

// 포스트잇 칸: Enter = 붙이기, Shift+Enter = 줄바꿈 (한글 입력 중 Enter는 무시)
document.addEventListener('keydown', e => {
  if (e.target.matches('.composer textarea') && e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
});
