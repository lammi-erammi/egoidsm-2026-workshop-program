import { createStore } from './store.js';
import { FIREBASE_CONFIG, EVENT, AGENDA, QUESTIONS } from './config.js';

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
  posterTeam: '', posterLimit: 8, posterNotes: true,
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
const save = p => Promise.resolve(p).catch(fail);

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
  store.on('presence', v => { S.presence = v || {}; renderHeader(); render(); }, denied);
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
  if (S.view === 'poster') return show('poster', buildPoster, updatePoster);
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
        ${team || S.team ? `<button data-view="board" class="${S.view === 'board' ? 'on' : ''}">${S.team && S.team !== me.team ? esc(teamOf(S.team)?.name) + ' 전지' : '우리 팀 전지'}</button>` : ''}
        <button data-view="all" class="${S.view === 'all' ? 'on' : ''}">전체 팀</button>
        <button data-view="poster" class="${S.view === 'poster' ? 'on' : ''}">A1 출력</button>
        ${S.admin ? `<button data-view="missions" class="${S.view === 'missions' ? 'on' : ''}">미션 편집</button>` : ''}
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
  const over = left < 0;
  const sec = Math.floor(Math.abs(left) / 1000);
  const t = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  el.textContent = over ? `+${t} 초과` : t;
  el.className = 'timer' + (over ? ' over' : left < 60000 ? ' soon' : '') + (st.pausedLeft != null ? ' paused' : '');
}

function markFocus() {
  const focus = AGENDA[S.stage?.step]?.focus;
  document.querySelectorAll('[data-focus]').forEach(el => el.classList.toggle('focus', el.dataset.focus === focus));
}

// ── 들어가기 (이름·팀 고르기) ───────────────────────────────
function buildJoin() {
  const teams = teamList();
  let pick = teamOf(me.team) ? me.team : '';
  app.innerHTML = `
    <div class="join"><div class="join-card">
      <p class="eyebrow">${esc(EVENT.title)} · ${esc(EVENT.program)}</p>
      <h1>우리 이렇게 일하자</h1>
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
    <section class="board">
      <div class="board-title">
        <h1 id="boardName"></h1>
        <div class="online" id="online"></div>
      </div>
      <div class="missions" data-focus="mission" id="missions"></div>
      <div class="cols">
        ${QUESTIONS.map((q, i) => `
          <div class="col ${q.id}" data-focus="${q.id}">
            <div class="col-head"><span class="qnum">${i + 1}</span><p>${esc(q.text)}</p></div>
            <form class="composer" data-q="${q.id}">
              <textarea rows="2" maxlength="500" placeholder="생각을 적고 Enter (줄바꿈은 Shift+Enter)"></textarea>
              <button class="btn primary">붙이기</button>
            </form>
            <div class="notes" id="notes-${q.id}"></div>
          </div>`).join('')}
      </div>
      <div class="paper" data-focus="agree">
        <div class="paper-head">
          <h2>우리 이렇게 일하자</h2>
          <p>포스트잇의 <b>‘전지로’</b>를 누르거나 직접 적어요. 이 칸이 A1 전지 가운데에 크게 들어가요.</p>
        </div>
        <ol class="agree" id="agree"></ol>
        <form class="composer agree-composer">
          <input maxlength="300" placeholder="팀이 합의한 문장을 적어요 (예: 결정한 건 그날 슬랙에 공유한다)">
          <button class="btn primary">전지에 쓰기</button>
        </form>
        <div class="signers" id="signers"></div>
      </div>
    </section>`);
  updateBoard();
}

const sortNotes = arr => arr.sort((a, b) => Object.keys(b.likes || {}).length - Object.keys(a.likes || {}).length || a.ts - b.ts);
const sortAgree = arr => arr.sort((a, b) => (a.order ?? a.ts) - (b.order ?? b.ts));

function companyCard(c) {
  return `
    <div class="mcard company">
      <div class="label">회사 · ${esc(c.name || '에고이즘')}</div>
      ${c.mission ? `<h4>미션</h4><p class="big">${br(c.mission)}</p>` : '<p class="empty">미션이 아직 없어요</p>'}
      ${c.goal ? `<h4>목표</h4><p>${br(c.goal)}</p>` : ''}
    </div>`;
}

// 팀 카드: 부서 미션(예: 운영부서) + 팀·브랜드 미션 + 목표
function teamCard(t) {
  const any = t.deptMission || t.mission;
  return `
    <div class="mcard team">
      <div class="label">우리 팀 · ${esc(t.name)}${t.dept ? ` (${esc(t.dept)})` : ''}</div>
      ${t.deptMission ? `<h4>${esc(t.dept || '부서')} 미션</h4><p class="big">${br(t.deptMission)}</p>` : ''}
      ${t.mission ? `<h4>${t.deptMission ? '팀 미션' : '미션'}</h4><p class="${t.deptMission ? 'mid' : 'big'}">${br(t.mission)}</p>` : ''}
      ${!any ? '<p class="empty">미션이 아직 없어요</p>' : ''}
      ${t.goal ? `<h4>목표</h4><p>${br(t.goal)}</p>` : ''}
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

  const notes = listOf(data.notes);
  for (const q of QUESTIONS) {
    const list = sortNotes(notes.filter(n => n.q === q.id));
    $(`#notes-${q.id}`).innerHTML = list.length
      ? list.map(n => noteHtml(n)).join('')
      : '<p class="empty">아직 붙은 포스트잇이 없어요</p>';
  }

  const agree = sortAgree(listOf(data.agree));
  $('#agree').innerHTML = agree.length
    ? agree.map((a, i) => `
      <li data-id="${esc(a.id)}">
        <span class="atext">${br(a.text)}</span>
        <span class="aact">
          <button class="icon" data-act="agree-up" ${i === 0 ? 'disabled' : ''} title="위로">▲</button>
          <button class="icon" data-act="agree-down" ${i === agree.length - 1 ? 'disabled' : ''} title="아래로">▼</button>
          <button class="link" data-act="agree-edit">고치기</button>
          <button class="link" data-act="agree-del">지우기</button>
        </span>
      </li>`).join('')
    : '<li class="empty">아직 합의한 문장이 없어요</li>';

  const members = listOf(data.members).sort((a, b) => a.ts - b.ts);
  $('#signers').innerHTML = members.length
    ? `<span class="lbl">함께한 사람</span>${members.map(m => `<span class="sign">${esc(m.name)}</span>`).join('')}`
    : '';
}

function noteHtml(n) {
  const likes = Object.keys(n.likes || {}).length;
  const liked = !!n.likes?.[uid];
  const mine = n.uid === uid || S.admin;
  return `
    <div class="note ${esc(n.q)} ${n.uid === uid ? 'mine' : ''}" data-id="${esc(n.id)}">
      <div class="note-text">${br(n.text)}</div>
      <div class="note-foot">
        <span class="by">${esc(n.name)}</span>
        <button class="like ${liked ? 'on' : ''}" data-act="like" title="공감">♥ ${likes || ''}</button>
        <button class="link" data-act="promote" title="이 내용을 '우리 이렇게 일하자' 전지로 올려요">${n.promoted ? '전지에 있음' : '전지로'}</button>
        ${mine ? '<button class="link" data-act="edit">고치기</button><button class="link" data-act="del">지우기</button>' : ''}
      </div>
    </div>`;
}

function editText(title, text) {
  const d = $('#editDialog');
  $('#editTitle').textContent = title;
  $('#editText').value = text;
  d.returnValue = '';
  return new Promise(resolve => {
    d.onclose = () => resolve(d.returnValue === 'ok' ? $('#editText').value.trim() : null);
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
    const notes = listOf(d.notes);
    const agree = sortAgree(listOf(d.agree));
    const online = listOf(S.presence[t.id]).length;
    return `
      <article class="tcard ${t.id === me.team ? 'mine' : ''}">
        <header><h3>${esc(t.name)}</h3><span class="lbl">접속 ${online}명</span></header>
        <div class="counts">${QUESTIONS.map((q, i) => `<span class="cnt ${q.id}" title="${esc(q.text)}">${i + 1}. ${notes.filter(n => n.q === q.id).length}장</span>`).join('')}</div>
        <ol class="mini-agree">${agree.length ? agree.map(a => `<li>${esc(a.text)}</li>`).join('') : '<li class="empty">합의 문장 없음</li>'}</ol>
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
        <label>칸마다 <select id="pLimit">${[4, 6, 8, 10, 14, 99].map(n => `<option value="${n}" ${n === S.posterLimit ? 'selected' : ''}>${n === 99 ? '전부' : n + '장'}</option>`).join('')}</select></label>
        <button class="btn primary" id="pPrint">인쇄 / PDF로 저장</button>
        <p class="hint">인쇄 창에서 <b>대상: PDF로 저장</b>, <b>여백: 없음</b>, <b>배경 그래픽: 켜기</b>로 저장하면 A1(594×841mm) 크기 PDF가 나와요. 공감(♥)이 많은 포스트잇부터 들어가요.</p>
      </div>
      <div class="poster-frame" id="pFrame"><div class="poster-scale" id="pScale"></div></div>
    </section>`);
  $('#pTeam').onchange = e => { S.posterTeam = e.target.value; updatePoster(); };
  $('#pNotes').onchange = e => { S.posterNotes = e.target.checked; updatePoster(); };
  $('#pLimit').onchange = e => { S.posterLimit = +e.target.value; updatePoster(); };
  $('#pPrint').onclick = () => {
    $('#poster-print').innerHTML = posterHtml(S.posterTeam);
    window.print();
  };
  updatePoster();
}

function updatePoster() {
  const box = $('#pScale');
  if (!box) return;
  box.innerHTML = posterHtml(S.posterTeam);
  fitPoster();
}

function fitPoster() {
  const frame = $('#pFrame'), box = $('#pScale');
  if (!frame || !box) return;
  const poster = box.firstElementChild;
  const scale = frame.clientWidth / poster.offsetWidth;
  box.style.transform = `scale(${scale})`;
  frame.style.height = poster.offsetHeight * scale + 'px';
}
window.addEventListener('resize', fitPoster);

function posterHtml(teamId) {
  const t = teamOf(teamId);
  if (!t) return '<div class="poster"></div>';
  const d = S.teams[teamId] || {};
  const c = S.meta.company || {};
  const agree = sortAgree(listOf(d.agree));
  const notes = listOf(d.notes);
  const members = listOf(d.members).sort((a, b) => a.ts - b.ts);
  const colors = ['#ff6b4a', '#2f7de1', '#16a37a', '#c2410c', '#7c3aed'];
  return `
    <div class="poster">
      <div class="p-top"><span>${esc(EVENT.title)} · ${esc(EVENT.program)}</span><span>${esc(EVENT.date)}</span></div>
      <h1 class="p-title"><span class="p-team">${esc(t.name)}</span>우리 이렇게 일하자</h1>
      <div class="p-missions">
        <div class="p-m"><b>${esc(c.name || '에고이즘')}의 미션</b><p>${br(c.mission)}</p>${c.goal ? `<b>목표</b><p class="sm">${br(c.goal)}</p>` : ''}</div>
        <div class="p-m">
          ${t.deptMission ? `<b>${esc(t.dept || '부서')}의 미션</b><p>${br(t.deptMission)}</p>` : ''}
          ${t.mission ? `<b>${esc(t.name)}의 미션</b><p class="${t.deptMission ? 'mid' : ''}">${br(t.mission)}</p>` : ''}
          ${t.goal ? `<b>목표</b><p class="sm">${br(t.goal)}</p>` : ''}
        </div>
      </div>
      <ol class="p-agree">
        ${agree.map((a, i) => `<li style="--c:${colors[i % colors.length]}"><span class="p-n">${i + 1}</span><span>${br(a.text)}</span></li>`).join('') || '<li class="empty">합의한 문장을 적어 주세요</li>'}
      </ol>
      ${S.posterNotes ? `
      <div class="p-notes">
        ${QUESTIONS.map((q, i) => `
          <div class="p-col">
            <div class="p-q"><span>${i + 1}</span>${esc(q.text)}</div>
            <div class="p-stickies">${sortNotes(notes.filter(n => n.q === q.id)).slice(0, S.posterLimit).map(n => `<div class="p-sticky ${q.id}">${br(n.text)}</div>`).join('')}</div>
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
        <label class="field">목표<textarea id="cGoal" rows="2">${esc(c.goal)}</textarea></label>
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
        <p class="sub">팀마다 포스트잇·합의 문장·이름(홍길동 등 가짜 이름)을 채워요. 샘플만 골라서 지울 수 있고, 사람들이 적은 내용은 그대로 남아요.</p>
        <textarea id="sampleJson" rows="4" placeholder="sample.local.json 내용을 여기에 붙여 넣어요 (내 컴퓨터 미리보기에서는 비워 둬도 돼요)"></textarea>
        <div class="row-btns">
          <button class="btn" id="seedSample">샘플 넣기</button>
          <button class="btn ghost" id="clearSample">샘플 지우기</button>
        </div>
      </div>` : ''}
    </section>`;
  if (S.meta) shell(body); else app.innerHTML = `<main id="main">${body}</main>`;

  $('#addTeam').onclick = () => $('#teamRows').insertAdjacentHTML('beforeend', teamRow({ id: 't' + Date.now().toString(36), name: '', dept: '', deptMission: '', mission: '', goal: '' }));
  if (S.meta) {
    $('#seedSample').onclick = seedSample;
    $('#clearSample').onclick = clearSample;
  }
  $('#teamRows').onclick = e => { if (e.target.dataset.act === 'row-del' && confirm('이 팀을 목록에서 뺄까요? (이미 적은 포스트잇은 저장소에 남아요)')) e.target.closest('.trow').remove(); };
  $('#saveMeta').onclick = async () => {
    const teams = {};
    app.querySelectorAll('.trow').forEach((r, i) => {
      const name = $('.tName', r).value.trim();
      if (name) teams[r.dataset.id] = {
        name, order: i,
        dept: $('.tDept', r).value.trim(),
        deptMission: $('.tDeptMission', r).value.trim(),
        mission: $('.tMission', r).value.trim(),
        goal: $('.tGoal', r).value.trim()
      };
    });
    await save(store.set('meta', {
      company: { name: $('#cName').value.trim(), mission: $('#cMission').value.trim(), goal: $('#cGoal').value.trim() },
      teams
    }));
    toast('저장했어요');
  };
  $('#saveJson').onclick = async () => {
    try {
      const v = JSON.parse($('#metaJson').value);
      if (!v.company || !v.teams) throw new Error();
      await save(store.set('meta', v));
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
      (s[q.id] || []).forEach(([text, likes = 0], i) => {
        const l = {};
        for (let k = 0; k < likes; k++) l['s' + k] = true;
        up[`${tid}/notes/s_${q.id}_${i}`] = { q: q.id, text, name: s.members[(i + 1) % s.members.length], uid: 'sample', ts: t0 + 1000 * i, likes: l, sample: true };
      });
    }
    (s.agree || []).forEach((text, i) => { up[`${tid}/agree/s${i}`] = { text, name: '샘플', uid: 'sample', ts: t0 + i, order: t0 + i, sample: true }; });
  }
  await save(store.update('teams', up));
  toast('샘플을 넣었어요. A1 출력 탭에서 확인해 보세요');
}

async function clearSample() {
  if (!confirm('샘플로 넣은 내용만 지울까요? (사람들이 적은 내용은 남아요)')) return;
  const up = {};
  for (const [tid, d] of Object.entries(S.teams)) {
    for (const part of ['notes', 'agree', 'members']) {
      for (const [id, v] of Object.entries(d[part] || {})) if (v?.sample) up[`${tid}/${part}/${id}`] = null;
    }
  }
  if (!Object.keys(up).length) return toast('지울 샘플이 없어요');
  await save(store.update('teams', up));
  toast('샘플을 지웠어요');
}

function teamRow(t) {
  return `
    <div class="trow" data-id="${esc(t.id)}">
      <div class="tcol">
        <input class="tName" placeholder="팀 이름" value="${esc(t.name)}">
        <input class="tDept" placeholder="부서 (예: 운영부서)" value="${esc(t.dept)}">
      </div>
      <textarea class="tDeptMission" rows="2" placeholder="부서 미션">${esc(t.deptMission)}</textarea>
      <textarea class="tMission" rows="2" placeholder="팀·브랜드 미션 (없으면 비워 두기)">${esc(t.mission)}</textarea>
      <textarea class="tGoal" rows="2" placeholder="팀 목표 (없으면 비워 두기)">${esc(t.goal)}</textarea>
      <button class="link" data-act="row-del">빼기</button>
    </div>`;
}

// ── 클릭·입력 처리 ──────────────────────────────────────────
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act], [data-view]');
  if (!el || !store) return;
  if (el.dataset.view) {
    if (el.dataset.view === 'board') return go('board', S.team || me.team);
    return go(el.dataset.view);
  }
  const act = el.dataset.act;
  const teamPath = `teams/${S.team}`;
  const noteId = el.closest('.note')?.dataset.id;
  const agreeId = el.closest('#agree li')?.dataset.id;
  const note = noteId && S.teams[S.team]?.notes?.[noteId];

  switch (act) {
    case 'change-me': S.joining = true; S.built = ''; return render();
    case 'login': return openLogin();
    case 'logout': return store.signOut();
    case 'open-team': return go('board', el.dataset.team);

    case 'like':
      return save(store.set(`${teamPath}/notes/${noteId}/likes/${uid}`, note?.likes?.[uid] ? null : true));
    case 'promote':
      if (!note || note.promoted) return;
      store.push(`${teamPath}/agree`, { text: note.text, name: me.name || '진행자', uid, ts: now(), order: now() });
      return save(store.set(`${teamPath}/notes/${noteId}/promoted`, true));
    case 'edit': {
      const text = await editText('포스트잇 고치기', note?.text || '');
      if (text) save(store.set(`${teamPath}/notes/${noteId}/text`, text));
      return;
    }
    case 'del':
      if (confirm('이 포스트잇을 지울까요?')) save(store.remove(`${teamPath}/notes/${noteId}`));
      return;

    case 'agree-edit': {
      const a = S.teams[S.team]?.agree?.[agreeId];
      const text = await editText('전지 문장 고치기', a?.text || '');
      if (text) save(store.set(`${teamPath}/agree/${agreeId}/text`, text));
      return;
    }
    case 'agree-del':
      if (confirm('전지에서 이 문장을 지울까요?')) save(store.remove(`${teamPath}/agree/${agreeId}`));
      return;
    case 'agree-up':
    case 'agree-down': {
      const list = sortAgree(listOf(S.teams[S.team]?.agree));
      const i = list.findIndex(a => a.id === agreeId);
      const j = act === 'agree-up' ? i - 1 : i + 1;
      if (i < 0 || !list[j]) return;
      const oi = list[i].order ?? list[i].ts, oj = list[j].order ?? list[j].ts;
      return save(store.update(`${teamPath}/agree`, { [`${list[i].id}/order`]: oj, [`${list[j].id}/order`]: oi === oj ? oi + 1 : oi }));
    }

    // 진행자 타이머
    case 'stage': return startStep(+el.dataset.step);
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
      const link = `${location.origin}${location.pathname}#k=${CODE}`;
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
  const form = e.target.closest('.composer');
  if (!form) return;
  e.preventDefault();
  const input = form.querySelector('textarea, input');
  const text = input.value.trim();
  if (!text || !S.team) return;
  if (form.classList.contains('agree-composer')) {
    store.push(`teams/${S.team}/agree`, { text, name: me.name || '진행자', uid, ts: now(), order: now() });
  } else {
    store.push(`teams/${S.team}/notes`, { q: form.dataset.q, text, name: me.name || '진행자', uid, ts: now() });
  }
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
