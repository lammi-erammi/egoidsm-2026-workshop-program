// ─────────────────────────────────────────────────────────────
// 1) 파이어베이스 설정
//    파이어베이스 콘솔 > 프로젝트 설정 > 내 앱(웹) 에 나오는 firebaseConfig 를
//    아래 null 자리에 그대로 붙여 넣는다. (설정_가이드.md 3단계)
//    비워 두면 '미리보기 모드'로 돈다 — 같은 컴퓨터의 브라우저 탭끼리만 공유된다.
//
//    참고: 이 값은 비밀번호가 아니라 '어느 저장소인지' 알려 주는 주소다.
//    깃허브에 공개돼도 괜찮고, 실제 보호는 database.rules.json 과 비밀 링크 코드가 한다.
// ─────────────────────────────────────────────────────────────
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCRdU_OuizvSGlDCrMe7MF7zNCAZEmikXU",
  authDomain: "workshop-program.firebaseapp.com",
  databaseURL: "https://workshop-program-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "workshop-program",
  storageBucket: "workshop-program.firebasestorage.app",
  messagingSenderId: "318139934123",
  appId: "1:318139934123:web:291615e16fc12300d7deee"
};

/* 붙여 넣으면 이런 모양이 된다 (값은 예시):
export const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "egoism-workshop.firebaseapp.com",
  databaseURL: "https://egoism-workshop-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "egoism-workshop",
  appId: "1:123:web:abc"
};
*/

// 2) 행사 정보 (화면 위쪽과 A1 출력물에 들어간다)
export const EVENT = {
  title: '2026 에고이즘 워크샵',
  program: '경영팀 프로그램',
  date: '2026. 10. 22'
};

// 3) 진행 순서와 시간(분). 진행자 화면의 타이머가 이 시간을 쓴다.
//    focus: 이 단계에서 강조할 칸 (mission = 미션·목표 카드, q1·q2·q3 = 질문 칸, plan = 실행 계획 칸)
//    silent: 단계 시작 뒤 '혼자 쓰는 시간'(분). 그동안 화면에 '혼자 쓰기'가 보이고, 지나면 '함께 이야기'로 바뀐다
//    ask: 그 단계에서 화면 위에 띄우는 진행자 질문
//    15:30~16:30 (단계 합계 55분, 5분 여유)
export const AGENDA = [
  { title: '접속 안내', minutes: 2, focus: '', desc: '핸드폰으로 들어와 이름과 팀을 골라요' },
  { title: '오프닝', minutes: 3, focus: 'mission', desc: '미션과 2026 팀퀘스트 목표, 지금 달성률을 함께 봐요' },
  { title: '걸림돌 찾기', minutes: 10, focus: 'q1', silent: 3, desc: '목표까지 남은 차이가 생긴 가장 큰 원인은?', ask: '숫자로 보면 어디에서 차이가 벌어졌나요?' },
  { title: '전략·계획', minutes: 15, focus: 'q2', silent: 3, desc: '12월까지 미션과 목표를 달성하려면 어떻게 해야 할까?', ask: '남은 기간, 무엇에 집중하고 무엇을 멈출까요?' },
  { title: '구체적 실행안', minutes: 15, focus: 'q3', silent: 3, desc: '높은 성과를 내려면 어떻게 일해야 할까?', ask: '그래서 다음 주 월요일에 누가 무엇을 하나요?' },
  { title: '실행 계획 확정', minutes: 10, focus: 'plan', desc: '실행안을 골라 담당·기한·확인할 숫자까지 채워요', ask: '12월 31일에 무엇을 보면 해냈다고 말할 수 있나요?' }
];

// 4) 질문 세 개 (포스트잇 칸). poster = A1 전지에 들어갈 짧은 제목, hint = 입력 칸 예시
export const QUESTIONS = [
  { id: 'q1', short: '걸림돌 찾기', poster: '목표까지의 걸림돌',
    text: '목표까지 남은 차이가 생긴 가장 큰 원인은 무엇일까?',
    hint: '예: 신제품 출시가 2달 늦어져 3분기 매출이 빠졌다' },
  { id: 'q2', short: '전략·계획', poster: '12월까지의 전략·계획',
    text: '12월까지 미션과 목표를 달성하려면 어떻게 해야 할까? (전략·계획·실행방안)',
    hint: '예: 연말 선물 수요에 맞춰 세트 상품 2종을 11월 첫 주에 연다' },
  { id: 'q3', short: '구체적 실행안', poster: '구체적인 실행안',
    text: '높은 성과를 내려면 어떻게 일해야 할까? (구체적인 실행안)',
    hint: "예: '소통 강화' 말고 '매주 월 10시 재고·판매 15분 점검'처럼" }
];

// 5) 마지막 단계 '12월까지 실행 계획' (A1 전지 가운데에 크게 들어간다)
export const PLAN = {
  title: '12월까지 실행 계획',
  max: 5,
  fields: [
    { key: 'what', label: '실행안', max: 40, hint: '예: 재구매 고객 대상 쿠폰 실험' },
    { key: 'who', label: '담당', max: 20, hint: '예: 홍길동' },
    { key: 'when', label: '기한', max: 20, hint: '예: 11/30' },
    { key: 'metric', label: '확인할 숫자', max: 30, hint: '예: 재구매율 +3%p' }
  ]
};
