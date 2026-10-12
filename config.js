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
//    focus: 이 단계에서 강조할 칸 (q1·q2·q3 = 질문 칸, agree = 전지 합의 칸)
//    15:30~16:30 (단계 합계 55분, 5분 여유)
export const AGENDA = [
  { title: '접속 안내', minutes: 2, focus: '', desc: '핸드폰으로 들어와 이름과 팀을 골라요' },
  { title: '오프닝', minutes: 3, focus: 'mission', desc: '회사·부서의 미션과 목표를 함께 읽어요' },
  { title: '회사 얼라인', minutes: 12, focus: 'q1', desc: '회사 미션·목표를 위해 우리 팀은 무엇을 할까?' },
  { title: '팀 얼라인', minutes: 12, focus: 'q2', desc: '팀 미션·목표에 맞추려면 어떻게 할까?' },
  { title: '일하는 방법', minutes: 12, focus: 'q3', desc: '높은 성과를 내려면 어떻게 일할까?' },
  { title: '우리 이렇게 일하자', minutes: 14, focus: 'agree', desc: '팀이 합의한 문장 3개를 전지에 정리해요' }
];

// 4) 질문 세 개 (포스트잇 칸)
export const QUESTIONS = [
  { id: 'q1', short: '회사 얼라인', text: '회사 미션·목표를 위해 우리 팀은 무엇을 할까?' },
  { id: 'q2', short: '팀 얼라인', text: '팀 미션·목표에 맞추려면 어떻게 할까?' },
  { id: 'q3', short: '일하는 방법', text: '높은 성과를 내려면 어떻게 일할까?' }
];
