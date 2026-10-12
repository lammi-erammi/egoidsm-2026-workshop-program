// 저장소 연결. 파이어베이스 설정이 있으면 파이어베이스(실시간 공유),
// 없으면 미리보기 모드(같은 컴퓨터의 브라우저 탭끼리만 공유)로 동작한다.
// 화면 코드는 어느 쪽이든 똑같이 on / set / update / remove / push 만 쓴다.
import { FIREBASE_CONFIG } from './config.js';

const FIREBASE_VERSION = '10.12.2';

export async function createStore(root) {
  if (FIREBASE_CONFIG && FIREBASE_CONFIG.databaseURL) return firebaseStore(root);
  return localStore(root);
}

async function firebaseStore(root) {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  const { initializeApp } = await import(`${base}/firebase-app.js`);
  const fb = await import(`${base}/firebase-database.js`);
  const fa = await import(`${base}/firebase-auth.js`);
  const app = initializeApp(FIREBASE_CONFIG);
  const db = fb.getDatabase(app);
  const auth = fa.getAuth(app);
  const ref = p => fb.ref(db, p ? `${root}/${p}` : root);

  return {
    mode: 'firebase',
    // 진행자 로그인: 파이어베이스 콘솔에서 만든 계정 + admins 목록에 있는 계정만 진행자
    onAuth: cb => fa.onAuthStateChanged(auth, cb),
    signIn: (email, password) => fa.signInWithEmailAndPassword(auth, email, password),
    signOut: () => fa.signOut(auth),
    async isAdmin(uid) {
      try { return (await fb.get(fb.ref(db, `admins/${uid}`))).val() === true; } catch { return false; }
    },
    on: (path, cb, onError) => fb.onValue(ref(path), s => cb(s.val()), onError),
    set: (path, val) => fb.set(ref(path), val),
    update: (path, val) => fb.update(ref(path), val),
    remove: path => fb.remove(ref(path)),
    push(path, val) {
      const node = fb.push(ref(path));
      fb.set(node, val).catch(err => window.dispatchEvent(new CustomEvent('store-error', { detail: err })));
      return node.key;
    },
    // 창을 닫거나 인터넷이 끊기면 자동으로 지워지는 값 (접속 중 표시용)
    presence(path, val) {
      const node = ref(path);
      fb.onDisconnect(node).remove();
      return fb.set(node, val);
    },
    onConnection: cb => fb.onValue(fb.ref(db, '.info/connected'), s => cb(!!s.val())),
    onServerOffset: cb => fb.onValue(fb.ref(db, '.info/serverTimeOffset'), s => cb(s.val() || 0))
  };
}

function localStore(root) {
  const KEY = 'ws-preview:' + root;
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(KEY) : null;
  const subs = new Set();

  const load = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  };
  let data = load();

  const read = path => (path ? path.split('/') : []).reduce((o, k) => (o == null ? undefined : o[k]), data);
  const copy = v => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

  function write(path, val) {
    const keys = path.split('/');
    let o = data;
    for (const k of keys.slice(0, -1)) {
      if (typeof o[k] !== 'object' || o[k] === null) o[k] = {};
      o = o[k];
    }
    const last = keys[keys.length - 1];
    if (val === null || val === undefined) delete o[last];
    else o[last] = copy(val);
  }

  function notify() { subs.forEach(s => s.cb(copy(read(s.path)))); }
  function commit() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
    if (channel) channel.postMessage('changed');
    notify();
  }

  // 고칠 때마다 저장된 최신 내용을 먼저 읽고 그 위에 고친다 (다른 탭 내용을 덮어쓰지 않게)
  function change(fn) { data = load(); fn(); commit(); }

  const reload = () => { data = load(); notify(); };
  if (channel) channel.onmessage = reload;
  window.addEventListener('storage', e => { if (e.key === KEY) reload(); });

  const presenceKeys = new Set();
  window.addEventListener('pagehide', () => {
    data = load(); // 다른 탭이 바꾼 최신 내용 위에서 내 접속 표시만 지운다
    presenceKeys.forEach(p => write(p, null));
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
    if (channel) channel.postMessage('changed');
  });

  // 미리보기 모드의 로그인은 흉내만 낸다 (어떤 비밀번호든 통과, 이 탭에서만 유지)
  const authSubs = new Set();
  let authUser = null;
  try { if (sessionStorage.getItem('ws-preview-admin')) authUser = { uid: 'preview-admin', email: '미리보기' }; } catch {}
  const setAuth = u => {
    authUser = u;
    try { if (u) sessionStorage.setItem('ws-preview-admin', '1'); else sessionStorage.removeItem('ws-preview-admin'); } catch {}
    authSubs.forEach(cb => cb(u));
  };

  return {
    mode: 'preview',
    onAuth(cb) { authSubs.add(cb); cb(authUser); },
    async signIn(email) { setAuth({ uid: 'preview-admin', email }); },
    async signOut() { setAuth(null); },
    async isAdmin() { return true; },
    on(path, cb) {
      const sub = { path, cb };
      subs.add(sub);
      cb(copy(read(path)));
      return () => subs.delete(sub);
    },
    async set(path, val) { change(() => write(path, val)); },
    async update(path, val) {
      change(() => { for (const [k, v] of Object.entries(val)) write(`${path}/${k}`, v); });
    },
    async remove(path) { change(() => write(path, null)); },
    push(path, val) {
      const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      change(() => write(`${path}/${key}`, val));
      return key;
    },
    async presence(path, val) { presenceKeys.add(path); change(() => write(path, val)); },
    onConnection: cb => cb(true),
    onServerOffset: cb => cb(0)
  };
}
