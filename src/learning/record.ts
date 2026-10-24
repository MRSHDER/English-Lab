/**
 * 记录一次作答：判题 → 写入作答记录 → 更新复习卡 → 追加不可变复习日志。
 *
 * 写入顺序：作答 → 日志 → 卡片。三步不是同一个事务；如果中途失败，
 * 作答和日志（事实记录）已经保存，卡片可以根据日志里的 after 状态恢复。
 *
 * 练习时的调度规则：同一道题当天反复练习不应该反复推迟复习。
 * 所以练习模式下，只有“这题还没有卡片”“已到期”“答错了”三种情况才会更新调度；
 * 其他情况只记录作答，不动复习日期，也不产生复习日志。
 */
import type { Item } from '../content/schema';
import { gradeAnswer } from './grade';
import { applyRating, ratingFor } from './fsrs';
import { cardIdFor, newRecordId } from '../storage/ids';
import type { Attempt, Card, ErrorTag, ReviewLog } from '../storage/schema';
import type { DataStore } from '../storage/types';

export interface RecordOptions {
  mode: 'practice' | 'review';
  hintUsed: boolean;
  durationMs: number;
  now?: Date;
}

export interface RecordResult {
  attempt: Attempt;
  card: Card | undefined;
  log: ReviewLog | undefined;
  /** 答对时为空；答错时给出命中的常见错误提醒 */
  note: string | undefined;
  /** 是否更新了复习排期 */
  scheduled: boolean;
}

export function promptSnapshotOf(item: Item): string {
  return item.stem + (item.cue ? ` (${item.cue})` : '');
}

export async function recordAnswer(
  store: DataStore,
  item: Item,
  userAnswer: string,
  opts: RecordOptions,
): Promise<RecordResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const grade = gradeAnswer(item, userAnswer);
  const outcome = grade.correct ? (opts.hintUsed ? 'hinted' : 'independent') : 'wrong';

  const attempt: Attempt = {
    id: newRecordId('att', now.getTime()),
    itemId: item.id,
    itemRevision: item.revision,
    topicId: item.topicId,
    mode: opts.mode,
    promptSnapshot: promptSnapshotOf(item),
    userAnswer,
    referenceAnswerSnapshot: item.answers[0] as string,
    outcome,
    hintUsed: opts.hintUsed,
    errors: grade.correct ? [] : grade.errors,
    durationMs: Math.max(0, Math.round(opts.durationMs)),
    answeredAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await store.attempts.add(attempt);

  const previous = await store.cards.get(cardIdFor(item.id));
  const isDue = previous ? previous.fsrs.due <= nowIso : true;
  const shouldSchedule = opts.mode === 'review' || !previous || isDue || outcome === 'wrong';
  if (!shouldSchedule) {
    return { attempt, card: previous, log: undefined, note: grade.note, scheduled: false };
  }

  const { card, log } = applyRating({
    itemId: item.id,
    kind: 'question',
    previous,
    rating: ratingFor(outcome),
    outcome,
    durationMs: attempt.durationMs,
    attemptId: attempt.id,
    now,
  });
  await store.reviewLogs.append(log);
  await store.cards.put(card);
  return { attempt, card, log, note: grade.note, scheduled: true };
}

/** 学生自己指出错因（覆盖程序的自动判断）。choice 为 slip 表示“我会，只是手滑打错了” */
export type SelfChoice = ErrorTag['category'] | 'slip';

export async function setSelfClassification(
  store: DataStore,
  attempt: Attempt,
  choice: SelfChoice,
  now: Date = new Date(),
): Promise<Attempt> {
  const base: ErrorTag = { category: choice === 'slip' ? 'spelling' : choice, source: 'self' };
  if (attempt.topicId) base.topicId = attempt.topicId;
  if (choice === 'slip') base.slip = true;
  const auto = attempt.errors.find((e) => e.source === 'auto' && e.subtype);
  if (auto?.subtype && choice !== 'unclassified' && choice !== 'slip' && auto.category === choice) base.subtype = auto.subtype;
  return store.attempts.updateErrors(attempt.id, [base], now.toISOString());
}
