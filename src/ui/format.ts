/** 界面显示用的小工具 */

export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/** 触发浏览器下载一个文本文件 */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const LAST_EXPORT_KEY = 'english-lab.lastExportAt';

/** “上次导出时间”只是本设备的提示信息，存在 localStorage，不属于学习数据 */
export function getLastExport(): string | null {
  try {
    return localStorage.getItem(LAST_EXPORT_KEY);
  } catch {
    return null;
  }
}
export function setLastExport(iso: string): void {
  try {
    localStorage.setItem(LAST_EXPORT_KEY, iso);
  } catch {
    /* 隐私模式下可能不可用，忽略 */
  }
}

/** “下次复习”的口语化说法：今天 / 明天 / N 天后（按本地日期算） */
export function dueLabel(iso: string, now: Date = new Date()): string {
  const due = new Date(iso);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(due) - startOf(now)) / 86_400_000);
  if (days <= 0) return '今天';
  if (days === 1) return '明天';
  return `${days} 天后`;
}
