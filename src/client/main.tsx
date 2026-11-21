import '@fontsource/dotgothic16/400.css';
import '@fontsource/mulish/400.css';
import '@fontsource/mulish/600.css';
import '@fontsource/mulish/800.css';
import '@fontsource/press-start-2p/400.css';
import 'katex/dist/katex.min.css';
import './styles.css';

import katex from 'katex';
import { MathfieldElement } from 'mathlive';
import { useCallback, useEffect, useRef, useState, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { effectiveLevel, GRADE_XP, gradeAfterReveal, levelProgress, rustDays, xpForLevel, type Grade } from '../shared/xp.ts';
import { isUnfinished } from './answer.ts';

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': DetailedHTMLProps<HTMLAttributes<MathfieldElement>, MathfieldElement>;
    }
  }
}

// The KaTeX stylesheet above already provides these fonts.
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;

const COPY = {
  en: {
    title: 'Math skill tree',
    heroPre: 'STAGE 1 · MATH',
    heroTitle: ['Solve math.', 'Level up.'],
    heroTag: 'Turn what you learn into skills, and level them up one problem at a time.',
    mapKicker: 'WORLD MAP',
    questKicker: 'QUEST',
    skillKicker: 'SKILL',
    testKicker: 'TEST',
    nextAt: (xp: string) => `Next level at ${xp} XP`,
    legendActive: 'In practice',
    legendRusty: 'Rusty (level stays)',
    legendGate: 'Promotion test',
    nav: { play: 'Quest', skills: 'Skills', world: 'World map', rules: 'Rules' },
    heroCta: 'Start a quest',
    heroMap: 'See the map',
    hudKicker: 'YOUR CHARACTER',
    hudSkills: 'Skills',
    hudRusty: 'Rusty',
    hudTests: 'Tests ready',
    playH: 'Solve a problem, gain XP',
    playSub: 'Pick a skill. The grade follows your level: D to start, then C, B, A and S as you climb.',
    skillLabel: 'Skill',
    gradeName: { D: 'EXAMPLE', C: 'PRACTICE', B: 'QUIZ LEVEL', A: '2 SKILLS', S: '3+ SKILLS' },
    skillsKicker: 'SKILLS',
    skillsH: 'Explore the skills',
    skillsSub: 'Math is split into skills, from middle school to first-year university. Pick one to practice it.',
    filters: { all: 'All', alg: 'Algebra', fun: 'Functions', cal: 'Calculus' },
    cat: 'SKILL',
    needs: (names: string) => `Requires: ${names}`,
    noNeeds: 'No prerequisite',
    practice: 'Practice',
    tagActive: 'ACTIVE',
    tagRusty: 'RUSTY',
    tagGate: 'PROMOTION TEST',
    worldH: 'One world of skills, linked by prerequisites',
    stats: ['Levels per skill', 'Problem grades, D to S', 'XP ever taken away', 'XP on a recovery problem'],
    share: 'Solving it also gives part of the XP to the skills it builds on.',
    gateReached: (gate: number) => `Reached level ${gate}. Pass the promotion test to go higher.`,
    r1: {
      k: 'XP', h: 'Harder problems pay more',
      p: 'Problems come in five grades. Your level picks the grade: D below Lv 10, C below 30, B below 50, A below 70, then S.',
      items: ['Showed the answer? The problem pays one grade less.', 'Mixed problems split their XP, and the skills they build on get a share too.'],
    },
    gradeRows: { D: 'Follow a worked example', C: 'Practice problem', B: 'Homework or quiz level', A: 'Combines 2 skills', S: '3 skills or more' },
    r2: {
      k: 'RUST', h: 'Skills rust, but never drop',
      p: 'A skill you leave alone turns grey. Your level and XP are never taken away, and higher levels take longer to rust.',
      items: ['One problem of grade C or higher restores it.', 'That recovery problem pays 1.5x XP: 375 instead of 250 for grade C.'],
    },
    days: 'days',
    r3: {
      k: 'LEVEL 1-99', h: 'Level 99 is legend',
      p: 'Levels follow the RuneScape XP curve, so each one costs more than the last. A realistic goal is Lv 50 to 70.',
      items: ['A placement test finds your start in up to 20 problems.', 'Placement can grant Lv 30 at most. The rest you earn.', 'Promotion tests at Lv 30, 60 and 90 open the next levels.'],
    },
    trackGoal: 'Realistic goal 50-70',
    trackLegend: 'Legend 99',
    trackAria: 'Level scale from 1 to 99. Promotion tests at 30, 60 and 90. Realistic goal range 50 to 70.',
    ctaH: 'Your first skill is one problem away',
    ctaP: 'First stage: math, from middle school to first-year university.',
    foot: 'Problem types follow OpenStax textbooks.',
    google: 'Sign in with Google',
    line: 'Sign in with LINE',
    devSignIn: 'Sign in as test player',
    signOut: 'Sign out',
    level: 'Level',
    rusty: 'Rusty',
    rustyHint: 'Solve one grade C or higher problem to restore it, with 1.5× XP.',
    pick: 'Pick a skill to start practicing.',
    signInFirst: 'Sign in to save your XP and start practicing.',
    grade: 'Grade',
    answer: 'Your answer',
    check: 'Check answer',
    next: 'Next problem',
    correct: 'Correct.',
    wrong: 'Not this time. Try the next problem.',
    failed: 'That request failed. Check your connection and try again.',
    retry: 'Try again',
    gateReady: 'Test ready',
    gateWaiting: 'Retry later',
    gateHeld: (gate: number) => `Your level stays at ${gate} until you pass this test. XP keeps counting, so no practice is wasted.`,
    gateJump: (level: number) => `Passing now takes you straight to level ${level}.`,
    testRules: 'The test has 5 problems, and you need 4 correct to pass. Test answers pay no XP, and you can’t show answers during it.',
    startTest: (gate: number) => `Start level ${gate} test`,
    cooldown: (when: string) => `You did not pass last time. You can try again after ${when}, and practice still earns XP until then.`,
    showAnswer: 'Show answer',
    answerKey: 'Answer',
    revealWarning: (grade: string | null) =>
      grade ? `If you show the answer, this problem pays one grade less from now on, as grade ${grade}.` : 'If you show the answer, this problem pays no XP from now on.',
    revealed: (grade: string | null) =>
      grade ? `You saw this answer, so this problem now pays as grade ${grade}.` : 'You saw this answer, so this problem now pays no XP.',
    noXp: 'No XP, because you saw the answer.',
    placementTitle: 'Placement test',
    placementOffer: 'Already know some of this? Answer up to 20 problems to find your starting point. Skills you pass start at level 30.',
    placementRules: 'You can take it once, and only before you earn any XP. Practice is paused until you finish, but you can leave and come back.',
    startPlacement: 'Start placement test',
    openPlacement: 'Your placement test is still open. Practice is paused until you finish it.',
    openPromotion: (gate: number, title: string) => `Your level ${gate} test for ${title} is still open.`,
    resume: 'Resume test',
    leave: 'Leave for now',
    promotionTitle: (gate: number, title: string) => `Level ${gate} test: ${title}`,
    problemCount: (n: number, total: number) => `Problem ${n} of ${total}`,
    placementCount: (n: number, total: number) => `Problem ${n} of up to ${total}`,
    correctCount: (n: number) => `${n} correct so far`,
    testNote: 'Test answers pay no XP, and answers stay hidden.',
    passed: (correct: number, total: number, title: string, level: number) =>
      `You passed with ${correct} of ${total} correct. ${title} is now at level ${level}.`,
    notPassed: (correct: number, total: number) =>
      `You got ${correct} of ${total} correct, and passing takes 4. You can try again in 24 hours, and practice still earns XP until then.`,
    placed: 'These skills now start at level 30:',
    placedNone: 'No skills were placed this time, so everything starts at level 1. Pick a skill to start practicing.',
    backToPractice: 'Back to practice',
    noTestProblems: 'This test needs 5 problems and not enough are available. Problems whose answer you saw can’t be used. Try again later.',
    errors: {
      sign_in_required: 'You are signed out. Reload the page and sign in again.',
      bad_request: 'That answer is too long. Shorten it and try again.',
      not_found: 'This problem could not be found. Reload the page and try again.',
      no_problems_left: 'You have solved every problem for this skill.',
      too_many_attempts: 'Too many answers in one minute. Wait a moment, then try again.',
      already_answered: 'This problem has already been answered. Go to the next problem.',
      reveal_refused: 'Answers stay hidden while a test is open. Finish the test to show them again.',
      test_open: 'You have a test open. Finish it first.',
      test_not_available: 'This test is not available right now. Keep practicing, then check this skill again.',
      placement_unavailable: 'The placement test is no longer available. It is offered once, before you earn any XP.',
    },
  },
  ja: {
    title: '数学スキルツリー',
    heroPre: 'ステージ1 · 数学',
    heroTitle: ['数学を解いて', 'レベルアップ。'],
    heroTag: '学んだことをスキルに分けて、1問ずつレベルを上げていきましょう。',
    mapKicker: 'ワールドマップ',
    questKicker: 'クエスト',
    skillKicker: 'スキル',
    testKicker: '試験',
    nextAt: (xp: string) => `次のレベルまで ${xp} XP`,
    legendActive: '練習中',
    legendRusty: 'さびつき（レベルはそのまま）',
    legendGate: '昇級試験',
    nav: { play: 'クエスト', skills: 'スキル', world: 'ワールドマップ', rules: 'ルール' },
    heroCta: 'クエストを始める',
    heroMap: 'マップを見る',
    hudKicker: 'あなたのキャラクター',
    hudSkills: 'スキル',
    hudRusty: 'さびつき',
    hudTests: '試験あり',
    playH: '1問解いて、XPを手に入れよう',
    playSub: 'スキルを選んでください。等級はレベルに合わせて、D級から始まりC・B・A・S級へと上がります。',
    skillLabel: 'スキル',
    gradeName: { D: '例題', C: '練習', B: '小テスト', A: '2スキル', S: '3スキル以上' },
    skillsKicker: 'スキル',
    skillsH: 'スキルを見てみよう',
    skillsSub: '中学から大学1年までの数学をスキルに分けています。選ぶとそのスキルを練習できます。',
    filters: { all: 'すべて', alg: '代数', fun: '関数', cal: '微積分' },
    cat: 'スキル',
    needs: (names: string) => `前提：${names}`,
    noNeeds: '前提スキルなし',
    practice: '練習する',
    tagActive: '練習中',
    tagRusty: 'さびつき',
    tagGate: '昇級試験',
    worldH: '前提でつながる、ひとつのスキルの世界',
    stats: ['スキルごとのレベル', '問題の等級（D〜S）', '失われるXP', '回復問題のXP倍率'],
    share: '解くと、前提になっているスキルにもXPの一部が入ります。',
    gateReached: (gate: number) => `レベル${gate}に到達しました。昇級試験に合格すると先に進めます。`,
    r1: {
      k: 'XP', h: '難しい問題ほどXPが大きい',
      p: '問題は5つの等級に分かれます。等級はレベルで決まり、Lv 10未満はD級、30未満はC級、50未満はB級、70未満はA級、その先はS級です。',
      items: ['答えを見ると、その問題は1等級下がります。', '複数のスキルを使う問題のXPは分けて入り、前提スキルにも一部が入ります。'],
    },
    gradeRows: { D: '例題をなぞって解く', C: '練習問題', B: '課題・小テストレベル', A: '2つのスキルを組み合わせる', S: '3つ以上のスキル' },
    r2: {
      k: 'サビ', h: 'さびても、下がらない',
      p: 'しばらく使わないスキルは灰色になります。レベルとXPは絶対に減りません。レベルが高いほど、さびるまでの期間が長くなります。',
      items: ['C級以上の問題を1問解けば回復します。', '回復の問題はXP 1.5倍。C級なら250ではなく375 XPです。'],
    },
    days: '日',
    r3: {
      k: 'レベル 1〜99', h: 'Lv 99は伝説',
      p: 'レベルはRuneScapeのXP曲線に従うので、上がるほど必要なXPが増えます。現実的な目標はLv 50〜70です。',
      items: ['実力診断テストは最大20問でスタート地点を決めます。', '実力診断でもらえるのは最大Lv 30まで。その先は自分で上げます。', 'Lv 30・60・90の昇級試験に合格すると次のレベルが開きます。'],
    },
    trackGoal: '現実的な目標 50〜70',
    trackLegend: '伝説 99',
    trackAria: 'レベル1から99の目盛り。昇級試験は30、60、90。現実的な目標は50から70。',
    ctaH: '最初のスキルは、1問で開きます',
    ctaP: '最初のステージは数学（中学〜大学1年）です。',
    foot: '問題タイプはOpenStaxの教科書を参考にしています。',
    google: 'Googleでログイン',
    line: 'LINEでログイン',
    devSignIn: 'テストプレイヤーでログイン',
    signOut: 'ログアウト',
    level: 'レベル',
    rusty: 'さびつき',
    rustyHint: 'C級以上の問題を1問解くと回復し、XPは1.5倍になります。',
    pick: 'スキルを選んで練習を始めましょう。',
    signInFirst: 'ログインするとXPを保存して練習できます。',
    grade: '等級',
    answer: '答え',
    check: '答え合わせ',
    next: '次の問題',
    correct: '正解です。',
    wrong: '不正解です。次の問題に進みましょう。',
    failed: '通信に失敗しました。接続を確認してもう一度お試しください。',
    retry: 'もう一度試す',
    gateReady: '昇級試験あり',
    gateWaiting: '再挑戦待ち',
    gateHeld: (gate: number) => `昇級試験に合格するまで、レベルは${gate}のままです。XPは貯まり続けるので、練習は無駄になりません。`,
    gateJump: (level: number) => `今合格すると、一気にレベル${level}まで上がります。`,
    testRules: '試験は全5問で、4問正解すれば合格です。試験の回答ではXPは入らず、試験中は答えを見られません。',
    startTest: (gate: number) => `レベル${gate}の昇級試験を受ける`,
    cooldown: (when: string) => `前回は不合格でした。${when}以降にもう一度受けられます。それまでの練習でもXPは貯まります。`,
    showAnswer: '答えを見る',
    answerKey: '解答',
    revealWarning: (grade: string | null) =>
      grade ? `答えを見ると、この問題のXPは今後1等級下の${grade}級として計算されます。` : '答えを見ると、この問題では今後XPがもらえなくなります。',
    revealed: (grade: string | null) =>
      grade ? `答えを見たので、この問題のXPは${grade}級として計算されます。` : '答えを見たので、この問題ではXPがもらえません。',
    noXp: '答えを見たので、XPは入りません。',
    placementTitle: '実力診断テスト',
    placementOffer: 'すでに学んだ内容はありますか。最大20問に答えて、スタート地点を決めましょう。合格したスキルはレベル30から始まります。',
    placementRules: '受けられるのは1回だけで、XPを獲得する前に限ります。終わるまで練習はできませんが、途中で抜けて続きから再開できます。',
    startPlacement: '実力診断テストを受ける',
    openPlacement: '実力診断テストが途中のままです。終えるまで練習はできません。',
    openPromotion: (gate: number, title: string) => `${title}のレベル${gate}昇級試験が途中のままです。`,
    resume: '続きから受ける',
    leave: 'いったん中断する',
    promotionTitle: (gate: number, title: string) => `${title}：レベル${gate}昇級試験`,
    problemCount: (n: number, total: number) => `全${total}問中 ${n}問目`,
    placementCount: (n: number, total: number) => `最大${total}問中 ${n}問目`,
    correctCount: (n: number) => `ここまでの正解 ${n}問`,
    testNote: '試験の回答ではXPは入らず、答えも見られません。',
    passed: (correct: number, total: number, title: string, level: number) =>
      `${total}問中${correct}問正解で合格です。${title}はレベル${level}になりました。`,
    notPassed: (correct: number, total: number) =>
      `${total}問中${correct}問正解でした。合格には4問の正解が必要です。24時間後にもう一度受けられます。それまでの練習でもXPは貯まります。`,
    placed: '次のスキルはレベル30から始まります。',
    placedNone: '今回はレベル30から始まるスキルはありませんでした。すべてレベル1からです。スキルを選んで練習を始めましょう。',
    backToPractice: '練習に戻る',
    noTestProblems: 'この試験には5問必要ですが、使える問題が足りません。答えを見た問題は使えません。時間をおいてもう一度お試しください。',
    errors: {
      sign_in_required: 'ログインが切れました。ページを再読み込みして、もう一度ログインしてください。',
      bad_request: '答えが長すぎます。短くしてもう一度お試しください。',
      not_found: 'この問題が見つかりません。ページを再読み込みしてもう一度お試しください。',
      no_problems_left: 'このスキルの問題はすべて解きました。',
      too_many_attempts: '1分間の回答数が多すぎます。少し待ってからもう一度お試しください。',
      already_answered: 'この問題はすでに回答済みです。次の問題に進んでください。',
      reveal_refused: '試験中は答えを見られません。試験を終えると見られるようになります。',
      test_open: '途中の試験があります。先にそちらを終えてください。',
      test_not_available: '今はこの試験を受けられません。練習を続けてから、もう一度このスキルを確認してください。',
      placement_unavailable: '実力診断テストはもう受けられません。受けられるのは、XPを獲得する前の1回だけです。',
    },
  },
};

type Lang = keyof typeof COPY;
const storedLang = (() => {
  try {
    return localStorage.getItem('krpg-lang');
  } catch {
    return null;
  }
})();
const lang: Lang = storedLang === 'en' || storedLang === 'ja' ? storedLang : navigator.language.startsWith('ja') ? 'ja' : 'en';
const copy = COPY[lang];
document.documentElement.lang = lang;
document.title = copy.title;

// ponytail: a reload re-renders every string; switch to state if a reload ever loses work.
const switchLang = (next: Lang) => {
  try {
    localStorage.setItem('krpg-lang', next);
  } catch {}
  location.reload();
};

type Skill = {
  id: string;
  title: { en: string; ja: string };
  prerequisites: string[];
  xp: number;
  level: number;
  passedGates: number[];
  promotion: { gate: number; retryAt: string | null } | null;
  rusty: boolean;
};

type Board = {
  skills: Skill[];
  placementAvailable: boolean;
  signedIn: boolean;
  openTest: { kind: 'promotion' | 'placement'; skillId: string | null; gate: number | null } | null;
};

type Problem = {
  instanceId: string;
  grade: Grade;
  prompt: { en: string; ja: string };
  latex: string;
  revealed: boolean;
};

type TestState = {
  kind: 'promotion' | 'placement';
  skillId: string | null;
  gate: number | null;
  answered: number;
  correct: number;
  total: number;
  passed: boolean | null;
  problem: Problem | null;
  placedSkills: string[];
};

type Result = { correct: boolean; awards: { skillId: string; xp: number }[]; test?: TestState };

type ApiError = { error: string; retryAt?: string; test?: TestState };

// Success bodies never have an `error` key, so `'error' in result` tells the two apart.
const post = <T,>(path: string, body: unknown): Promise<T | ApiError> =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then((response) => response.json() as Promise<T | ApiError>)
    .catch(() => ({ error: 'failed' }));

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString(lang, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

const message = ({ error, retryAt }: ApiError) =>
  retryAt ? copy.cooldown(formatTime(retryAt)) : ((copy.errors as Record<string, string>)[error] ?? copy.failed);

// ponytail: columns by longest prerequisite chain. Move to dagre when the real tree has crossing edges.
const NODE_W = 176;
const NODE_H = 58;
const COL = 204;
const ROW = 92;
const PAD = 14;

function layout(skills: Skill[]) {
  const byId = new Map(skills.map((s) => [s.id, s]));
  const depth = (s: Skill): number =>
    s.prerequisites.length ? 1 + Math.max(...s.prerequisites.map((id) => depth(byId.get(id)!))) : 0;
  const columns: Skill[][] = [];
  for (const s of skills) (columns[depth(s)] ??= []).push(s);
  const rows = Math.max(...columns.map((c) => c.length));
  const positions = new Map<string, { x: number; y: number }>();
  columns.forEach((column, c) =>
    column.forEach((s, r) => positions.set(s.id, { x: PAD + c * COL, y: PAD + (r + (rows - column.length) / 2) * ROW })),
  );
  return {
    positions,
    width: PAD * 2 + (columns.length - 1) * COL + NODE_W + 4,
    height: PAD * 2 + (rows - 1) * ROW + NODE_H + 4,
    ordered: columns.flat(),
  };
}

const status = (s: Skill) =>
  [s.rusty && copy.rusty, s.promotion && (s.promotion.retryAt ? copy.gateWaiting : copy.gateReady)].filter(Boolean).join(' · ');

function SkillTree({ skills, selected, onSelect }: { skills: Skill[]; selected?: string; onSelect: (id: string) => void }) {
  const { positions, width, height, ordered } = layout(skills);
  return (
    <svg className="tree" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width * 0.75 }} role="group" aria-label={copy.mapKicker}>
      {skills.flatMap((s) =>
        s.prerequisites.map((id) => {
          const a = positions.get(id)!;
          const b = positions.get(s.id)!;
          return <path key={id + s.id} className="edge" d={`M${a.x + NODE_W} ${a.y + NODE_H / 2}H${b.x - 14}V${b.y + NODE_H / 2}H${b.x}`} />;
        }),
      )}
      {ordered.map((s) => {
        const { x, y } = positions.get(s.id)!;
        const note = status(s);
        const pick = () => onSelect(s.id);
        return (
          <g
            key={s.id}
            className="node"
            data-rusty={s.rusty}
            data-gate={s.promotion ? (s.promotion.retryAt ? 'waiting' : 'ready') : undefined}
            role="button"
            tabIndex={0}
            aria-pressed={s.id === selected}
            aria-label={`${s.title[lang]}, ${copy.level} ${s.level}${note && `, ${note}`}`}
            onClick={pick}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              pick();
            }}
          >
            <rect className="shade" x={x + 4} y={y + 4} width={NODE_W} height={NODE_H} />
            <rect className="body" x={x} y={y} width={NODE_W} height={NODE_H} />
            <rect className="progress" x={x + 3} y={y + NODE_H - 6} width={(NODE_W - 6) * levelProgress(s.xp, s.passedGates)} height={3} />
            <text className="name" x={x + 12} y={y + 25}>{s.title[lang]}</text>
            <text className="lvl" x={x + 12} y={y + 44}>LV {s.level}</text>
            {note && <text className="st" textAnchor="end" x={x + NODE_W - 10} y={y + 44}>{note}</text>}
          </g>
        );
      })}
    </svg>
  );
}

// Twilight pixel landscape: sky bands, stars, two mountain ranges, a lake and pines, drawn at 4 screen pixels a dot.
function drawScene(canvas: HTMLCanvasElement) {
  const P = 4;
  const w = Math.ceil(canvas.clientWidth / P);
  const h = Math.ceil(canvas.clientHeight / P);
  if (!w || !h) return;
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  let seed = 23;
  const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
  const hz = h - 34;
  const sky = ['#0d0f2b', '#0d0f2b', '#0d0f2b', '#101337', '#15183f', '#1b1d50', '#252463', '#342b78', '#4a3389', '#6a3f93'];
  sky.forEach((color, k) => {
    g.fillStyle = color;
    g.fillRect(0, Math.round((hz * k) / sky.length), w, hz);
  });
  for (let i = 0; i < (w * hz) / 120; i++) {
    const x = Math.floor(rnd() * w);
    const y = Math.floor(rnd() * hz * 0.8);
    g.fillStyle = rnd() > 0.8 ? '#ffcf3a' : '#cfcdf0';
    g.globalAlpha = 0.3 + rnd() * 0.7;
    g.fillRect(x, y, 1, 1);
    if (rnd() > 0.92) {
      g.fillRect(x - 1, y, 3, 1);
      g.fillRect(x, y - 1, 1, 3);
    }
  }
  g.globalAlpha = 1;
  const peak = (px: number, top: number, half: number, color: string, lit: string) => {
    for (let y = top; y < hz + 6; y++) {
      let s = Math.round(((y - top) * half) / (hz - top));
      s -= s % 2;
      g.fillStyle = color;
      g.fillRect(px - s, y, s * 2, 1);
      g.fillStyle = lit;
      g.fillRect(px - Math.round(s * 0.25), y, Math.round(s * 0.5), 1);
    }
  };
  for (let i = 0; i < Math.ceil(w / 56) + 1; i++) peak(Math.round(i * 56 + rnd() * 30 - 10), hz - 16 - Math.round(rnd() * 12), 30 + Math.round(rnd() * 18), '#2a2a70', '#3a3a8c');
  for (let i = 0; i < Math.ceil(w / 84) + 1; i++) peak(Math.round(i * 84 + rnd() * 44), hz - 24 - Math.round(rnd() * 16), 44 + Math.round(rnd() * 22), '#1d2258', '#2b3276');
  const water = ['#1f4a5c', '#1b4355', '#173b4d', '#143345', '#112b3d', '#0f2436'];
  for (let y = hz; y < h; y++) {
    for (let x = 0; x < w; x += 2) {
      const d = (y - hz) / (h - hz);
      const wave = Math.sin(x / 26 + d * 5) * 3 + Math.sin(x / 9 + y / 5) * 1.2;
      g.fillStyle = water[Math.max(0, Math.min(water.length - 1, Math.floor(d * water.length + wave / 4)))];
      g.fillRect(x, y, 2, 1);
    }
  }
  const pine = (px: number, base: number, s: number) => {
    g.fillStyle = '#0a1226';
    g.fillRect(px - 1, base - 2 * s, 2, 2 * s);
    for (let t = 0; t < 4; t++) {
      const ty = base - 2 * s - t * 3 * s;
      for (let r = 0; r < 4 * s; r++) {
        const half = Math.round((r + 1) * (5 - t) * 0.28) + 1;
        g.fillStyle = r % 2 ? '#0c1830' : '#12233f';
        g.fillRect(px - half, ty - 4 * s + r + 2, half * 2, 1);
      }
    }
  };
  for (let i = 0; i < Math.round(w / 9); i++) {
    const depth = rnd();
    pine(Math.round(rnd() * w), Math.round(hz + 4 + depth * 18), depth > 0.55 ? 2 : 1);
  }
  for (let i = 0; i < Math.round(w / 7); i++) {
    const x = Math.round(rnd() * w);
    const y = Math.round(hz - 6 + rnd() * 32);
    g.fillStyle = rnd() > 0.4 ? '#ffcf3a' : '#f472b6';
    g.globalAlpha = 0.5 + rnd() * 0.5;
    g.fillRect(x, y, 1, 1);
  }
  g.globalAlpha = 1;
  g.fillStyle = '#0d0f2b';
  for (let x = 0; x < w; x++) {
    const grass = 3 + Math.round(Math.abs(Math.sin(x * 1.7) * 4 + Math.sin(x * 0.31) * 3));
    g.fillRect(x, h - grass, 1, grass);
  }
}

type Branch = 'alg' | 'fun' | 'cal';
// Card art and blurbs. A skill missing here still shows, with no blurb.
const SKILL_INFO: Record<string, { branch: Branch; sym: string; en: string; ja: string }> = {
  arithmetic: { branch: 'alg', sym: '+−×÷', en: 'Add, subtract, multiply and divide with integers and fractions.', ja: '整数や分数のたし算・ひき算・かけ算・わり算。' },
  'linear-equations': { branch: 'alg', sym: 'ax+b', en: 'Solve for one unknown and set up equations from word problems.', ja: '未知数1つの方程式を解き、文章題から式を立てます。' },
  expanding: { branch: 'alg', sym: 'a(b+c)', en: 'Multiply out brackets and collect like terms.', ja: 'かっこを展開して、同類項をまとめます。' },
  factoring: { branch: 'alg', sym: '(x)(x)', en: 'Break polynomials into products and read the roots off.', ja: '多項式を積の形に分け、解を読み取ります。' },
  'quadratic-equations': { branch: 'alg', sym: 'x²', en: 'Solve by factoring, completing the square and the formula.', ja: '因数分解・平方完成・解の公式で解きます。' },
  sequences: { branch: 'alg', sym: 'aₙ', en: 'Arithmetic and geometric sequences, sums and recurrences.', ja: '等差・等比数列、和、漸化式。' },
  'function-values': { branch: 'fun', sym: 'f(x)', en: 'Graphs, domain and range, composition and inverses.', ja: 'グラフ、定義域と値域、合成関数と逆関数。' },
  trigonometry: { branch: 'fun', sym: 'sin', en: 'Sine, cosine, tangent, the unit circle and identities.', ja: 'サイン・コサイン・タンジェント、単位円、公式。' },
  'exponents-logs': { branch: 'fun', sym: 'log', en: 'Exponent rules, logarithms and their equations.', ja: '指数法則、対数、それらの方程式。' },
  limits: { branch: 'cal', sym: 'lim', en: 'What a function approaches, and how to compute it.', ja: '関数が近づく値と、その求め方。' },
  derivatives: { branch: 'cal', sym: 'dy/dx', en: 'Rates of change, the power, product and chain rules.', ja: '変化の割合、べき・積・連鎖の公式。' },
  integrals: { branch: 'cal', sym: '∫', en: 'Antiderivatives and the area under a curve.', ja: '原始関数と曲線の下の面積。' },
  'partial-derivatives': { branch: 'cal', sym: '∂', en: 'Derivatives of functions with several variables.', ja: '多変数関数の微分。' },
};
const infoOf = (id: string) => SKILL_INFO[id] ?? { branch: 'alg' as Branch, sym: '?', en: '', ja: '' };

const THUMB_PALETTE: Record<Branch, { sky: string[]; far: string; near: string; dark: string }> = {
  alg: { sky: ['#2f8fe0', '#58b8f2', '#8fdcff', '#c8f2ff'], far: '#3d8f86', near: '#3f9b57', dark: '#2a7045' },
  fun: { sky: ['#7a4fc0', '#c060b8', '#ff8fa8', '#ffd08a'], far: '#7a3f98', near: '#5a2f88', dark: '#3d1f66' },
  cal: { sky: ['#0b1040', '#141a5c', '#232a80', '#3a3aa0'], far: '#1f5f8f', near: '#17486e', dark: '#0f3050' },
};

// A 96x40 pixel landscape per skill with its symbol, seeded by position so it stays the same between renders.
function drawThumb(canvas: HTMLCanvasElement, id: string, index: number) {
  const { branch, sym } = infoOf(id);
  const p = THUMB_PALETTE[branch];
  const w = 96;
  const h = 40;
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  p.sky.forEach((color, k) => {
    g.fillStyle = color;
    g.fillRect(0, k * 8, w, 8 + (k === 3 ? h : 0));
  });
  let seed = 11 + index * 97;
  const rnd = () => ((seed = (seed * 16807) % 2147483647), seed / 2147483647);
  g.fillStyle = branch === 'cal' ? '#fff7c2' : '#ffffff';
  for (let k = 0; k < 9; k++) {
    const x = Math.floor(rnd() * w);
    const y = Math.floor(rnd() * 16);
    if (branch === 'cal') g.fillRect(x, y, 1, 1);
    else {
      g.fillRect(x, y + 4, 9, 2);
      g.fillRect(x + 2, y + 2, 5, 2);
    }
  }
  const ridge = (base: number, amp: number, f: number, ph: number, color: string) => {
    g.fillStyle = color;
    for (let x = 0; x < w; x += 2) {
      const y = Math.round(base - amp * (Math.sin((x / 9) * f + ph) * 0.6 + Math.sin((x / 4) * f + ph * 2) * 0.4));
      g.fillRect(x, y, 2, h - y);
    }
  };
  ridge(26, 7, 0.8, index * 1.7, p.far);
  ridge(32, 4, 1.3, index * 2.9, p.near);
  g.fillStyle = p.dark;
  g.fillRect(0, h - 3, w, 3);
  g.font = 'bold 15px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(5,10,40,.75)';
  g.fillText(sym, w / 2 + 1, 17);
  g.fillStyle = '#ffffff';
  g.fillText(sym, w / 2, 16);
}

function Hero({ skills, current, children }: { skills: Skill[]; current?: Skill; children: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current!;
    const observer = new ResizeObserver(() => drawScene(element));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const counts = [
    [copy.hudSkills, skills.length],
    [copy.hudRusty, skills.filter((s) => s.rusty).length],
    [copy.hudTests, skills.filter((s) => s.promotion && !s.promotion.retryAt).length],
  ] as const;
  return (
    <div className="hero">
      <canvas ref={canvas} aria-hidden="true" />
      <div className="wrap hero-grid">
        <div className="hero-copy">
          <p className="kicker">{copy.heroPre}</p>
          <h1>
            {copy.heroTitle[0]}
            <br />
            <em>{copy.heroTitle[1]}</em>
          </h1>
          <p className="tag">{copy.heroTag}</p>
          <div className="cta">{children}</div>
        </div>
        {current && (
          <SkillStatus skill={current} hud>
            <dl>
              {counts.map(([label, n]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{n}</dd>
                </div>
              ))}
            </dl>
          </SkillStatus>
        )}
      </div>
    </div>
  );
}

function SkillCards({ skills, onPick }: { skills: Skill[]; onPick: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | Branch>('all');
  const ordered = skills.length ? layout(skills).ordered : [];
  const shown = ordered.filter((s) => filter === 'all' || infoOf(s.id).branch === filter);
  const names = (ids: string[]) => ids.map((id) => skills.find((s) => s.id === id)?.title[lang]).join(lang === 'ja' ? '、' : ', ');
  return (
    <>
      <div className="filters" role="group" aria-label={copy.skillsKicker}>
        {(Object.keys(copy.filters) as (keyof typeof copy.filters)[]).map((key) => (
          <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{copy.filters[key]}</button>
        ))}
      </div>
      <div className="skills">
        {shown.map((s) => {
          const info = infoOf(s.id);
          return (
            <article key={s.id} className="card skill" data-rusty={s.rusty}>
              <canvas ref={(c) => void (c && drawThumb(c, s.id, ordered.indexOf(s)))} aria-hidden="true" />
              <div className="skill-body">
                <span className="cat">{copy.cat} · {copy.filters[info.branch].toUpperCase()}</span>
                <h3>{s.title[lang]}</h3>
                {info[lang] && <p>{info[lang]}</p>}
                <p className="needs">{s.prerequisites.length ? copy.needs(names(s.prerequisites)) : copy.noNeeds}</p>
                <div className="foot">
                  <span className="chip gold">LV {s.level}</span>
                  {s.rusty ? <span className="chip rusty">{copy.tagRusty}</span> : <span className="chip on">{copy.tagActive}</span>}
                  {s.promotion && <span className="chip gate">{copy.tagGate}</span>}
                  <button className="btn sm alt" onClick={() => onPick(s.id)}>{copy.practice}</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function Rules() {
  const at = (level: number) => `${((level - 1) / 98) * 100}%`;
  const grades = Object.keys(GRADE_XP) as Grade[];
  return (
    <>
      <div className="row">
        <div className="copy">
          <p className="kicker">{copy.r1.k}</p>
          <h2>{copy.r1.h}</h2>
          <p className="sub">{copy.r1.p}</p>
          <ul>{copy.r1.items.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <ul className="card grades">
          {grades.map((g) => (
            <li key={g}>
              <span className={`grade ${g}`}>{g}</span>
              <span>{copy.gradeRows[g]}</span>
              <span className="xp">{GRADE_XP[g].toLocaleString(lang)} XP</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="row flip">
        <div className="copy">
          <p className="kicker">{copy.r2.k}</p>
          <h2>{copy.r2.h}</h2>
          <p className="sub">{copy.r2.p}</p>
          <ul>{copy.r2.items.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div className="rust-grid">
          {([[1, 'LV 1-19'], [20, 'LV 20-39'], [40, 'LV 40-59'], [60, 'LV 60+']] as const).map(([level, range]) => (
            <div key={range} className="card rust-cell">
              <span>{range}</span>
              <strong>{rustDays(level)}<small>{copy.days}</small></strong>
            </div>
          ))}
        </div>
      </div>
      <div className="row">
        <div className="copy">
          <p className="kicker">{copy.r3.k}</p>
          <h2>{copy.r3.h}</h2>
          <p className="sub">{copy.r3.p}</p>
          <ul>{copy.r3.items.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
        <div className="card track-box">
          <div className="track" role="img" aria-label={copy.trackAria}>
            <div className="rail" />
            <div className="zone" style={{ left: at(50), width: `${(20 / 98) * 100}%` }} />
            <span className="lab top" style={{ left: at(60) }}>{copy.trackGoal}</span>
            <span className="lab top right">{copy.trackLegend}</span>
            {[30, 60, 90, 99].map((l) => <i key={l} className={l === 99 ? 'mark end' : 'mark'} style={{ left: at(l) }} />)}
            <span className="lab bot left">1</span>
            {[30, 60, 90].map((l) => <span key={l} className="lab bot" style={{ left: at(l) }}>{l}</span>)}
          </div>
          <ul className="miles">
            {[30, 50, 60, 70, 90, 99].map((l) => (
              <li key={l}><b>LV {l}</b><span>{xpForLevel(l).toLocaleString(lang)} XP</span></li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}

function SkillStatus({ skill, hud, children }: { skill: Skill; hud?: boolean; children?: ReactNode }) {
  const next = skill.level < 99 && !skill.promotion ? xpForLevel(skill.level + 1) : null;
  return (
    <div className={hud ? 'card info hud' : 'card info on'}>
      <p className="kicker">{hud ? copy.hudKicker : copy.skillKicker}</p>
      <div className="hud-top">
        <h3>{skill.title[lang]}</h3>
        <span className="lv">
          <span className="visually-hidden">{copy.level} </span>LV {skill.level}
        </span>
      </div>
      <div className="bar" aria-hidden="true">
        <b style={{ width: `${levelProgress(skill.xp, skill.passedGates) * 100}%` }} />
      </div>
      <p className="bar-cap">
        <span>{skill.xp.toLocaleString(lang)} XP</span>
        {next !== null && <span>{copy.nextAt(next.toLocaleString(lang))}</span>}
      </p>
      {skill.rusty && <p className="hint">{copy.rustyHint}</p>}
      {children}
    </div>
  );
}

const Tex = ({ latex }: { latex: string }) => (
  <div className="math" dangerouslySetInnerHTML={{ __html: katex.renderToString(latex, { displayMode: true, throwOnError: false }) }} />
);

// The Show answer button disappears once used, so focus moves to what replaced it.
const focusOnMount = (element: HTMLElement | null) => element?.focus();

function ProblemView({ problem, done, onSubmit, children }: {
  problem: Problem;
  done?: boolean;
  onSubmit: (answer: string) => Promise<void>;
  children?: ReactNode;
}) {
  const field = useRef<MathfieldElement>(null);
  const sending = useRef(false);

  const submit = async () => {
    const answer = field.current?.value.trim();
    if (!answer || done || sending.current) return;
    if (isUnfinished(answer)) return field.current!.focus();
    sending.current = true;
    await onSubmit(answer);
    sending.current = false;
  };

  useEffect(() => {
    // On touch screens focus opens the on-screen keyboard, which would cover the problem. No scroll: the first problem
    // loads with the page, and picking a skill scrolls to the quest itself.
    if (matchMedia('(pointer: fine)').matches) (field.current as HTMLElement | null)?.focus({ preventScroll: true });
  }, [problem.instanceId]);

  useEffect(() => {
    const element = field.current!;
    const onEnter = (event: InputEvent) => {
      if (event.inputType !== 'insertLineBreak') return;
      event.preventDefault();
      void submit();
    };
    element.addEventListener('beforeinput', onEnter);
    return () => element.removeEventListener('beforeinput', onEnter);
  });

  return (
    <>
      <div className="meta">
        <span className={`grade ${problem.grade}`}>
          <span className="visually-hidden">{copy.grade} </span>
          {problem.grade}
        </span>
        <span className="chip">{copy.gradeName[problem.grade]} · {GRADE_XP[problem.grade].toLocaleString(lang)} XP</span>
      </div>
      <p className="ask">{problem.prompt[lang]}</p>
      {/* The question is the part after the separator, so a long first part must not push it off a phone screen. */}
      {problem.latex.split(', \\quad ').map((part) => <Tex key={part} latex={part} />)}
      <label className="field-label" htmlFor="answer">{copy.answer}</label>
      <math-field id="answer" key={problem.instanceId} ref={field} />
      {!done && <button className="btn blue" onClick={submit}>{copy.check}</button>}
      {children}
    </>
  );
}

function Practice({ skill, skills, testOpen, onChange }: { skill: Skill; skills: Skill[]; testOpen: boolean; onChange: () => void }) {
  const [problem, setProblem] = useState<Problem>();
  const [result, setResult] = useState<Result>();
  const [answer, setAnswer] = useState<string>();
  const [error, setError] = useState<ApiError>();
  // Its own state: the error line is cleared by Show answer and replaced by a failed Next, and neither unanswers it.
  const [answered, setAnswered] = useState(false);
  const loads = useRef(0);

  // The old problem stays until the next one arrives: clearing it would collapse the panel and move a phone's scroll.
  const load = useCallback(async () => {
    const next = await post<Problem>('/api/problems/next', { skillId: skill.id });
    if ('error' in next) {
      setError(next);
      return;
    }
    loads.current++;
    setProblem(next);
    setResult(undefined);
    setAnswer(undefined);
    setError(undefined);
    setAnswered(false);
  }, [skill.id]);

  useEffect(() => void load(), [load]);

  const submit = async (value: string) => {
    setError(undefined);
    const attempt = await post<Result>('/api/attempts', { instanceId: problem!.instanceId, answer: value });
    if ('error' in attempt) {
      setError(attempt);
      setAnswered(attempt.error === 'already_answered');
    } else setResult(attempt);
    onChange();
  };

  const reveal = async () => {
    setError(undefined);
    const shown = loads.current;
    const revealed = await post<{ answer: string }>('/api/problems/reveal', { instanceId: problem!.instanceId });
    if (shown !== loads.current) return;
    if ('error' in revealed) {
      setError(revealed);
      return;
    }
    setAnswer(revealed.answer);
    setProblem({ ...problem!, revealed: true });
  };

  const title = (id: string) => skills.find((s) => s.id === id)?.title[lang];

  return (
    <>
      {problem && (
        <ProblemView problem={problem} done={!!result || answered} onSubmit={submit}>
          {result && (
            <div id="result" role="status" className="result" data-correct={result.correct}>
              <p>
                {result.correct ? copy.correct : copy.wrong}
                {result.awards.map((a) => (
                  <strong key={a.skillId}> +{a.xp.toLocaleString(lang)} XP{result.awards.length > 1 && ` ${title(a.skillId)}`}</strong>
                ))}
                {result.correct && !result.awards.length && problem.revealed && ` ${copy.noXp}`}
              </p>
            </div>
          )}
          {(result || answered) && <button className="btn" autoFocus aria-describedby="result" onClick={load}>{copy.next}</button>}
          {problem.revealed && <p className="hint reveal">{copy.revealed(gradeAfterReveal(problem.grade))}</p>}
          {answer ? (
            <div className="reveal" tabIndex={-1} ref={focusOnMount}>
              <p className="field-label">{copy.answerKey}</p>
              <Tex latex={answer} />
            </div>
          ) : testOpen ? (
            !result?.correct && <p className="hint reveal">{copy.errors.reveal_refused}</p>
          ) : (
            !result?.correct && (
              <div className="reveal">
                {!problem.revealed && <p className="hint">{copy.revealWarning(gradeAfterReveal(problem.grade))}</p>}
                <button className="btn alt" onClick={reveal}>{copy.showAnswer}</button>
              </div>
            )
          )}
        </ProblemView>
      )}
      {error && <p role="alert" className="error">{message(error)}</p>}
      {!problem && error && error.error !== 'no_problems_left' && <button className="btn" onClick={load}>{copy.retry}</button>}
    </>
  );
}

function Promotion({ skill, canStart, onStart }: { skill: Skill; canStart: boolean; onStart: () => void }) {
  const { gate, retryAt } = skill.promotion!;
  const next = effectiveLevel(skill.xp, [...skill.passedGates, gate]);
  return (
    <div className="notice">
      <p>{copy.gateHeld(gate)}{next > gate && ` ${copy.gateJump(next)}`}</p>
      {retryAt ? (
        <p className="hint">{copy.cooldown(formatTime(retryAt))}</p>
      ) : (
        <>
          <p className="hint">{copy.testRules}</p>
          {canStart && <button className="btn" onClick={onStart}>{copy.startTest(gate)}</button>}
        </>
      )}
    </div>
  );
}

function TestRun({ test, skills, onUpdate, onClose }: {
  test: TestState;
  skills: Skill[];
  onUpdate: (test: TestState) => void;
  onClose: () => void;
}) {
  const [last, setLast] = useState<boolean>();
  const [error, setError] = useState<ApiError>();
  const [sending, setSending] = useState(false);
  const skill = skills.find((s) => s.id === test.skillId);
  const heading = skill ? copy.promotionTitle(test.gate!, skill.title[lang]) : copy.placementTitle;

  const submit = async (answer: string) => {
    setError(undefined);
    setSending(true);
    const attempt = await post<Result>('/api/attempts', { instanceId: test.problem!.instanceId, answer });
    setSending(false);
    if (!('error' in attempt)) setLast(attempt.correct);
    // already_answered carries the test too: the answer counted in another tab, or its response was lost.
    if (attempt.test) onUpdate(attempt.test);
    else if ('error' in attempt) setError(attempt);
  };

  if (test.passed !== null) {
    return (
      <div role="status">
        <h3>{heading}</h3>
        <div id="outcome">
          {skill ? (
            <p className="outcome">
              {test.passed
                ? copy.passed(test.correct, test.total, skill.title[lang], effectiveLevel(skill.xp, [...skill.passedGates, test.gate!]))
                : copy.notPassed(test.correct, test.total)}
            </p>
          ) : test.placedSkills.length ? (
            <>
              <p className="outcome">{copy.placed}</p>
              <ul>{test.placedSkills.map((id) => <li key={id}>{skills.find((s) => s.id === id)?.title[lang]}</li>)}</ul>
            </>
          ) : (
            <p className="outcome">{copy.placedNone}</p>
          )}
        </div>
        <button className="btn" autoFocus aria-describedby="outcome" onClick={onClose}>{copy.backToPractice}</button>
      </div>
    );
  }

  const count = skill ? copy.problemCount : copy.placementCount;
  return (
    <>
      <h3>{heading}</h3>
      <p role="status" className="hint">
        {last === undefined ? copy.testNote : last ? copy.correct : copy.wrong}
        {/* Two wrong answers in a row read the same, and a live region only speaks when its text changes. */}
        {last !== undefined && <span className="visually-hidden"> {count(test.answered + 1, test.total)}</span>}
      </p>
      <progress value={test.answered} max={test.total} aria-label={count(test.answered + 1, test.total)} />
      <p className="count">
        <span>{count(test.answered + 1, test.total)}</span>
        {skill && <span>{copy.correctCount(test.correct)}</span>}
      </p>
      <ProblemView problem={test.problem!} onSubmit={submit}>
        <button className="btn alt" disabled={sending} onClick={onClose}>{copy.leave}</button>
      </ProblemView>
      {error && <p role="alert" className="error">{message(error)}</p>}
    </>
  );
}

function SignIn({ onDone, large }: { onDone: () => void; large?: boolean }) {
  const size = large ? 'btn lg' : 'btn sm';
  if (import.meta.env.DEV) {
    const devSignIn = () => fetch('/api/auth/dev', { method: 'POST' }).then(onDone);
    return <button className={size} onClick={devSignIn}>{copy.devSignIn}</button>;
  }
  // The server redirects to the provider and back to / with the session cookie set.
  return (
    <>
      <button className={size} onClick={() => location.assign('/api/auth/google')}>{copy.google}</button>
      <button className={`${size} alt`} onClick={() => location.assign('/api/auth/line')}>{copy.line}</button>
    </>
  );
}

function App() {
  const [board, setBoard] = useState<Board>();
  const [selectedId, setSelectedId] = useState<string>();
  const [test, setTest] = useState<TestState>();
  const [testError, setTestError] = useState<string>();
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch('/api/skills').catch(() => null);
    setFailed(!response?.ok);
    if (response?.ok) setBoard(await response.json());
  }, []);

  useEffect(() => void refresh(), [refresh]);

  const signedIn = board?.signedIn;
  const switchAccount = async (request?: Promise<unknown>) => {
    await request?.catch(() => null);
    setTest(undefined);
    setSelectedId(undefined);
    await refresh();
  };

  // A cooldown ends on the server with no event, so a tab left open asks again when it comes back.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const startTest = async (skillId: string | null) => {
    setTestError(undefined);
    const state = await post<TestState>(skillId ? '/api/tests/promotion' : '/api/tests/placement', skillId ? { skillId } : {});
    if ('error' in state) {
      setTestError(state.error === 'no_problems_left' ? copy.noTestProblems : message(state));
    } else {
      setTest(state);
      if (skillId) setSelectedId(skillId);
    }
    void refresh();
  };

  const skills = board?.skills ?? [];
  const open = board?.openTest;
  // Before any pick the first skill stands in, so the quest and the status window are never empty.
  const current = skills.find((s) => s.id === selectedId) ?? skills[0];
  const testShown = test && (!test.skillId || test.skillId === current?.id);

  const choose = (id: string) => {
    setSelectedId(id);
    setTestError(undefined);
  };
  const chooseAndGo = (id: string) => {
    choose(id);
    document.getElementById('play')?.scrollIntoView({ block: 'start' });
  };

  const quest = !board ? null : !signedIn ? (
    <p className="hint">{copy.signInFirst}</p>
  ) : testShown ? (
    <TestRun
      test={test}
      skills={skills}
      onUpdate={(next) => {
        setTest(next);
        if (next.passed !== null) void refresh();
      }}
      onClose={() => {
        setTest(undefined);
        void refresh();
      }}
    />
  ) : open?.kind === 'placement' ? null : current ? (
    <Practice key={current.id} skill={current} skills={skills} testOpen={!!open} onChange={refresh} />
  ) : (
    <p className="hint">{copy.pick}</p>
  );

  const signIn = (large?: boolean) => <SignIn large={large} onDone={() => switchAccount()} />;
  const goPlay = <a className="btn lg" href="#play">{copy.heroCta}</a>;

  return (
    <>
      <header className="nav">
        <div className="wrap">
          <span className="logo">
            <i className="coin" aria-hidden="true" />
            {copy.title}
          </span>
          <ul>
            {(Object.keys(copy.nav) as (keyof typeof copy.nav)[]).map((id) => (
              <li key={id}><a href={`#${id}`}>{copy.nav[id]}</a></li>
            ))}
          </ul>
          <div className="end">
            <div className="lang" role="group" aria-label="Language">
              <button aria-pressed={lang === 'en'} onClick={() => switchLang('en')}>EN</button>
              <button aria-pressed={lang === 'ja'} onClick={() => switchLang('ja')}>日本語</button>
            </div>
            {board &&
              (signedIn ? (
                <button className="btn sm alt" onClick={() => switchAccount(fetch('/api/auth/sign-out', { method: 'POST' }))}>{copy.signOut}</button>
              ) : (
                signIn()
              ))}
          </div>
        </div>
      </header>
      <main>
        <Hero skills={skills} current={current}>
          {board && (signedIn ? goPlay : signIn(true))}
          <a className="btn lg alt" href="#world">{copy.heroMap}</a>
        </Hero>

        <section id="play">
          <div className="wrap">
            <div className="head">
              <p className="kicker">{testShown ? copy.testKicker : copy.questKicker}</p>
              <h2>{copy.playH}</h2>
              <p className="sub">{copy.playSub}</p>
            </div>
            <div className="play">
              <div className="card quest panel">
                {signedIn && !testShown && open?.kind !== 'placement' && current && (
                  <div className="pickers">
                    <label htmlFor="skill-pick">{copy.skillLabel}</label>
                    <select id="skill-pick" value={current.id} onChange={(event) => choose(event.target.value)}>
                      {skills.map((s) => <option key={s.id} value={s.id}>{s.title[lang]}</option>)}
                    </select>
                  </div>
                )}
                {quest}
              </div>
              <div className="stack">
                {signedIn && open && (
                  <div className="card info">
                    <p>{open.skillId ? copy.openPromotion(open.gate!, skills.find((s) => s.id === open.skillId)!.title[lang]) : copy.openPlacement}</p>
                    <div><button className="btn" onClick={() => startTest(open.skillId)}>{copy.resume}</button></div>
                  </div>
                )}
                {signedIn && !open && board?.placementAvailable && (
                  <div className="card info">
                    <p className="kicker">{copy.placementTitle}</p>
                    <p>{copy.placementOffer}</p>
                    <p className="hint">{copy.placementRules}</p>
                    <div><button className="btn" onClick={() => startTest(null)}>{copy.startPlacement}</button></div>
                  </div>
                )}
                {testError && <p role="alert" className="error">{testError}</p>}
                {current && (
                  <SkillStatus skill={current}>
                    {signedIn && current.promotion && <Promotion skill={current} canStart={!open} onStart={() => startTest(current.id)} />}
                  </SkillStatus>
                )}
              </div>
            </div>
          </div>
        </section>

        <section id="skills" className="alt">
          <div className="wrap">
            <div className="head">
              <p className="kicker">{copy.skillsKicker}</p>
              <h2>{copy.skillsH}</h2>
              <p className="sub">{copy.skillsSub}</p>
            </div>
            <SkillCards skills={skills} onPick={chooseAndGo} />
          </div>
        </section>

        <section id="world">
          <div className="wrap">
            <div className="head">
              <p className="kicker">{copy.mapKicker}</p>
              <h2>{copy.worldH}</h2>
            </div>
            <div className="stats">
              {[['99', 'var(--gold)'], ['5', 'var(--green)'], ['0', 'var(--purple)'], ['1.5x', '#f472b6']].map(([value, color], i) => (
                <div key={value}>
                  <strong style={{ color }}>{value}</strong>
                  <span>{copy.stats[i]}</span>
                </div>
              ))}
            </div>
            <div className="card map">{board && <SkillTree skills={skills} selected={current?.id} onSelect={chooseAndGo} />}</div>
            <ul className="legend">
              <li><i data-state="active" />{copy.legendActive}</li>
              <li><i data-state="rusty" />{copy.legendRusty}</li>
              <li><i data-state="gate" />{copy.legendGate}</li>
            </ul>
            {failed && (
              <>
                <p role="alert" className="error">{copy.failed}</p>
                <button className="btn" onClick={refresh}>{copy.retry}</button>
              </>
            )}
            {current && (
              <div className="card detail" aria-live="polite">
                <h3>{current.title[lang]}</h3>
                <span className="lv">LV {current.level}</span>
                <p>
                  {current.rusty ? copy.rustyHint : current.promotion ? copy.gateReached(current.promotion.gate) : current.prerequisites.length ? copy.share : copy.noNeeds}
                </p>
              </div>
            )}
          </div>
        </section>

        <section id="rules" className="alt">
          <div className="wrap">
            <Rules />
          </div>
        </section>

        <section className="final">
          <div className="wrap">
            <div className="copy">
              <h2>{copy.ctaH}</h2>
              <p className="sub">{copy.ctaP}</p>
            </div>
            <div className="cta">{board && (signedIn ? goPlay : signIn(true))}</div>
          </div>
        </section>
      </main>
      <footer>
        <div className="wrap">
          <span className="logo">
            <i className="coin" aria-hidden="true" />
            {copy.title}
          </span>
          <span>{copy.foot}</span>
        </div>
      </footer>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
