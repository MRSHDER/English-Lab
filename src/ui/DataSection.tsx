/** 设置页里的“数据与备份”：存储状态、导出、导入、本机备份与恢复 */
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { BackupMeta, DataStore, PersistState, TableName } from '../storage';
import { SCHEMA_VERSION } from '../storage';
import {
  buildExportFile,
  createBackup,
  exportFilename,
  loadBackupAsImport,
  MAX_BACKUPS,
  MAX_IMPORT_BYTES,
  parseImportText,
  serializeExport,
  type ImportResult,
} from '../storage/importExport';
import { APP_VERSION } from '../version';
import { downloadText, formatSize, formatTime, getLastExport, setLastExport, shortId } from './format';
import { ImportReview, type ImportSource } from './ImportReview';

const REASON_LABELS: Record<BackupMeta['reason'], string> = {
  'pre-import': '导入前自动备份',
  'pre-restore': '恢复前自动备份',
  manual: '手动备份',
};
const PERSIST_LABELS: Record<PersistState, string> = {
  granted: '已请求保留：浏览器承诺尽量不自动清理',
  denied: '浏览器未承诺保留，长期不用时可能被清理，请定期导出备份',
  unsupported: '这个浏览器不支持查询，请定期导出备份',
};

interface Pending {
  source: ImportSource;
  defaultMode: 'merge' | 'replace';
  backupReason: 'pre-import' | 'pre-restore';
}

export function DataSection({ store, persist }: { store: DataStore; persist: PersistState }) {
  const [counts, setCounts] = useState<Record<TableName, number> | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [lastExport, setLastExportState] = useState<string | null>(getLastExport());
  const [pending, setPending] = useState<Pending | null>(null);
  const [fileErrors, setFileErrors] = useState<string[] | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  const refresh = useCallback(async () => {
    setCounts(await store.countRecords());
    setBackups(await store.backups.list());
    setDeviceId(await store.getDeviceId());
  }, [store]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function exportNow() {
    setNotice(null);
    try {
      const now = new Date();
      const file = await buildExportFile(store, now);
      downloadText(exportFilename(now), serializeExport(file));
      setLastExport(now.toISOString());
      setLastExportState(now.toISOString());
      setNotice({ kind: 'ok', text: '已生成备份文件。请确认它保存到了你找得到的地方（例如“文件”App 或云盘）。' });
    } catch (e) {
      setNotice({ kind: 'error', text: `导出失败：${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function pickFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    setNotice(null);
    setFileErrors(null);
    setPending(null);
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) {
      setFileErrors([`文件太大（${formatSize(f.size)}），超过 ${formatSize(MAX_IMPORT_BYTES)} 的上限，已拒绝。`]);
      return;
    }
    if (!/\.json$/i.test(f.name) && f.type !== 'application/json') {
      setFileErrors(['只支持 .json 文件。']);
      return;
    }
    const result = await parseImportText(await f.text());
    if (!result.ok) {
      setFileErrors(result.errors);
      return;
    }
    setPending({
      source: { file: result.file, warnings: result.warnings, label: f.name },
      defaultMode: 'merge',
      backupReason: 'pre-import',
    });
  }

  async function backupNow() {
    setNotice(null);
    try {
      await createBackup(store, 'manual');
      await refresh();
      setNotice({ kind: 'ok', text: '已在本机保存一份备份。' });
    } catch (e) {
      setNotice({ kind: 'error', text: `备份失败：${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function downloadBackup(b: BackupMeta) {
    const payload = await store.backups.getPayload(b.id);
    if (payload === undefined) return setNotice({ kind: 'error', text: '找不到这份备份。' });
    downloadText(exportFilename(new Date(b.createdAt)), payload);
  }

  async function startRestore(b: BackupMeta) {
    setNotice(null);
    setFileErrors(null);
    const r = await loadBackupAsImport(store, b.id);
    if (!r.ok) return setFileErrors(r.errors);
    setPending({
      source: { file: r.file, warnings: r.warnings, label: `本机备份 ${formatTime(b.createdAt)}` },
      defaultMode: 'replace',
      backupReason: 'pre-restore',
    });
    document.getElementById('import-anchor')?.scrollIntoView({ block: 'start' });
  }

  async function done(res: ImportResult) {
    setPending(null);
    setFileInputKey((k) => k + 1);
    await refresh();
    setNotice({
      kind: 'ok',
      text: `导入完成。导入前的数据已备份（${formatTime(res.backup.createdAt)}），可在下方“本机备份”里找到。`,
    });
  }

  return (
    <div class="stack">
      <section class="card" aria-labelledby="storage-title">
        <h2 id="storage-title">存储状态</h2>
        <dl class="kv" style="margin-top:12px" data-testid="storage-status">
          <dt>存储位置</dt>
          <dd>
            {store.kind === 'indexeddb' ? (
              <span class="pill ok">本机浏览器（IndexedDB）</span>
            ) : (
              <span class="pill warn">临时内存，刷新后会丢失</span>
            )}
          </dd>
          <dt>浏览器保留</dt>
          <dd>{store.kind === 'indexeddb' ? PERSIST_LABELS[persist] : '—'}</dd>
          <dt>本机记录数</dt>
          <dd data-testid="record-counts">
            {counts
              ? `作答 ${counts.attempts} · 复习卡 ${counts.cards} · 复习日志 ${counts.reviewLogs} · 设置 ${counts.settings}`
              : '读取中…'}
          </dd>
          <dt>上次导出</dt>
          <dd>{lastExport ? formatTime(lastExport) : '还没有导出过'}</dd>
          <dt>设备编号</dt>
          <dd class="mono">{deviceId ? shortId(deviceId) : '…'}</dd>
          <dt>版本</dt>
          <dd>
            程序 {APP_VERSION} · 数据结构 {SCHEMA_VERSION} · 云同步：未启用
          </dd>
        </dl>
      </section>

      <section class="card" aria-labelledby="export-title">
        <h2 id="export-title">导出</h2>
        <p class="hint" style="margin-bottom:12px">
          把全部学习数据保存成一个 JSON 文件。iPad 的浏览器可能在长期不用时清理网站数据，所以请定期导出，并把文件放到“文件”App 或云盘。
        </p>
        <button class="btn primary" data-testid="export-btn" onClick={exportNow}>
          导出备份文件
        </button>
      </section>

      <section class="card" id="import-anchor" aria-labelledby="import-title">
        <h2 id="import-title">导入</h2>
        <p class="hint" style="margin-bottom:12px">
          选择之前导出的 JSON 文件。会先检查格式，再给你看预览，确认后才会导入；不会未经确认覆盖任何数据。
        </p>
        <input
          key={fileInputKey}
          type="file"
          accept="application/json,.json"
          data-testid="import-file"
          aria-label="选择要导入的 JSON 文件"
          onChange={pickFile}
        />
        {fileErrors && (
          <div role="alert" data-testid="import-file-errors">
            <p class="msg-error" style="margin-top:12px">这个文件不能导入，数据没有被改动：</p>
            <ul class="errors">
              {fileErrors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {pending && (
        <ImportReview
          store={store}
          source={pending.source}
          defaultMode={pending.defaultMode}
          backupReason={pending.backupReason}
          onDone={done}
          onCancel={() => {
            setPending(null);
            setFileInputKey((k) => k + 1);
          }}
        />
      )}

      {notice && (
        <p class={notice.kind === 'ok' ? 'msg-ok' : 'msg-error'} role="status" data-testid="notice">
          {notice.text}
        </p>
      )}

      <section class="card" aria-labelledby="backup-title">
        <div class="row spread">
          <h2 id="backup-title">本机备份</h2>
          <button class="btn small" data-testid="backup-now" onClick={backupNow}>
            现在备份一份
          </button>
        </div>
        <p class="hint">
          导入或恢复前会自动备份，最多保留最近 {MAX_BACKUPS} 份。本机备份与学习数据存在同一个浏览器里，不能代替导出到文件。
        </p>
        {backups.length === 0 ? (
          <p class="hint" style="margin-top:12px">还没有备份。</p>
        ) : (
          <ul class="list" data-testid="backup-list">
            {backups.map((b) => (
              <li key={b.id}>
                <div class="row spread">
                  <div>
                    <strong>{formatTime(b.createdAt)}</strong> <span class="pill">{REASON_LABELS[b.reason]}</span>
                    <br />
                    <span class="hint">
                      作答 {b.counts.attempts} · 复习卡 {b.counts.cards} · 日志 {b.counts.reviewLogs} · {formatSize(b.sizeBytes)}
                    </span>
                  </div>
                  <div class="row">
                    <button class="btn small" onClick={() => downloadBackup(b)}>下载</button>
                    <button class="btn small" data-testid="restore-btn" onClick={() => startRestore(b)}>恢复…</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
