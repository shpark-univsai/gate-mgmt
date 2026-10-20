// 메일 언어 선택 버튼의 국기. 이모지 국기는 Windows에서 글자(US · KR)로 보여서 SVG로 그려요.
// 국기 색은 디자인 토큰이 아니라 국기 고유색이에요.

const box = { width: 20, height: 14, borderRadius: 2, flex: "none" as const, display: "block" };

export function FlagUS() {
  const stripe = 24 / 13;
  return (
    <svg viewBox="0 0 36 24" style={box} aria-hidden="true">
      <rect width="36" height="24" fill="#fff" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} y={i * stripe} width="36" height={stripe} fill="#b22234" />
      ))}
      <rect width="15.5" height={stripe * 7} fill="#3c3b6e" />
      {[0, 1, 2, 3].map((r) =>
        [0, 1, 2, 3, 4].map((c) => (
          <circle key={`${r}-${c}`} cx={2 + c * 2.9 + (r % 2) * 1.45} cy={2 + r * 2.9} r="0.6" fill="#fff" />
        )),
      )}
      <rect x="0.25" y="0.25" width="35.5" height="23.5" fill="none" stroke="var(--gray-200)" strokeWidth="0.5" />
    </svg>
  );
}

export function FlagKR() {
  const bars = "M-6-25H6M-6-22H6M-6-19H6M-6 19H6M-6 22H6M-6 25H6";
  return (
    <svg viewBox="-36 -24 72 48" style={box} aria-hidden="true">
      <rect x="-36" y="-24" width="72" height="48" fill="#fff" />
      <g transform="rotate(-56.31)">
        <path d={bars} stroke="#000" strokeWidth="2" />
        <path d="M0 17v10" stroke="#fff" strokeWidth="1" />
        <circle r="12" fill="#cd2e3a" />
        <path d="M0-12A6 6 0 0 0 0 0A6 6 0 0 1 0 12A12 12 0 0 1 0-12Z" fill="#0047a0" />
      </g>
      <g transform="rotate(-123.69)">
        <path d={bars} stroke="#000" strokeWidth="2" />
        <path d="M0-23.5v3M0 17v3.5M0 23.5v3" stroke="#fff" strokeWidth="1" />
      </g>
      <rect x="-35.5" y="-23.5" width="71" height="47" fill="none" stroke="var(--gray-200)" strokeWidth="1" />
    </svg>
  );
}
