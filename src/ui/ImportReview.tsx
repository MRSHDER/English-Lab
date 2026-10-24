/**
 * 导入预览与确认面板。
 * 流程：选择文件 → 校验 → 在这里预览会发生什么 → 勾选确认 → 才会真正写入。
 * 导入文件和“从备份恢复”共用这一个面板。
 */
import { useEffect, useState } from 'preact/hooks';
import {
  applyImport,
  buildImportPlan,
  ImportError,
  type ImportMode,
  type ImportPlan,
  type ImportResult,
} from '../storage/importExport';
import type { BackupReason, DataStore, ExportFile, TableName } from '../storage';
import { TABLE_NAMES } from '../storage';
import { formatTime, shortId } from './format';

const TABLE_LABELS: Record<TableName, string> = {
  attempts: '作答记录',
  cards: '复习卡',
  reviewLogs: '复习日志',
  settings: '设置项',
};
const OUTCOME_LABELS: Record<string, string> = { independent: '独立答对', hinted: '提示后答对', wrong: '答错' };

export interface ImportSource {
  file: ExportFile;
  warnings: string[];
  /** 界面上显示的来源，例如文件名或“本机备份 2026-10-22 04:41” */
  label: string;
}

interface Props {
  store: DataStore;
  source: ImportSource;
  defaultMode: ImportMode;
  /** 备份原因：导入文件是 pre-import，从备份恢复是 pre-restore */
  backupReason: BackupReason;
  onDone: (result: ImportResult) => void;
  onCancel: () => void;
}

export function ImportReview({ store, source, defaultMode, backupReason, onDone, onCancel }: Props) {
  const [mode, setMode] = useState<ImportMode>(defaultMode);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPlan(null);
    setPlanError(null);
    setConfirmed(false);
    buildImportPlan(store, source.file, mode).then(
      (p) => alive && setPlan(p),
      (e) => alive && setPlanError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      alive = false;
    };
  }, [store, source, mode]);

  async function run() {
    if (!plan) return;
    setBusy(true);
    setApplyError(null);
    try {
      const res = await applyImport(store, plan, { confirmed, file: source.file, backupReason });
      onDone(res);
    } catch (e) {
      setApplyError(e instanceof ImportError || e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const p = plan?.preview;
  const warnings = [...source.warnings, ...(plan?.warnings ?? [])];

  return (
    <section class="card" aria-labelledby="import-preview-title" data-testid="import-preview">
      <h2 id="import-preview-title">导入预览：{source.label}</h2>
      <p class="hint">下面只是预览，还没有改动任何数据。确认之后才会导入，导入前会自动备份。</p>

      {p && (
        <dl class="kv" style="margin-top:14px">
          <dt>导出时间</dt>
          <dd>{formatTime(p.exportedAt)}</dd>
          <dt>来源设备</dt>
          <dd class="mono">{shortId(p.deviceId)}</dd>
          <dt>程序 / 结构版本</dt>
          <dd>
            {p.appVersion} / {p.schemaVersion}
          </dd>
          <dt>作答时间范围</dt>
          <dd>{p.attemptRange ? `${formatTime(p.attemptRange.from)} 至 ${formatTime(p.attemptRange.to)}` : '（没有作答记录）'}</dd>
        </dl>
      )}

      <div class="radio-row" role="radiogroup" aria-label="导入方式">
        <label>
          <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
          <span>
            <strong>合并（推荐）</strong>
            <br />
            <span class="hint">保留本机已有数据，只加入文件里新的记录。</span>
          </span>
        </label>
        <label>
          <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
          <span>
            <strong>替换</strong>
            <br />
            <span class="hint">数据变得和文件完全一样，本机多出来的记录会被删除。</span>
          </span>
        </label>
      </div>

      {planError && <p class="msg-error">无法生成预览：{planError}</p>}

      {plan && (
        <div class="table-wrap">
          <table data-testid="import-diff">
            <thead>
              <tr>
                <th>数据</th>
                <th>文件中</th>
                <th>本机现有</th>
                <th>新增</th>
                <th>相同</th>
                <th>覆盖</th>
                <th>保留本机</th>
                <th>删除</th>
              </tr>
            </thead>
            <tbody>
              {TABLE_NAMES.map((t) => {
                const d = plan.tables[t];
                return (
                  <tr key={t}>
                    <td>{TABLE_LABELS[t]}</td>
                    <td>{d.incoming}</td>
                    <td>{d.existing}</td>
                    <td>{d.added}</td>
                    <td>{d.identical}</td>
                    <td>{d.updated}</td>
                    <td>{d.keptLocal}</td>
                    <td>{d.removed}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {p && p.sampleAttempts.length > 0 && (
        <>
          <p class="hint">文件里最近的作答（用来确认这是你要导入的数据）：</p>
          <ul class="list" data-testid="import-samples">
            {p.sampleAttempts.map((a) => (
              <li key={a.answeredAt + a.prompt}>
                <span class="hint">{formatTime(a.answeredAt)} · {OUTCOME_LABELS[a.outcome] ?? a.outcome}</span>
                <br />
                {a.prompt} → <span class="mono">{a.answer}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {warnings.length > 0 && (
        <ul class="errors msg-warn" style="color:var(--warn)" data-testid="import-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <label class="check">
        <input
          type="checkbox"
          data-testid="import-confirm"
          checked={confirmed}
          disabled={!plan || busy}
          onChange={(e) => setConfirmed((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>我已看过上面的预览，确认按所选方式导入（导入前会自动在本机备份当前数据）。</span>
      </label>

      {applyError && (
        <p class="msg-error" role="alert" data-testid="import-error">
          {applyError}
        </p>
      )}

      <div class="row">
        <button class="btn primary" data-testid="import-run" disabled={!plan || !confirmed || busy} onClick={run}>
          {busy ? '正在导入…' : '开始导入'}
        </button>
        <button class="btn" disabled={busy} onClick={onCancel}>
          取消
        </button>
      </div>
    </section>
  );
}
