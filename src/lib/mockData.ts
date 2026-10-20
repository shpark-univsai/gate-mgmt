export const apiCallTrendData = [
  { date: "6/11(목)", face: 500, palm: 1400 },
  { date: "6/12(금)", face: 850,  palm: 550 },
  { date: "6/13(토)", face: 1380,  palm: 940 },
  { date: "6/14(일)", face: 900, palm: 1200 },
  { date: "6/15(월)", face: 1410, palm: 950 },
  { date: "6/16(화)", face: 1320, palm: 1060 },
  { date: "6/18(수)", face: 1480, palm: 590 },
];

// 시간대별 가중치 (00:00 ~ 21:00, 3h 간격)
const HOURLY_RATIO = [0.06, 0.02, 0.05, 0.22, 0.38, 0.28, 0.18, 0.08];
const TIMES = ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"];

function genFace(scale: number) {
  return TIMES.map((time, i) => {
    const base = scale * HOURLY_RATIO[i];
    return {
      time,
      등록:      Math.round(base * 0.19),
      "1:N매칭": Math.round(base * 0.10),
      "1:1인증": Math.round(base * 0.21),
      "1:1사진": Math.round(base * 0.21),
      라이브니스: Math.round(base * 0.20),
    };
  });
}

function genPalm(scale: number) {
  return TIMES.map((time, i) => {
    const base = scale * HOURLY_RATIO[i];
    return {
      time,
      등록:      Math.round(base * 0.19),
      "1:N매칭": Math.round(base * 0.09),
      라이브니스: Math.round(base * 0.73),
    };
  });
}

export const faceHourlyByDate: Record<string, ReturnType<typeof genFace>> = {
  "6/11(목)": genFace(660),
  "6/12(금)": genFace(1330),
  "6/13(토)": genFace(1570),
  "6/14(일)": genFace(540),
  "6/15(월)": genFace(1560),
  "6/16(화)": genFace(1530),
  "6/18(수)": genFace(1690),
};

export const palmHourlyByDate: Record<string, ReturnType<typeof genPalm>> = {
  "6/11(목)": genPalm(1450),
  "6/12(금)": genPalm(1220),
  "6/13(토)": genPalm(800),
  "6/14(일)": genPalm(600),
  "6/15(월)": genPalm(1170),
  "6/16(화)": genPalm(1360),
  "6/18(수)": genPalm(780),
};

// 기존 호환용 (하위 사용처에서 fallback)
export const faceHourlyData = faceHourlyByDate["6/18(수)"];
export const palmHourlyData = palmHourlyByDate["6/18(수)"];

export const topCustomers = [
  { rank: 1, company: "company-a",   email: "user1@example.com",        authTypes: ["손바닥", "얼굴"], calls: 64410 },
  { rank: 2, company: "company-b",     email: "user2@example.com", authTypes: ["손바닥", "얼굴"], calls: 52540 },
  { rank: 3, company: "company-c.example", email: "",                  authTypes: ["손바닥", "얼굴"], calls: 37670 },
  { rank: 4, company: "company-d",   email: "user4@example.com",     authTypes: ["손바닥"],         calls: 29800 },
  { rank: 5, company: "company-e", email: "user5@example.com",    authTypes: ["손바닥", "얼굴"], calls: 21930 },
];

export const newProjects = [
  { name: "AI 기반 고객 분석 플랫폼",  createdAt: "3시간 전" },
  { name: "스마트 물류 관리 시스템",   createdAt: "1일 전" },
  { name: "디지털 헬스케어 앱 개발",   createdAt: "2일 전" },
  { name: "ERP 시스템 고도화",         createdAt: "2일 전" },
  { name: "클라우드 마이그레이션",     createdAt: "3일 전" },
];

export const activeProjectData = [
  { date: "6/11(목)", value: 11480,  prev: 11830 },
  { date: "6/12(금)", value: 6990, prev: 5900 },
  { date: "6/13(토)", value: 6130,  prev: 10340 },
  { date: "6/14(일)", value: 3790,  prev: 13000 },
  { date: "6/15(월)", value: 13510, prev: 12280 },
  { date: "6/16(화)", value: 10470, prev: 3430 },
  { date: "6/18(수)", value: 4650, prev: 14950 },
];

export const alerts = [
  {
    id: 1, type: "영업 타겟", typeColor: "#3B82F6", company: "company-f",    time: "6/18(수)",
    message: "company-f.example 도메인 계정 신규 가입 감지 – 영업 연락 관리",
  },
  {
    id: 2, type: "한도 임박", typeColor: "#F59E0B", company: "company-a", time: "6/18(수)",
    message: "프로젝트 8/10 생성 – 허용 한도의 90% 초과",
  },
  {
    id: 3, type: "답변 요망", typeColor: "#64748A", company: "company-c", time: "6/17(화)",
    message: "[API 연동 문의] '얼굴 인증 호출 시 403 에러 발생, SDK 설정 확인 필요'",
  },
  {
    id: 4, type: "긴급 CS",  typeColor: "#EF4444", company: "company-b",   time: "6/16(화)",
    message: "얼굴 라이브니스 에러율 30.0% – 즉시 대응 필요", urgent: true,
  },
];

// ── 최근 30일 일별 데이터 (5/20 ~ 6/18) ─────────────────────────────────
const trend30Raw = [
  { date: "5/20(월)", face: 950, palm: 1150  },
  { date: "5/21(화)", face: 1340, palm: 360  },
  { date: "5/22(수)", face: 1320, palm: 860  },
  { date: "5/23(목)", face: 1610, palm: 1270  },
  { date: "5/24(금)", face: 650, palm: 920  },
  { date: "5/25(토)", face: 1610,  palm: 1130  },
  { date: "5/26(일)", face: 1270,  palm: 990  },
  { date: "5/27(월)", face: 1590, palm: 1390  },
  { date: "5/28(화)", face: 950, palm: 700  },
  { date: "5/29(수)", face: 1500, palm: 700  },
  { date: "5/30(목)", face: 680, palm: 660  },
  { date: "5/31(금)", face: 1010, palm: 650  },
  { date: "6/1(토)",  face: 1620,  palm: 970  },
  { date: "6/2(일)",  face: 1380,  palm: 1350  },
  { date: "6/3(월)",  face: 570, palm: 630  },
  { date: "6/4(화)",  face: 1170, palm: 910  },
  { date: "6/5(수)",  face: 1010, palm: 530  },
  { date: "6/6(목)",  face: 1590, palm: 370  },
  { date: "6/7(금)",  face: 940, palm: 710 },
  { date: "6/8(토)",  face: 1300,  palm: 1410  },
  { date: "6/9(일)",  face: 1120,  palm: 500  },
  { date: "6/10(월)", face: 990, palm: 640  },
  { date: "6/11(목)", face: 940, palm: 810  },
  { date: "6/12(금)", face: 900,  palm: 940 },
  { date: "6/13(토)", face: 1240,  palm: 580  },
  { date: "6/14(일)", face: 1590, palm: 850  },
  { date: "6/15(월)", face: 1540, palm: 1060 },
  { date: "6/16(화)", face: 1260, palm: 920 },
  { date: "6/17(수)", face: 1110, palm: 1130 },
  { date: "6/18(목)", face: 1630, palm: 780 },
];
export const apiCallTrend30 = trend30Raw;
export const faceHourlyBy30: Record<string, ReturnType<typeof genFace>> = {};
export const palmHourlyBy30: Record<string, ReturnType<typeof genPalm>> = {};
trend30Raw.forEach(({ date, face, palm }) => {
  faceHourlyBy30[date] = genFace(face);
  palmHourlyBy30[date] = genPalm(palm);
});

// ── 최근 3개월 주별 데이터 (3/4주 ~ 6/4주) ──────────────────────────────
const WEEKDAYS_KO = ["월", "화", "수", "목", "금", "토", "일"];
const DAILY_W     = [0.17, 0.18, 0.19, 0.16, 0.18, 0.06, 0.06];

function genFaceDaily(weekTotal: number) {
  return WEEKDAYS_KO.map((day, i) => {
    const s = weekTotal * DAILY_W[i];
    return { day, 등록: Math.round(s * 0.19), "1:N매칭": Math.round(s * 0.10),
             "1:1인증": Math.round(s * 0.21), "1:1사진": Math.round(s * 0.21),
             라이브니스: Math.round(s * 0.20) };
  });
}
function genPalmDaily(weekTotal: number) {
  return WEEKDAYS_KO.map((day, i) => {
    const s = weekTotal * DAILY_W[i];
    return { day, 등록: Math.round(s * 0.19), "1:N매칭": Math.round(s * 0.09),
             라이브니스: Math.round(s * 0.73) };
  });
}

const trend90Raw = [
  { week: "3/4주", face: 8040, palm: 4330 },
  { week: "4/1주", face: 5040, palm: 4240 },
  { week: "4/2주", face: 5300, palm: 3500 },
  { week: "4/3주", face: 7470, palm: 4190 },
  { week: "4/4주", face: 7960, palm: 4970 },
  { week: "5/1주", face: 7750, palm: 4210 },
  { week: "5/2주", face: 8530, palm: 4210 },
  { week: "5/3주", face: 6500, palm: 6180 },
  { week: "5/4주", face: 5470, palm: 4970 },
  { week: "6/1주", face: 5010, palm: 6240 },
  { week: "6/2주", face: 7550, palm: 6270 },
  { week: "6/3주", face: 5080, palm: 6200 },
  { week: "6/4주", face: 5750, palm: 6410 },
];
export const apiCallTrend90 = trend90Raw;
export const faceDailyByWeek: Record<string, ReturnType<typeof genFaceDaily>> = {};
export const palmDailyByWeek: Record<string, ReturnType<typeof genPalmDaily>> = {};
trend90Raw.forEach(({ week, face, palm }) => {
  faceDailyByWeek[week] = genFaceDaily(face);
  palmDailyByWeek[week] = genPalmDaily(palm);
});

export const activityFeed = [
  { time: "6/18(수)", content: "'company-g' 계정 정지 처리 — 모든 API 키 즉시 폐기", actor: "admin1@example.com" },
  { time: "6/18(수)", content: "'proj_legacy_v1' 프로젝트 API 키 강제 정지",               actor: "admin1@example.com" },
  { time: "6/17(화)", content: "'company-d' 엔터프라이즈 플랜 승인 처리",               actor: "admin2@example.com" },
];
