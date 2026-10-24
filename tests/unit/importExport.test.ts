// 必须最先引入：它会先装好模拟的 IndexedDB，之后才能加载 Dexie
import { makeDexieStore } from './dexieHelper';
import { describe, expect, it } from 'vitest';
import { MemoryBackend } from '../../src/storage/memoryBackend';
import { createStore } from '../../src/storage/store';
import { sortSnapshot, type ExportFile, type Snapshot } from '../../src/storage/schema';
import type { DataStore } from '../../src/storage/types';
import {
  applyImport,
  buildExportFile,
  buildImportPlan,
  createBackup,
  ImportError,
  loadBackupAsImport,
  MAX_BACKUPS,
  parseImportText,
  serializeExport,
} from '../../src/storage/importExport';
import { attempt, card, iso, log, sampleSnapshot } from './helpers';

const makers: Array<[string, () => Promise<DataStore>]> = [
  ['内存实现', async () => createStore(new MemoryBackend(), 'memory', false)],
  ['IndexedDB 实现', async () => (await makeDexieStore()).store],
];

async function filled(make: () => Promise<DataStore>, snap: Snapshot = sampleSnapshot()) {
  const s = await make();
  await s.replaceAll(snap);
  return s;
}

async function parsed(file: ExportFile) {
  const r = await parseImportText(serializeExport(file));
  if (!r.ok) throw new Error('测试文件应当有效：' + r.errors.join('；'));
  return r.file;
}

describe('导入文件校验 parseImportText', () => {
  async function validText(): Promise<string> {
    const s = await filled(makers[0]![1]);
    return serializeExport(await buildExportFile(s));
  }
  const edit = async (fn: (o: Record<string, any>) => void, keepChecksum = false) => {
    const o = JSON.parse(await validText());
    fn(o);
    if (!keepChecksum) delete o.checksum;
    return JSON.stringify(o);
  };

  it('有效文件通过，内容与导出时一致', async () => {
    const r = await parseImportText(await validText());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.file.data).toEqual(sampleSnapshot());
      expect(r.warnings).toEqual([]);
    }
  });

  it('拒绝：不是 JSON / 不是对象 / 格式标识不对', async () => {
    expect((await parseImportText('{bad')).ok).toBe(false);
    expect((await parseImportText('[]')).ok).toBe(false);
    const r = await parseImportText(JSON.stringify({ hello: 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('不是 English Lab');
  });

  it('拒绝：文件太大', async () => {
    const r = await parseImportText(await validText(), { maxBytes: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('太大');
  });

  it('拒绝：校验码不一致（内容被改动）', async () => {
    const text = await edit((o) => (o.data.attempts[0].userAnswer = '被悄悄改过'), true);
    const r = await parseImportText(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('校验码不一致');
  });

  it('没有校验码时给出警告但允许继续', async () => {
    const r = await parseImportText(await edit(() => {}));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join('')).toContain('没有校验码');
  });

  it('拒绝：来自更新版本的文件', async () => {
    const r = await parseImportText(await edit((o) => (o.schemaVersion = 99)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('更新的版本');
  });

  it('拒绝：记录格式错误，并指出表、序号、ID 和字段', async () => {
    const text = await edit((o) => {
      o.data.attempts[1].outcome = 'maybe';
      o.data.cards[0].fsrs.due = '明天';
    });
    const r = await parseImportText(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const all = r.errors.join('\n');
      expect(all).toContain('attempts[1]（att_');
      expect(all).toContain('outcome');
      expect(all).toContain('cards[0]');
      expect(all).toContain('fsrs.due');
    }
  });

  it('拒绝：文件内 ID 重复 / 多余的表 / 缺少表 / 非 UTC 时间', async () => {
    const dup = await parseImportText(await edit((o) => o.data.reviewLogs.push(o.data.reviewLogs[0])));
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors.join('')).toContain('重复');

    const extra = await parseImportText(await edit((o) => (o.data.secrets = [])));
    expect(extra.ok).toBe(false);

    const missing = await parseImportText(await edit((o) => delete o.data.cards));
    expect(missing.ok).toBe(false);

    const tz = await parseImportText(await edit((o) => (o.data.attempts[0].answeredAt = '2026-10-22T12:00:00+08:00')));
    expect(tz.ok).toBe(false);
  });

  it('一次最多列出 20 条错误，并说明还有多少未列出', async () => {
    const text = await edit((o) => {
      o.data.attempts = Array.from({ length: 40 }, (_, i) => ({ id: `att_bad${i}` }));
    });
    const r = await parseImportText(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.at(-1)).toContain('未列出');
  });

  it('旧版本文件按迁移表自动升级，并提示', async () => {
    const migrations = {
      0: (env: Record<string, unknown>) => {
        const data = env.data as Record<string, unknown>;
        const { attemptz, ...rest } = data;
        return { ...env, data: { ...rest, attempts: attemptz } };
      },
    };
    const o = JSON.parse(await validText());
    o.schemaVersion = 0;
    o.data.attemptz = o.data.attempts;
    delete o.data.attempts;
    delete o.checksum;
    const r = await parseImportText(JSON.stringify(o), { migrations });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.migratedFrom).toBe(0);
      expect(r.file.schemaVersion).toBe(1);
      expect(r.file.data.attempts.length).toBe(3);
      expect(r.warnings.join('')).toContain('已自动升级');
    }
    const none = await parseImportText(JSON.stringify(o), { migrations: {} });
    expect(none.ok).toBe(false);
  });
});

for (const [name, make] of makers) {
  describe(`导入流程：${name}`, () => {
    it('导出 → 清空设备 → 导入 → 数据完全恢复', async () => {
      const a = await filled(make);
      const file = await parsed(await buildExportFile(a));
      const b = await make();
      const plan = await buildImportPlan(b, file, 'merge');
      await applyImport(b, plan, { confirmed: true, file });
      expect(await b.exportSnapshot()).toEqual(await a.exportSnapshot());
    });

    it('预览只计算，不写入任何数据', async () => {
      const s = await make();
      const file = await parsed(await buildExportFile(await filled(make)));
      const plan = await buildImportPlan(s, file, 'merge');
      expect(plan.tables.attempts.added).toBe(3);
      expect(plan.preview.sampleAttempts.length).toBe(3);
      expect(plan.preview.attemptRange?.from).toBe(iso(1));
      expect(await s.countRecords()).toEqual({ attempts: 0, cards: 0, reviewLogs: 0, settings: 0 });
      expect(await s.backups.list()).toEqual([]);
    });

    it('未确认就不执行：数据不变、也不产生备份', async () => {
      const s = await make();
      const file = await parsed(await buildExportFile(await filled(make)));
      const plan = await buildImportPlan(s, file, 'merge');
      for (const bad of [false, undefined, 'yes', 1] as unknown[]) {
        await expect(applyImport(s, plan, { confirmed: bad as boolean, file })).rejects.toMatchObject({ code: 'NOT_CONFIRMED' });
      }
      expect((await s.countRecords()).attempts).toBe(0);
      expect(await s.backups.list()).toEqual([]);
    });

    it('执行前自动备份：备份里是导入之前的数据', async () => {
      const s = await filled(make, { ...sampleSnapshot(), attempts: [attempt(50)], cards: [], reviewLogs: [], settings: [] });
      const file = await parsed(await buildExportFile(await filled(make)));
      const plan = await buildImportPlan(s, file, 'replace');
      const res = await applyImport(s, plan, { confirmed: true, file });
      expect(res.backup.reason).toBe('pre-import');
      expect(res.backup.counts.attempts).toBe(1);
      const backed = await parseImportText((await s.backups.getPayload(res.backup.id)) as string);
      expect(backed.ok && backed.file.data.attempts.map((a) => a.id)).toEqual([attempt(50).id]);
    });

    it('备份失败就中止：数据保持原样', async () => {
      const s = await filled(make, { attempts: [attempt(50)], cards: [], reviewLogs: [], settings: [] });
      const file = await parsed(await buildExportFile(await filled(make)));
      const plan = await buildImportPlan(s, file, 'replace');
      const before = await s.exportSnapshot();
      s.backups.save = async () => {
        throw new Error('磁盘已满');
      };
      await expect(applyImport(s, plan, { confirmed: true, file })).rejects.toMatchObject({ code: 'BACKUP_FAILED' });
      expect(await s.exportSnapshot()).toEqual(before);
    });

    it('预览之后本机数据变了：要求重新预览，数据不变', async () => {
      const s = await make();
      const file = await parsed(await buildExportFile(await filled(make)));
      const plan = await buildImportPlan(s, file, 'merge');
      await s.attempts.add(attempt(77));
      await expect(applyImport(s, plan, { confirmed: true, file })).rejects.toMatchObject({ code: 'STALE_PLAN' });
      expect((await s.countRecords()).attempts).toBe(1);
    });

    it('写入失败：保持原样；写入结果与计划不一致：自动回滚', async () => {
      const s = await filled(make, { attempts: [attempt(50)], cards: [], reviewLogs: [], settings: [] });
      const file = await parsed(await buildExportFile(await filled(make)));
      const before = await s.exportSnapshot();

      const planA = await buildImportPlan(s, file, 'replace');
      const realReplace = s.replaceAll;
      s.replaceAll = async () => {
        throw new Error('写入出错');
      };
      await expect(applyImport(s, planA, { confirmed: true, file })).rejects.toMatchObject({ code: 'WRITE_FAILED' });
      expect(await s.exportSnapshot()).toEqual(before);

      // 模拟“写进去的少了一条”：第一次写入被截断，第二次（回滚）正常
      let calls = 0;
      s.replaceAll = async (snap) => {
        calls += 1;
        return realReplace(calls === 1 ? { ...snap, attempts: snap.attempts.slice(1) } : snap);
      };
      const planB = await buildImportPlan(s, file, 'replace');
      await expect(applyImport(s, planB, { confirmed: true, file })).rejects.toMatchObject({ code: 'VERIFY_FAILED' });
      expect(await s.exportSnapshot()).toEqual(before);
    });

    it('合并：新增、相同、较新覆盖、较旧保留本机，日志冲突保留本机并警告', async () => {
      const local: Snapshot = {
        attempts: [attempt(1), attempt(2, { userAnswer: '本机较新', updatedAt: iso(500) })],
        cards: [card('q.present-simple.0001', 10, { updatedAt: iso(1) })],
        reviewLogs: [log(1), log(2, 'q.present-simple.0001', { rating: 4 })],
        settings: [],
      };
      const incoming: Snapshot = {
        attempts: [attempt(1), attempt(2, { userAnswer: '文件较旧', updatedAt: iso(100) }), attempt(3)],
        cards: [card('q.present-simple.0001', 99, { updatedAt: iso(300) })],
        reviewLogs: [log(1), log(2, 'q.present-simple.0001', { rating: 1 }), log(3, 'q.present-simple.0001')],
        settings: [],
      };
      const s = await filled(make, local);
      const target = await filled(make, incoming);
      const file = await parsed(await buildExportFile(target));
      const plan = await buildImportPlan(s, file, 'merge');

      expect(plan.tables.attempts).toMatchObject({ added: 1, identical: 1, keptLocal: 1, updated: 0, removed: 0 });
      expect(plan.tables.cards).toMatchObject({ updated: 1 });
      expect(plan.tables.reviewLogs).toMatchObject({ added: 1, identical: 1, keptLocal: 1 });
      expect(plan.warnings.join('')).toContain('复习日志');

      await applyImport(s, plan, { confirmed: true, file });
      const after = await s.exportSnapshot();
      expect(after.attempts.find((a) => a.id === attempt(2).id)?.userAnswer).toBe('本机较新');
      expect(after.attempts.length).toBe(3);
      expect(after.cards[0]?.fsrs.due).toBe(iso(99));
      expect(after.reviewLogs.find((l) => l.id === log(2).id)?.rating).toBe(4);
      expect(after.reviewLogs.length).toBe(3);
    });

    it('替换：本机多余记录被删除，并在预览里明确警告', async () => {
      const s = await filled(make, { attempts: [attempt(50), attempt(51)], cards: [], reviewLogs: [], settings: [] });
      const file = await parsed(await buildExportFile(await filled(make)));
      const plan = await buildImportPlan(s, file, 'replace');
      expect(plan.tables.attempts.removed).toBe(2);
      expect(plan.warnings.join('')).toContain('删除本机 2 条');
      await applyImport(s, plan, { confirmed: true, file });
      expect(await s.exportSnapshot()).toEqual(sortSnapshot(sampleSnapshot()));
    });

    it('从本机备份恢复：恢复前再做一次备份，数据回到备份时的样子', async () => {
      const s = await filled(make);
      const original = await s.exportSnapshot();
      const bak = await createBackup(s, 'manual');

      await s.replaceAll({ attempts: [attempt(90)], cards: [], reviewLogs: [], settings: [] });
      const parsedBak = await loadBackupAsImport(s, bak.id);
      expect(parsedBak.ok).toBe(true);
      if (!parsedBak.ok) return;
      const plan = await buildImportPlan(s, parsedBak.file, 'replace');
      const res = await applyImport(s, plan, { confirmed: true, file: parsedBak.file, backupReason: 'pre-restore' });
      expect(res.backup.reason).toBe('pre-restore');
      expect(await s.exportSnapshot()).toEqual(original);
    });

    it('本机备份最多保留 10 份，删除最旧的', async () => {
      const s = await filled(make);
      for (let i = 0; i < MAX_BACKUPS + 3; i++) await createBackup(s, 'manual', new Date(Date.parse(iso(0)) + i * 1000));
      const list = await s.backups.list();
      expect(list.length).toBe(MAX_BACKUPS);
      expect(list.at(-1)?.createdAt).toBe(new Date(Date.parse(iso(0)) + 3 * 1000).toISOString());
    });
  });
}
