// 명함 읽기(UG-431) 도구 파일을 node_modules 에서 public/ocr/ 로 복사한다 — `npm run dev` · `npm run build` 전에 자동으로 돈다.
// 화면이 실행 중에 외부 CDN(jsdelivr)에서 받지 않게, 같은 출처(/ocr/...)에서 서빙한다(CSP 도 'self' 만 허용).
// 복사본은 커밋하지 않는다(.gitignore) — 16MB 남짓한 바이너리이고, package-lock 으로 고정한 버전에서 언제든 다시 만들어진다.
// postinstall 이 아니라 prebuild 인 까닭: 이미지 빌드(Dockerfile)는 package*.json 만 복사한 뒤 npm ci 를 돌려 그때는 이 스크립트가 없다.
import { copyFileSync, mkdirSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "ocr");
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));

// 화면(src/lib/card-ocr.ts)이 부르는 경로와 같아야 한다.
const files = [
  // 일꾼(Web Worker) 스크립트
  [join(pkgDir("tesseract.js"), "dist", "worker.min.js"), "worker.min.js"],
  // 글자 인식 엔진(wasm 을 품은 js). LSTM 전용 세 가지 — 기기가 지원하는 것(relaxed SIMD → SIMD → 기본)을 라이브러리가 고른다.
  ...["tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"].map((f) => [
    join(pkgDir("tesseract.js-core"), f),
    join("core", f),
  ]),
  // 언어 데이터(한국어 · 영어, LSTM 정수 모델 — 라이브러리 기본값과 같은 4.0.0_best_int)
  ...["kor", "eng"].map((lang) => [
    join(pkgDir(`@tesseract.js-data/${lang}`), "4.0.0_best_int", `${lang}.traineddata.gz`),
    join("lang", `${lang}.traineddata.gz`),
  ]),
];

rmSync(out, { recursive: true, force: true });
let total = 0;
for (const [from, to] of files) {
  const dest = join(out, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(from, dest);
  total += statSync(dest).size;
}
console.log(`[copy-ocr-assets] ${files.length}개 파일 → public/ocr/ (${(total / 1024 / 1024).toFixed(1)}MB)`);
