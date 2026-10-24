import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildLibrary, library, packSchema, type ContentPack } from '../../src/content';
import { editDistance, gradeAnswer, normalizeAnswer } from '../../src/learning/grade';
import { algorithmInfo, applyRating, ratingFor, TS_FSRS_VERSION } from '../../src/learning/fsrs';
import { recordAnswer, setSelfClassification } from '../../src/learning/record';
import { dueToday, endOfLocalDayIso, loadErrorBook } from '../../src/learning/queries';
import { MemoryBackend } from '../../src/storage/memoryBackend';
import { createStore } from '../../src/storage/store';
import { summarizeErrors } from '../../src/storage/errorTaxonomy';
import { cardIdFor } from '../../src/storage/ids';

const newStore = () => createStore(new MemoryBackend(), 'memory', false);
const item = (id: string) => {
  const it = library.item(id);
  if (!it) throw new Error(`题库里没有 ${id}`);
  return it;
};
const day = (d: number, h = 12) => new Date(2026, 9, d, h, 0, 0, 0); // 本地时间

describe('内容包', () => {
  it('内置题库通过校验：5 个知识点，每个至少 7 题', () => {
    expect(library.topics).toHaveLength(5);
    for (const t of library.topics) expect(library.itemsOfTopic(t.id).length).toBeGreaterThanOrEqual(7);
  });

  it('每道题的标准答案都能判对，每个登记的常见错误都不会被判对，且错因与登记一致', () => {
    for (const it of library.items) {
      for (const a of it.answers) expect(gradeAnswer(it, a).correct, `${it.id} 答案 ${a}`).toBe(true);
      for (const m of it.mistakes ?? []) {
        const r = gradeAnswer(it, m.text);
        expect(r.correct, `${it.id} 错误 ${m.text}`).toBe(false);
        expect(r.errors[0]?.category).toBe(m.category);
        expect(r.errors[0]?.subtype).toBe(m.subtype);
      }
    }
  });

  it('题目 ID 都符合稳定 ID 规则并以所属知识点开头', () => {
    for (const it of library.items) expect(it.id.startsWith(`q.${it.topicId.slice(2)}.`)).toBe(true);
  });

  it('今天出错的三个点（studies / go home / every day）都在题库里', () => {
    expect(item('q.present-simple.0005').answers).toContain('studies');
    expect(item('q.present-simple.0008').answers).toContain('home');
    expect(item('q.present-simple.0007').answers).toContain('every day');
  });

  const base = (): ContentPack => JSON.parse(JSON.stringify(library.packs[0]));
  it('拒绝格式错误的内容包', () => {
    const dupId = base();
    dupId.items[1]!.id = dupId.items[0]!.id;
    expect(packSchema.safeParse(dupId).success).toBe(false);

    const noBlank = base();
    noBlank.items[0]!.stem = 'I like drawing.';
    expect(packSchema.safeParse(noBlank).success).toBe(false);

    const badChoice = base();
    const c = badChoice.items.find((i) => i.type === 'choice')!;
    c.answers = ['不在选项里'];
    expect(packSchema.safeParse(badChoice).success).toBe(false);

    const badTopic = base();
    badTopic.items[0]!.topicId = 'g.nope';
    expect(packSchema.safeParse(badTopic).success).toBe(false);

    const wrongPrefix = base();
    wrongPrefix.items[0]!.id = 'q.other.0001';
    expect(packSchema.safeParse(wrongPrefix).success).toBe(false);

    const mistakeIsAnswer = base();
    mistakeIsAnswer.items[0]!.mistakes = [{ text: 'LIKE', category: 'grammar' }];
    expect(packSchema.safeParse(mistakeIsAnswer).success).toBe(false);
  });

  it('不同内容包里出现相同 ID 会报错', () => {
    expect(() => buildLibrary([library.packs[0], library.packs[0]])).toThrow(/重复/);
  });
});

describe('判题与错因', () => {
  it('忽略大小写、句末标点、多余空格、弯引号', () => {
    expect(normalizeAnswer('  Doesn’t   Like. ')).toBe("doesn't like");
    expect(gradeAnswer(item('q.present-simple.0006'), 'Doesn’t like.').correct).toBe(true);
    expect(gradeAnswer(item('q.present-simple.0006'), 'does not like').correct).toBe(true);
  });

  it('编辑距离', () => {
    expect(editDistance('studies', 'dtudis')).toBe(2);
    expect(editDistance('abc', 'abc')).toBe(0);
    expect(editDistance('', 'abc')).toBe(3);
  });

  it('dtudis（你今天的写法）被判为拼写，不是语法', () => {
    const r = gradeAnswer(item('q.present-simple.0005'), 'dtudis');
    expect(r.correct).toBe(false);
    expect(r.errors).toEqual([{ category: 'spelling', subtype: 'near-miss', topicId: 'g.present-simple', source: 'auto' }]);
  });

  it('like（少了 s）是语法错误，不会因为只差一个字母被当成拼写', () => {
    const r = gradeAnswer(item('q.present-simple.0002'), 'like');
    expect(r.errors[0]).toMatchObject({ category: 'grammar', subtype: 'third-person-s' });
    expect(r.note).toContain('s');
  });

  it('短单词只差一个字母不算拼写（可能是语法），没登记的错误保持待分类', () => {
    const r = gradeAnswer(item('q.present-simple.0001'), 'likes'); // 标准答案 like，没有登记 likes 这个错误
    expect(r.errors[0]?.category).toBe('unclassified');
  });

  it('studys 命中“y 变 ies”这个具体语法点', () => {
    expect(gradeAnswer(item('q.present-simple.0005'), 'studys').errors[0]).toMatchObject({ category: 'grammar', subtype: 'y-to-ies' });
  });

  it('不认识的错误一律“待分类”，绝不默认算语法；空答案也一样', () => {
    for (const wrong of ['banana', '???', '']) {
      const r = gradeAnswer(item('q.present-simple.0002'), wrong);
      expect(r.correct).toBe(false);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]?.category).toBe('unclassified');
      expect(r.errors[0]?.source).toBe('auto');
    }
  });

  it('选择题没有“拼写接近”，选错只会是登记的错误或待分类', () => {
    const it = item('q.present-simple.0007');
    expect(gradeAnswer(it, 'everyday').errors[0]?.category).toBe('vocabulary');
    expect(gradeAnswer(it, 'every  day').correct).toBe(true);
  });
});

describe('FSRS 调度', () => {
  it('锁定的 ts-fsrs 版本与实际安装的一致', () => {
    const pkg = JSON.parse(readFileSync('node_modules/ts-fsrs/package.json', 'utf8')) as { version: string };
    expect(TS_FSRS_VERSION).toBe(pkg.version);
  });

  it('评分映射：答错=1，提示后答对=2，独立答对=3', () => {
    expect([ratingFor('wrong'), ratingFor('hinted'), ratingFor('independent')]).toEqual([1, 2, 3]);
  });

  it('日志包含完整算法信息和复习前后状态', () => {
    const now = day(24);
    const { card, log } = applyRating({ itemId: 'q.present-simple.0001', kind: 'question', previous: undefined, rating: 1, outcome: 'wrong', durationMs: 1000, now });
    expect(log.before).toBeNull();
    expect(log.after).toEqual(card.fsrs);
    expect(log.algorithm).toEqual(algorithmInfo());
    expect(log.algorithm.name).toBe('FSRS');
    expect(log.algorithm.libraryVersion).toBe(`ts-fsrs@${TS_FSRS_VERSION}`);
    expect(log.algorithm.parameters.length).toBeGreaterThanOrEqual(17);
    expect(log.algorithm.requestRetention).toBe(0.9);
    expect(log.algorithm.enableFuzz).toBe(false);
    expect(log.algorithm.enableShortTerm).toBe(false);
    expect(log.cardId).toBe(cardIdFor('q.present-simple.0001'));
  });

  it('答错后第二天到期；之后答对，间隔变长；结果可重复', () => {
    const t0 = day(24);
    const first = applyRating({ itemId: 'q.present-simple.0001', kind: 'question', previous: undefined, rating: 1, outcome: 'wrong', durationMs: 0, now: t0 });
    expect(new Date(first.card.fsrs.due).getTime() - t0.getTime()).toBe(86_400_000);
    const t1 = new Date(first.card.fsrs.due);
    const second = applyRating({ itemId: 'q.present-simple.0001', kind: 'question', previous: first.card, rating: 3, outcome: 'independent', durationMs: 0, now: t1 });
    expect(second.log.before).toEqual(first.card.fsrs);
    expect(second.card.fsrs.scheduledDays).toBeGreaterThan(first.card.fsrs.scheduledDays);
    expect(second.card.fsrs.reps).toBe(2);
    const again = applyRating({ itemId: 'q.present-simple.0001', kind: 'question', previous: first.card, rating: 3, outcome: 'independent', durationMs: 0, now: t1 });
    expect(again.card.fsrs).toEqual(second.card.fsrs);
  });
});

describe('记录作答', () => {
  const Q = 'q.present-simple.0005'; // studies

  it('答错：写入作答（含快照和自动错因）、建卡、追加日志，第二天到期', async () => {
    const store = newStore();
    const now = day(24);
    const r = await recordAnswer(store, item(Q), 'dtudis', { mode: 'practice', hintUsed: false, durationMs: 4200, now });
    expect(r.attempt.outcome).toBe('wrong');
    expect(r.attempt.userAnswer).toBe('dtudis');
    expect(r.attempt.referenceAnswerSnapshot).toBe('studies');
    expect(r.attempt.promptSnapshot).toBe('She ___ English at night. (study)');
    expect(r.attempt.itemRevision).toBe(1);
    expect(r.attempt.errors[0]?.category).toBe('spelling');
    expect(r.scheduled).toBe(true);
    expect(await store.attempts.listAll()).toHaveLength(1);
    const logs = await store.reviewLogs.listAll();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.attemptId).toBe(r.attempt.id);
    expect(logs[0]?.rating).toBe(1);
    expect((await store.cards.getByItem(Q))?.fsrs.due).toBe(new Date(now.getTime() + 86_400_000).toISOString());
  });

  it('独立答对没有错误标签；提示后答对记为 hinted、评分 2', async () => {
    const store = newStore();
    const ok = await recordAnswer(store, item(Q), 'Studies.', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24) });
    expect(ok.attempt.outcome).toBe('independent');
    expect(ok.attempt.errors).toEqual([]);
    const store2 = newStore();
    const hinted = await recordAnswer(store2, item(Q), 'studies', { mode: 'practice', hintUsed: true, durationMs: 1, now: day(24) });
    expect(hinted.attempt.outcome).toBe('hinted');
    expect(hinted.log?.rating).toBe(2);
  });

  it('同一天重复练习答对：只记作答，不推迟复习、不产生日志', async () => {
    const store = newStore();
    await recordAnswer(store, item(Q), 'studies', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24, 12) });
    const before = await store.cards.getByItem(Q);
    const r = await recordAnswer(store, item(Q), 'studies', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24, 13) });
    expect(r.scheduled).toBe(false);
    expect(await store.attempts.listAll()).toHaveLength(2);
    expect(await store.reviewLogs.listAll()).toHaveLength(1);
    expect(await store.cards.getByItem(Q)).toEqual(before);
  });

  it('同一天又答错：会重新排期并追加日志，原来的日志保持不变', async () => {
    const store = newStore();
    await recordAnswer(store, item(Q), 'studies', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24, 12) });
    const firstLog = (await store.reviewLogs.listAll())[0];
    const r = await recordAnswer(store, item(Q), 'study', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24, 13) });
    expect(r.scheduled).toBe(true);
    const logs = await store.reviewLogs.listAll();
    expect(logs).toHaveLength(2);
    expect(logs.find((l) => l.id === firstLog?.id)).toEqual(firstLog);
    expect((await store.cards.getByItem(Q))?.fsrs.lapses).toBe(1);
  });

  it('复习模式总是更新排期，已到期的练习也会更新', async () => {
    const store = newStore();
    await recordAnswer(store, item(Q), 'study', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24) });
    const r = await recordAnswer(store, item(Q), 'studies', { mode: 'review', hintUsed: false, durationMs: 1, now: day(25) });
    expect(r.scheduled).toBe(true);
    expect(r.attempt.mode).toBe('review');
    expect((await store.cards.getByItem(Q))?.fsrs.reps).toBe(2);
  });

  it('学生自己指出“手滑”：记录在案，但不计入各类错误', async () => {
    const store = newStore();
    const r = await recordAnswer(store, item(Q), 'studeis', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24) });
    const updated = await setSelfClassification(store, r.attempt, 'slip', day(24, 13));
    expect(updated.errors).toEqual([{ category: 'spelling', topicId: 'g.present-simple', slip: true, source: 'self' }]);
    const s = summarizeErrors(await store.attempts.listAll());
    expect(s.slips).toBe(1);
    expect(s.byCategory.spelling).toBe(0);
    expect(s.unclassifiedAttempts).toBe(0);
    // 题面、答案等其他字段不变
    expect(updated.userAnswer).toBe('studeis');
    expect(updated.promptSnapshot).toBe(r.attempt.promptSnapshot);
  });

  it('选了“语法”会覆盖自动判断，并保留同类别的细分原因', async () => {
    const store = newStore();
    const r = await recordAnswer(store, item(Q), 'studys', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24) });
    const u = await setSelfClassification(store, r.attempt, 'grammar', day(24));
    expect(u.errors).toEqual([{ category: 'grammar', subtype: 'y-to-ies', topicId: 'g.present-simple', source: 'self' }]);
    const u2 = await setSelfClassification(store, r.attempt, 'vocabulary', day(24));
    expect(u2.errors[0]).toMatchObject({ category: 'vocabulary', source: 'self' });
    expect(u2.errors[0]?.subtype).toBeUndefined();
  });
});

describe('今日复习与错题本', () => {
  it('今天到期的卡进入今日复习，明天才到期的不进；已下架的题不出现', async () => {
    const store = newStore();
    await recordAnswer(store, item('q.present-simple.0001'), 'x', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24, 9) });
    await recordAnswer(store, item('q.present-simple.0002'), 'likes', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24, 22) });
    // 答错的卡：次日 9 点到期；答对的卡：次日 22 点也到期（良好评分首次间隔更长，见下）
    expect((await dueToday(store, library, day(24, 23))).total).toBe(0);
    const tomorrow = await dueToday(store, library, day(25, 10));
    expect(tomorrow.entries.map((e) => e.item.id)).toContain('q.present-simple.0001');
    expect(tomorrow.entries[0]!.card.fsrs.due <= endOfLocalDayIso(day(25, 10))).toBe(true);

    const hidden = buildLibrary([
      { ...JSON.parse(JSON.stringify(library.packs[0])), items: library.packs[0]!.items.map((i) => (i.id === 'q.present-simple.0001' ? { ...i, deprecated: true } : i)) },
    ]);
    const after = await dueToday(store, hidden, day(26, 10));
    expect(after.entries.map((e) => e.item.id)).not.toContain('q.present-simple.0001');
  });

  it('错题本：按题目归并，统计次数，答对后标为已改正；类别分开统计', async () => {
    const store = newStore();
    const a = item('q.present-simple.0005');
    const b = item('q.present-simple.0002');
    await recordAnswer(store, a, 'banana', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24, 10) }); // 待分类
    await recordAnswer(store, a, 'dtudis', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24, 11) }); // 拼写
    await recordAnswer(store, b, 'like', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24, 12) }); // 语法
    await recordAnswer(store, b, 'likes', { mode: 'practice', hintUsed: false, durationMs: 1, now: day(24, 13) }); // 改正
    const book = await loadErrorBook(store);
    expect(book.entries).toHaveLength(2);
    const ea = book.entries.find((e) => e.itemId === a.id)!;
    const eb = book.entries.find((e) => e.itemId === b.id)!;
    expect(ea.wrongCount).toBe(2);
    expect(ea.recovered).toBe(false);
    expect(eb.wrongCount).toBe(1);
    expect(eb.recovered).toBe(true);
    expect(book.summary.byCategory.grammar).toBe(1);
    expect(book.summary.byCategory.spelling).toBe(1);
    expect(book.summary.unclassifiedAttempts).toBe(1);
    expect(book.summary.wrongAttempts).toBe(3);
  });
});
