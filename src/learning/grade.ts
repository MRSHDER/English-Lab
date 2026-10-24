/**
 * 判题与错因自动判断。
 *
 * 原则（与错题分类的设计一致）：
 * - 只在“有把握”时给出错因：命中题目里登记的常见错误，或和正确答案只差一两个字母（拼写）。
 * - 没把握就记为“待分类”，让学生自己选，绝不默认算成语法错误。
 */
import type { ErrorTag } from '../storage/schema';
import type { Item, Mistake } from '../content/schema';

/** 统一比较格式：去首尾空格、小写、弯引号变直引号、合并多余空格、去掉句末标点 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[‘’ʼ]/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?。！？]+$/u, '')
    .trim();
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] as number;
      const cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      prev[j] = Math.min((prev[j] as number) + 1, (prev[j - 1] as number) + 1, diag + cost);
      diag = tmp;
    }
  }
  return prev[b.length] as number;
}

export interface GradeResult {
  correct: boolean;
  /** 答错时的自动错因标签（可能是“待分类”）；答对时为空 */
  errors: ErrorTag[];
  /** 命中的常见错误提醒 */
  note?: string;
}

/** 够长的单词才做“拼写接近”判断，避免把短词的语法错误（like / likes）误判成拼写 */
const SPELLING_MIN_LENGTH = 6;
const SPELLING_MAX_DISTANCE = 2;

export function gradeAnswer(item: Item, userAnswer: string): GradeResult {
  const given = normalizeAnswer(userAnswer);
  const answers = item.answers.map(normalizeAnswer);
  if (given !== '' && answers.includes(given)) return { correct: true, errors: [] };

  const tag = (category: ErrorTag['category'], subtype?: string): ErrorTag => {
    const t: ErrorTag = { category, topicId: item.topicId, source: 'auto' };
    if (subtype) t.subtype = subtype;
    return t;
  };

  if (given === '') return { correct: false, errors: [tag('unclassified', 'empty')] };

  const hit: Mistake | undefined = item.mistakes?.find((m) => normalizeAnswer(m.text) === given);
  if (hit) {
    const r: GradeResult = { correct: false, errors: [tag(hit.category, hit.subtype)] };
    if (hit.note) r.note = hit.note;
    return r;
  }

  if (item.type === 'fill') {
    const near = answers.some(
      (a) => a.length >= SPELLING_MIN_LENGTH && editDistance(given, a) <= SPELLING_MAX_DISTANCE,
    );
    if (near) return { correct: false, errors: [tag('spelling', 'near-miss')] };
  }
  return { correct: false, errors: [tag('unclassified')] };
}
