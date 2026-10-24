import { cardIdFor } from '../../src/storage/ids';
import type { Attempt, Card, FsrsState, ReviewLog, Snapshot } from '../../src/storage/schema';

const T0 = Date.parse('2026-10-22T04:00:00.000Z');

/** 测试用时间：T0 之后第 min 分钟 */
export function iso(min = 0): string {
  return new Date(T0 + min * 60_000).toISOString();
}

const pad = (n: number) => String(n).padStart(20, '0');

export function attempt(n: number, over: Partial<Attempt> = {}): Attempt {
  const t = iso(n);
  return {
    id: `att_${pad(n)}`,
    itemId: 'q.present-simple.0001',
    itemRevision: 1,
    topicId: 'g.present-simple',
    mode: 'practice',
    promptSnapshot: '她每天学英语。',
    userAnswer: 'She study English every day.',
    referenceAnswerSnapshot: 'She studies English every day.',
    outcome: 'wrong',
    hintUsed: false,
    errors: [{ category: 'grammar', subtype: 'third-person-s', topicId: 'g.present-simple', source: 'auto' }],
    durationMs: 8000,
    answeredAt: t,
    createdAt: t,
    updatedAt: t,
    ...over,
  };
}

export function fsrs(dueMin = 0, over: Partial<FsrsState> = {}): FsrsState {
  return {
    state: 2,
    due: iso(dueMin),
    stability: 3.2,
    difficulty: 5.1,
    elapsedDays: 1,
    scheduledDays: 3,
    reps: 2,
    lapses: 0,
    lastReview: iso(dueMin - 60),
    ...over,
  };
}

export function card(itemId = 'q.present-simple.0001', dueMin = 0, over: Partial<Card> = {}): Card {
  return {
    id: cardIdFor(itemId),
    itemId,
    kind: 'question',
    suspended: false,
    fsrs: fsrs(dueMin),
    createdAt: iso(0),
    updatedAt: iso(0),
    ...over,
  };
}

export function log(n: number, itemId = 'q.present-simple.0001', over: Partial<ReviewLog> = {}): ReviewLog {
  return {
    id: `log_${pad(n)}`,
    cardId: cardIdFor(itemId),
    itemId,
    reviewedAt: iso(n),
    rating: 3,
    outcome: 'independent',
    durationMs: 5000,
    algorithm: {
      name: 'FSRS',
      libraryVersion: 'ts-fsrs@test',
      paramsVersion: 'default-test',
      parameters: [0.2172, 1.1771, 3.2602, 16.1507, 7.0114, 0.57, 2.0966, 0.0069, 1.5261, 0.112, 1.0178],
      requestRetention: 0.9,
      maximumInterval: 36500,
      enableFuzz: false,
    },
    before: fsrs(n - 60),
    after: fsrs(n + 60),
    createdAt: iso(n),
    ...over,
  };
}

/** 一份内容完整、互相关联的示例数据 */
export function sampleSnapshot(): Snapshot {
  return {
    attempts: [
      attempt(1),
      attempt(2, {
        itemId: 'q.present-simple.0002',
        promptSnapshot: '他不喜欢画猫。',
        userAnswer: "He doesn't like drawing cats.",
        referenceAnswerSnapshot: "He doesn't like drawing cats.",
        outcome: 'independent',
        errors: [],
      }),
      attempt(3, {
        itemId: 'q.present-simple.0003',
        outcome: 'hinted',
        hintUsed: true,
        errors: [{ category: 'spelling', subtype: 'typo', source: 'self', slip: true }],
      }),
    ],
    cards: [card('q.present-simple.0001', 10), card('q.present-simple.0002', 20), card('q.present-simple.0003', 30)],
    reviewLogs: [log(1, 'q.present-simple.0001'), log(2, 'q.present-simple.0002')],
    settings: [
      { key: 'app', value: { dailyNewLimit: 5, dailyReviewLimit: 50, fontScale: 1, reminder: 'off' }, updatedAt: iso(0) },
    ],
  };
}
