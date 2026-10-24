/**
 * 存储契约测试：内存实现和 IndexedDB 实现必须通过同一套测试，行为完全一致。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cardIdFor } from '../../src/storage/ids';
import { StoreError, type DataStore } from '../../src/storage/types';
import { attempt, card, iso, log, sampleSnapshot } from './helpers';

export function storeContract(name: string, makeStore: () => Promise<DataStore>) {
  describe(`DataStore 契约：${name}`, () => {
    let store: DataStore;
    beforeEach(async () => {
      store = await makeStore();
    });

    it('设备编号固定不变', async () => {
      const a = await store.getDeviceId();
      expect(a).toMatch(/^dev_/);
      expect(await store.getDeviceId()).toBe(a);
    });

    describe('作答 attempts', () => {
      it('新增后可读取，且读出的是副本', async () => {
        await store.attempts.add(attempt(1));
        const got = await store.attempts.get('att_' + '1'.padStart(20, '0'));
        expect(got).toEqual(attempt(1));
        (got as { userAnswer: string }).userAnswer = 'changed';
        expect((await store.attempts.get(attempt(1).id))?.userAnswer).toBe('She study English every day.');
      });

      it('ID 重复时拒绝，原记录不变', async () => {
        await store.attempts.add(attempt(1));
        await expect(store.attempts.add(attempt(1, { userAnswer: 'other' }))).rejects.toMatchObject({ code: 'DUPLICATE' });
        expect((await store.attempts.get(attempt(1).id))?.userAnswer).toBe('She study English every day.');
      });

      it('拒绝不一致或格式错误的数据', async () => {
        await expect(store.attempts.add(attempt(1, { outcome: 'independent', hintUsed: true, errors: [] }))).rejects.toMatchObject({ code: 'VALIDATION' });
        await expect(store.attempts.add(attempt(2, { outcome: 'hinted', hintUsed: false }))).rejects.toMatchObject({ code: 'VALIDATION' });
        await expect(store.attempts.add(attempt(3, { itemId: 'Bad Id' }))).rejects.toMatchObject({ code: 'VALIDATION' });
        await expect(store.attempts.add(attempt(4, { answeredAt: '2026-10-22 12:00' }))).rejects.toMatchObject({ code: 'VALIDATION' });
        await expect(store.attempts.add(attempt(5, { errors: [{ category: 'nonsense' as never, source: 'auto' }] }))).rejects.toMatchObject({ code: 'VALIDATION' });
        expect(await store.attempts.listAll()).toEqual([]);
      });

      it('listByItem 只返回该题的作答，按作答时间排序', async () => {
        await store.attempts.add(attempt(3));
        await store.attempts.add(attempt(1));
        await store.attempts.add(attempt(2, { itemId: 'q.present-simple.0002', outcome: 'independent', errors: [] }));
        const got = await store.attempts.listByItem('q.present-simple.0001');
        expect(got.map((a) => a.answeredAt)).toEqual([iso(1), iso(3)]);
      });

      it('updateErrors 只改错误标签并更新 updatedAt，且不会倒退', async () => {
        await store.attempts.add(attempt(1, { errors: [{ category: 'unclassified', source: 'auto' }] }));
        const id = attempt(1).id;
        const next = await store.attempts.updateErrors(
          id,
          [{ category: 'spelling', subtype: 'typo', source: 'manual', slip: true }],
          iso(100),
        );
        expect(next.errors[0]?.category).toBe('spelling');
        expect(next.updatedAt).toBe(iso(100));
        expect(next.userAnswer).toBe(attempt(1).userAnswer);
        const older = await store.attempts.updateErrors(id, [{ category: 'grammar', source: 'manual' }], iso(5));
        expect(older.updatedAt).toBe(iso(100));
      });

      it('updateErrors：找不到记录报 NOT_FOUND；非法标签被拒且原数据不变', async () => {
        await expect(store.attempts.updateErrors('att_missing', [])).rejects.toMatchObject({ code: 'NOT_FOUND' });
        await store.attempts.add(attempt(1));
        await expect(store.attempts.updateErrors(attempt(1).id, [{ category: 'bad' as never, source: 'auto' }])).rejects.toBeInstanceOf(StoreError);
        expect((await store.attempts.get(attempt(1).id))?.errors[0]?.category).toBe('grammar');
      });
    });

    describe('复习卡 cards', () => {
      it('新增、替换、按内容 ID 查找', async () => {
        await store.cards.put(card('q.present-simple.0001', 5));
        await store.cards.put(card('q.present-simple.0001', 9));
        expect((await store.cards.getByItem('q.present-simple.0001'))?.fsrs.due).toBe(iso(9));
        expect((await store.cards.listAll()).length).toBe(1);
      });

      it('卡片 ID 必须由内容 ID 推出', async () => {
        await expect(store.cards.put(card('q.present-simple.0001', 0, { id: 'card.q.other.0001' }))).rejects.toMatchObject({ code: 'VALIDATION' });
      });

      it('listDue：只返回已到期且未暂停的，按到期时间排序', async () => {
        await store.cards.put(card('q.a.0001', 30));
        await store.cards.put(card('q.a.0002', 10));
        await store.cards.put(card('q.a.0003', 20, { suspended: true }));
        await store.cards.put(card('q.a.0004', 500));
        const due = await store.cards.listDue(iso(60));
        expect(due.map((c) => c.itemId)).toEqual(['q.a.0002', 'q.a.0001']);
      });
    });

    describe('复习日志 reviewLogs（不可变）', () => {
      it('接口里没有修改和删除操作', () => {
        const l = store.reviewLogs as unknown as Record<string, unknown>;
        expect(l.update).toBeUndefined();
        expect(l.put).toBeUndefined();
        expect(l.delete).toBeUndefined();
        expect(l.remove).toBeUndefined();
      });

      it('完整保存评分、时间、算法版本与全部参数', async () => {
        await store.reviewLogs.append(log(1));
        const got = (await store.reviewLogs.listAll())[0];
        expect(got).toEqual(log(1));
        expect(got?.algorithm.parameters).toEqual(log(1).algorithm.parameters);
        expect(got?.algorithm.libraryVersion).toBe('ts-fsrs@test');
        expect(got?.rating).toBe(3);
        expect(got?.reviewedAt).toBe(iso(1));
      });

      it('ID 重复时拒绝，已有日志保持原样', async () => {
        await store.reviewLogs.append(log(1));
        await expect(store.reviewLogs.append(log(1, 'q.present-simple.0001', { rating: 1 }))).rejects.toMatchObject({ code: 'DUPLICATE' });
        expect((await store.reviewLogs.listAll())[0]?.rating).toBe(3);
      });

      it('拒绝缺少算法信息、评分越界或卡片不匹配的日志', async () => {
        const bad = log(1) as unknown as Record<string, unknown>;
        const { algorithm: _omit, ...withoutAlgo } = bad;
        await expect(store.reviewLogs.append(withoutAlgo as never)).rejects.toMatchObject({ code: 'VALIDATION' });
        await expect(store.reviewLogs.append(log(2, 'q.present-simple.0001', { rating: 5 as never }))).rejects.toMatchObject({ code: 'VALIDATION' });
        await expect(store.reviewLogs.append(log(3, 'q.present-simple.0001', { cardId: 'card.q.x.0001' }))).rejects.toMatchObject({ code: 'VALIDATION' });
        expect(await store.reviewLogs.listAll()).toEqual([]);
      });

      it('listByCard 按复习时间排序', async () => {
        await store.reviewLogs.append(log(3));
        await store.reviewLogs.append(log(1));
        await store.reviewLogs.append(log(2, 'q.present-simple.0002'));
        const got = await store.reviewLogs.listByCard(cardIdFor('q.present-simple.0001'));
        expect(got.map((l) => l.reviewedAt)).toEqual([iso(1), iso(3)]);
      });
    });

    describe('设置 settings', () => {
      it('读写与覆盖', async () => {
        expect(await store.settings.get('lastExportAt')).toBeUndefined();
        await store.settings.set('lastExportAt', iso(1), iso(1));
        await store.settings.set('lastExportAt', iso(2), iso(2));
        expect((await store.settings.get('lastExportAt'))?.value).toBe(iso(2));
        expect((await store.settings.listAll()).length).toBe(1);
      });

      it('app 设置的取值范围受校验', async () => {
        await expect(store.settings.set('app', { dailyNewLimit: -1, dailyReviewLimit: 50, fontScale: 1, reminder: 'off' })).rejects.toMatchObject({ code: 'VALIDATION' });
        await expect(store.settings.set('app', { dailyNewLimit: 5, dailyReviewLimit: 50, fontScale: 1, reminder: 'off' })).resolves.toBeUndefined();
      });
    });

    describe('快照、替换、同步预留', () => {
      it('replaceAll 后 exportSnapshot 与输入完全一致（已排序）', async () => {
        await store.replaceAll(sampleSnapshot());
        const snap = await store.exportSnapshot();
        expect(snap).toEqual(sampleSnapshot());
        expect(await store.countRecords()).toEqual({ attempts: 3, cards: 3, reviewLogs: 2, settings: 1 });
      });

      it('replaceAll 遇到非法数据：整体拒绝，原数据不变', async () => {
        await store.replaceAll(sampleSnapshot());
        const broken = sampleSnapshot();
        broken.attempts.push(attempt(9, { outcome: 'independent', hintUsed: true, errors: [] }));
        await expect(store.replaceAll(broken)).rejects.toBeInstanceOf(StoreError);
        expect(await store.exportSnapshot()).toEqual(sampleSnapshot());
      });

      it('replaceAll 遇到重复 ID：整体拒绝，原数据不变', async () => {
        await store.replaceAll(sampleSnapshot());
        const dup = sampleSnapshot();
        dup.reviewLogs.push(log(1));
        await expect(store.replaceAll(dup)).rejects.toMatchObject({ code: 'DUPLICATE' });
        expect(await store.exportSnapshot()).toEqual(sampleSnapshot());
      });

      it('replaceAll 不影响设备编号和本机备份', async () => {
        const dev = await store.getDeviceId();
        await store.backups.save({ id: 'bak_x', createdAt: iso(0), reason: 'manual', counts: { attempts: 0, cards: 0, reviewLogs: 0, settings: 0 }, sizeBytes: 2 }, '{}');
        await store.replaceAll(sampleSnapshot());
        await store.replaceAll({ attempts: [], cards: [], reviewLogs: [], settings: [] });
        expect(await store.getDeviceId()).toBe(dev);
        expect((await store.backups.list()).length).toBe(1);
      });

      it('listChangedSince 返回指定时间之后新增或修改的记录', async () => {
        await store.replaceAll(sampleSnapshot());
        const changed = await store.listChangedSince(iso(1));
        expect(changed.attempts.map((a) => a.id)).toEqual([attempt(2).id, attempt(3).id]);
        expect(changed.reviewLogs.map((l) => l.id)).toEqual([log(2).id]);
        expect(changed.settings).toEqual([]);
      });
    });

    describe('本机备份 backups', () => {
      const meta = (id: string, min: number) => ({
        id,
        createdAt: iso(min),
        reason: 'pre-import' as const,
        counts: { attempts: 0, cards: 0, reviewLogs: 0, settings: 0 },
        sizeBytes: 2,
      });
      it('保存、按时间倒序列出、读取内容、删除', async () => {
        await store.backups.save(meta('bak_a', 1), '{"a":1}');
        await store.backups.save(meta('bak_b', 2), '{"b":2}');
        expect((await store.backups.list()).map((b) => b.id)).toEqual(['bak_b', 'bak_a']);
        expect(await store.backups.getPayload('bak_a')).toBe('{"a":1}');
        await store.backups.delete('bak_a');
        expect(await store.backups.getPayload('bak_a')).toBeUndefined();
        expect((await store.backups.list()).length).toBe(1);
      });
    });
  });
}
