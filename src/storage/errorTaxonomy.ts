/**
 * 错题分类
 *
 * 目的：避免统计失真。几个原则：
 * - 一次答错可以同时有多个标签（例如语法 + 拼写），各算各的。
 * - “手滑”（slip）：知道怎么写但这次打错了。它会被记录，但不计入知识点掌握度。
 * - “待分类”（unclassified）：程序还没法判断错在哪。它单独统计，
 *   绝不会被默认算成语法错误。
 */

export const ERROR_CATEGORIES = [
  'grammar', // 语法：时态、主谓一致、冠词、词序……
  'spelling', // 拼写：单词拼错
  'vocabulary', // 词汇：不认识、用错词、搭配错
  'unnatural', // 表达不自然：语法没错，但母语者不会这样说
  'meaning', // 理解偏差：没读懂题意或原文
  'mechanics', // 标点、大小写、缩写格式
  'unclassified', // 待分类
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const ERROR_CATEGORY_LABELS: Record<ErrorCategory, string> = {
  grammar: '语法',
  spelling: '拼写',
  vocabulary: '词汇',
  unnatural: '表达不自然',
  meaning: '理解偏差',
  mechanics: '标点大小写',
  unclassified: '待分类',
};

export const ERROR_SOURCES = ['auto', 'self', 'ai', 'manual'] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];

export interface ErrorTagLike {
  category: ErrorCategory;
  subtype?: string | undefined;
  topicId?: string | undefined;
  slip?: boolean | undefined;
  source: ErrorSource;
}

export interface AttemptLike {
  outcome: 'independent' | 'hinted' | 'wrong';
  errors: ErrorTagLike[];
}

export interface ErrorSummary {
  /** 每个类别的错误标签数（不含手滑、不含待分类） */
  byCategory: Record<Exclude<ErrorCategory, 'unclassified'>, number>;
  /** 手滑次数：记录在案，但不计入掌握度 */
  slips: number;
  /** 答错但还没有任何标签、或标签为“待分类”的作答数 */
  unclassifiedAttempts: number;
  /** 答错的作答总数 */
  wrongAttempts: number;
}

function emptyByCategory(): ErrorSummary['byCategory'] {
  return { grammar: 0, spelling: 0, vocabulary: 0, unnatural: 0, meaning: 0, mechanics: 0 };
}

export function summarizeErrors(attempts: AttemptLike[]): ErrorSummary {
  const s: ErrorSummary = {
    byCategory: emptyByCategory(),
    slips: 0,
    unclassifiedAttempts: 0,
    wrongAttempts: 0,
  };
  for (const a of attempts) {
    if (a.outcome === 'wrong') s.wrongAttempts += 1;
    let hasRealTag = false;
    for (const tag of a.errors) {
      if (tag.category === 'unclassified') continue;
      if (tag.slip) {
        s.slips += 1;
        continue;
      }
      s.byCategory[tag.category] += 1;
      hasRealTag = true;
    }
    if (a.outcome === 'wrong' && !hasRealTag && !a.errors.some((t) => t.slip)) {
      s.unclassifiedAttempts += 1;
    }
  }
  return s;
}

/** 这个标签是否应计入“知识点掌握度”：手滑和待分类都不计入 */
export function countsTowardMastery(tag: ErrorTagLike): boolean {
  return !tag.slip && tag.category !== 'unclassified';
}
