/**
 * FSRS 复习调度（使用 ts-fsrs）。
 *
 * V1 的取舍：关闭“同日短期学习步骤”和随机抖动。
 * - 关闭短期步骤：做错的题隔天再出现，而不是 1 分钟后，更适合每天固定时间学习。
 * - 关闭抖动：同样的输入一定得到同样的结果，方便测试和以后重算。
 * 这些设置会连同完整参数一起写进每条复习日志。
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card as FsrsCard } from 'ts-fsrs';
import type { AlgorithmInfo, Card, FsrsState, ReviewLog } from '../storage/schema';
import { cardIdFor, newRecordId } from '../storage/ids';

/** 与 package.json 里安装的 ts-fsrs 版本保持一致（单元测试会检查，不一致会报错） */
export const TS_FSRS_VERSION = '5.4.2';
export const PARAMS_VERSION = 'default-fsrs-v6-days';
export const REQUEST_RETENTION = 0.9;

const params = generatorParameters({
  request_retention: REQUEST_RETENTION,
  enable_fuzz: false,
  enable_short_term: false,
});
const scheduler = fsrs(params);

export function algorithmInfo(): AlgorithmInfo {
  return {
    name: 'FSRS',
    libraryVersion: `ts-fsrs@${TS_FSRS_VERSION}`,
    paramsVersion: PARAMS_VERSION,
    parameters: [...params.w],
    requestRetention: params.request_retention,
    maximumInterval: params.maximum_interval,
    enableFuzz: params.enable_fuzz,
    enableShortTerm: params.enable_short_term,
  };
}

export type RatingValue = 1 | 2 | 3 | 4;

/** 作答结果 → FSRS 评分：答错=重来(1)，提示后答对=困难(2)，独立答对=良好(3) */
export function ratingFor(outcome: 'independent' | 'hinted' | 'wrong'): RatingValue {
  return outcome === 'wrong' ? 1 : outcome === 'hinted' ? 2 : 3;
}

function toFsrsCard(s: FsrsState): FsrsCard {
  const c: FsrsCard = {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    reps: s.reps,
    lapses: s.lapses,
    learning_steps: s.learningSteps ?? 0,
    state: s.state as State,
  };
  if (s.lastReview) c.last_review = new Date(s.lastReview);
  return c;
}

function fromFsrsCard(c: FsrsCard): FsrsState {
  return {
    state: c.state,
    due: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    reps: c.reps,
    lapses: c.lapses,
    learningSteps: c.learning_steps,
    lastReview: c.last_review ? c.last_review.toISOString() : null,
  };
}

export interface ScheduleResult {
  card: Card;
  log: ReviewLog;
}

/** 对一张卡（不存在则新建）应用一次评分，返回新的卡和对应的不可变日志 */
export function applyRating(args: {
  itemId: string;
  kind: Card['kind'];
  previous: Card | undefined;
  rating: RatingValue;
  outcome: 'independent' | 'hinted' | 'wrong';
  durationMs: number;
  attemptId?: string;
  now: Date;
}): ScheduleResult {
  const nowIso = args.now.toISOString();
  const before = args.previous ? args.previous.fsrs : null;
  const startCard = before ? toFsrsCard(before) : createEmptyCard(args.now);
  const result = scheduler.next(startCard, args.now, args.rating as unknown as Rating & (1 | 2 | 3 | 4));
  const after = fromFsrsCard(result.card);
  const card: Card = {
    id: cardIdFor(args.itemId),
    itemId: args.itemId,
    kind: args.kind,
    suspended: args.previous?.suspended ?? false,
    fsrs: after,
    createdAt: args.previous?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
  const log: ReviewLog = {
    id: newRecordId('log', args.now.getTime()),
    cardId: card.id,
    itemId: args.itemId,
    reviewedAt: nowIso,
    rating: args.rating,
    outcome: args.outcome,
    durationMs: args.durationMs,
    algorithm: algorithmInfo(),
    before,
    after,
    createdAt: nowIso,
  };
  if (args.attemptId) log.attemptId = args.attemptId;
  return { card, log };
}
