import { describe, expect, it } from 'vitest';
import { canonicalStringify, sha256Hex } from '../../src/storage/canonical';
import { countsTowardMastery, summarizeErrors } from '../../src/storage/errorTaxonomy';
import { cardIdFor, contentKind, isContentId, isRecordId, newRecordId } from '../../src/storage/ids';
import { migrateEnvelope } from '../../src/storage/importExport';
import { attemptSchema, DEFAULT_APP_SETTINGS, appSettingsSchema } from '../../src/storage/schema';
import { attempt } from './helpers';

describe('稳定 ID', () => {
  it('内容 ID 格式', () => {
    for (const ok of ['g.present-simple', 'q.present-simple.0001', 'v.run.1', 'r.ielts-reading-01', 't.cambridge-18.test-1']) {
      expect(isContentId(ok), ok).toBe(true);
    }
    for (const bad of ['', 'x.foo', 'q.', 'q.Foo', 'q.foo bar', 'q.foo--bar', 'q..foo', 'q.' + 'a'.repeat(100), 42, null]) {
      expect(isContentId(bad), String(bad)).toBe(false);
    }
    expect(contentKind('q.present-simple.0001')).toBe('q');
    expect(contentKind('nope')).toBeNull();
  });

  it('卡片 ID 由内容 ID 唯一决定', () => {
    expect(cardIdFor('q.present-simple.0001')).toBe('card.q.present-simple.0001');
  });

  it('记录 ID：格式正确、按时间排序、同一毫秒也不重复', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) ids.add(newRecordId('att', 1_700_000_000_000));
    expect(ids.size).toBe(5000);
    const a = newRecordId('log', 1_700_000_000_000);
    const b = newRecordId('log', 1_700_000_000_001);
    expect(isRecordId(a, 'log')).toBe(true);
    expect(isRecordId(a, 'att')).toBe(false);
    expect(a < b).toBe(true);
  });
});

describe('规范化 JSON 与校验码', () => {
  it('键顺序不同，结果相同；undefined 被忽略', () => {
    expect(canonicalStringify({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe(
      canonicalStringify({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1, x: undefined }),
    );
  });
  it('SHA-256 已知值', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('错题分类与统计不失真', () => {
  const a = (over: Parameters<typeof attempt>[1]) => attemptSchema.parse(attempt(1, over));

  it('拼写错误不会被算成语法错误；同一次作答可有多个标签', () => {
    const s = summarizeErrors([
      a({ errors: [{ category: 'spelling', source: 'auto' }] }),
      a({ errors: [{ category: 'grammar', source: 'auto' }, { category: 'spelling', source: 'auto' }] }),
    ]);
    expect(s.byCategory.grammar).toBe(1);
    expect(s.byCategory.spelling).toBe(2);
  });

  it('手滑单独计数，不进入类别统计，也不算待分类', () => {
    const s = summarizeErrors([a({ errors: [{ category: 'spelling', slip: true, source: 'self' }] })]);
    expect(s.slips).toBe(1);
    expect(s.byCategory.spelling).toBe(0);
    expect(s.unclassifiedAttempts).toBe(0);
    expect(s.wrongAttempts).toBe(1);
  });

  it('答错但没有标签 / 只有“待分类”：计入待分类，绝不默认算语法', () => {
    const s = summarizeErrors([
      a({ errors: [] }),
      a({ errors: [{ category: 'unclassified', source: 'auto' }] }),
    ]);
    expect(s.unclassifiedAttempts).toBe(2);
    expect(Object.values(s.byCategory).every((n) => n === 0)).toBe(true);
  });

  it('掌握度只计真实错误：手滑和待分类不计', () => {
    expect(countsTowardMastery({ category: 'grammar', source: 'auto' })).toBe(true);
    expect(countsTowardMastery({ category: 'grammar', slip: true, source: 'auto' })).toBe(false);
    expect(countsTowardMastery({ category: 'unclassified', source: 'auto' })).toBe(false);
  });

  it('支持语法、拼写、词汇、表达不自然四类（及理解偏差、标点大小写）', () => {
    for (const c of ['grammar', 'spelling', 'vocabulary', 'unnatural', 'meaning', 'mechanics']) {
      expect(() => attemptSchema.parse(attempt(1, { errors: [{ category: c as never, source: 'manual' }] }))).not.toThrow();
    }
  });
});

describe('设置默认值与迁移外壳', () => {
  it('默认设置本身合法', () => {
    expect(appSettingsSchema.safeParse(DEFAULT_APP_SETTINGS).success).toBe(true);
  });
  it('迁移：当前版本无需升级；缺少版本号或更高版本被拒绝', () => {
    expect(migrateEnvelope({ schemaVersion: 1 })).toMatchObject({ ok: true, migratedFrom: null });
    expect(migrateEnvelope({})).toMatchObject({ ok: false });
    expect(migrateEnvelope({ schemaVersion: 2 })).toMatchObject({ ok: false });
  });
});
