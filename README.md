# Knowledge RPG

수학 문제를 풀어 스킬별 XP를 쌓는 웹사이트예요. 스킬 13개와 SymPy로 만든 문제 14,484개가 들어 있어요. 문제 유형은 OpenStax 교과서의 연습문제 종류를 따랐고(`content/SOURCES.md`), 교과서 문제를 그대로 옮기지는 않았어요.

문제를 맞히면 그 스킬의 바로 앞 단계(선수 스킬)도 XP의 일부를 받아요. 비율은 스킬 노트의 `rpg_prerequisite_share`(퍼센트)로 정해요. 예를 들어 일차방정식은 30이라서, 일차방정식 문제로 50 XP를 받으면 사칙연산도 15 XP를 받아요. 문제에 이미 붙은 스킬은 따로 받지 않고, 녹슮을 풀지는 않아요(연습한 날짜는 그대로예요). 두 단계 이상 떨어진 스킬로는 넘어가지 않아요.

문제 하나는 사용자마다 스킬별로 한 번만 XP를 줘서, 문제 은행이 곧 XP의 천장이에요. 지금은 다 풀면 스킬에 따라 Lv 65(`trigonometry`)에서 Lv 94(`function-values`)까지 올라가요. Lv 90 시험에 닿는 스킬은 `derivatives`, `function-values`, `linear-equations` 셋이에요. 나머지는 A·S급 복합 유형이 적어서 막혀요. 복합 유형은 답이 서로 달라야 해서(답을 본 문제의 답을 다른 문제에 다시 입력하는 것을 막기 위해) 숫자 범위가 좁은 유형은 몇 개만 만들어져요. A·S급 유형을 더 쓰면 풀리는 한계예요.

`scripts/generate_seed.py`는 유형마다 최대 200개를 만들고, 서로 다른 문제가 300번 연속 나오지 않으면 그 유형을 멈춰요. 실행하는 데 1분 남짓 걸려요.

## 로컬 실행

처음 한 번 (Rust는 `rustup`으로 설치):

```bash
npm install
python3.13 -m venv .venv && .venv/bin/pip install sympy==1.14.0
cp .env.example .env
npm run db:start
npm run db:reset
```

평소에는 터미널 두 개에서:

```bash
npm run db:start && npm run api
```

```bash
npm run dev
```

`npm run api`는 Rust 서버를 8787번 포트로 띄우고, `npm run dev`의 화면이 `/api`를 그쪽으로 넘겨요. `npm run db:reset`은 로컬 DB를 지우고 다시 만들어요. `npm test`는 Rust 단위 테스트와, 서버를 직접 띄워 HTTP로 게임 규칙을 확인하는 테스트를 돌려요. DB가 꺼져 있으면 DB 테스트는 건너뛰어요.

## 구조

- `server/grade.rs`: 답안 검사와 채점. LaTeX 일부만 직접 해석하고, 소수 2^61−1을 법으로 무작위 점에서 값을 비교해 동치를 판정해요
- `server/xp.rs`: 레벨, 승급 관문, 등급별 XP, 녹슮 규칙. `src/shared/xp.ts`와 같은 값을 유지해요
- `server/placement.rs`: 배치 고사의 이진 탐색
- `server/game.rs`: 게임 규칙. 쓰기 요청은 사용자 행을 잠근 트랜잭션 하나 안에서 처리해요
- `server/auth.rs`: Google, LINE 로그인과 세션. 이메일과 이름은 저장하지 않아요
- `server/lib.rs`: API 입구. 경로, 입력 검사, Origin 검사
- `api/index.rs`: Vercel 함수 입구. `LOCAL_PORT`가 있으면 로컬 서버로 떠요
- `src/client/`: 스킬 트리 화면
- `content/skills/`: 스킬 정의. 옵시디언 노트로 열 수 있어요
- `scripts/generate_seed.py`: 문제 생성. 로컬에서만 실행해요
- `db/migrations/`: DB 구조
- `legacy/cloudflare-worker/`: 예전 TypeScript 서버. 실행하지 않아요

## 지켜야 할 규칙

- 사용자 답안을 SymPy의 `sympify`, `parse_expr`, `lambdify`에 넣지 않아요. 코드 실행이 가능해요. SymPy는 문제를 만들 때만 써요.
- `answer_latex`는 API 응답에 넣지 않아요. 예외는 `POST /api/problems/reveal` 하나뿐이에요. 저장소는 비공개로 둬요.
- 채점에 새 문법을 허용할 때는 크기 제한(차수, 지수, 깊이, 길이)을 함께 정하고, 오래 걸리는 입력을 `server/grade_tests.rs`에 추가해요.
- `DEV_LOGIN`은 배포 환경에 절대 넣지 않아요. 서버도 `BASE_URL`이 `http://localhost`일 때만 받아들여요.

## 첫 배포 전 할 일 (Vercel Hobby + Neon Free)

1. Vercel 프로젝트의 Storage에서 Neon을 연결해요(`aws-us-east-1`). `DATABASE_URL`이 자동으로 들어가요. 빈 DB에는 `PROD_DATABASE_URL=<DATABASE_URL_UNPOOLED 값> npm run db:deploy`로 테이블과 문제를 넣어요. 나중에 추가된 마이그레이션은 `psql`로 하나씩 적용해요.
2. Vercel에서 이 저장소를 새 프로젝트로 가져와요. 설정은 `vercel.json`에 있어요. Rust 런타임은 아직 Beta예요.
3. Vercel 프로젝트 설정의 환경 변수에 넣어요: `DATABASE_URL`(Neon, `sslmode=require`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `LINE_CLIENT_ID`, `LINE_CLIENT_SECRET`. `BASE_URL`은 직접 도메인을 쓸 때만 넣고, 없으면 Vercel 기본 주소를 써요.
4. Google과 LINE 로그인 앱을 만들어요. 콜백 주소는 `<사이트 주소>/api/auth/callback/google`, `/api/auth/callback/line`이에요.
5. Hobby 요금제는 비상업 용도만 허용해요. 광고나 결제를 붙이려면 Pro로 옮겨야 해요.
