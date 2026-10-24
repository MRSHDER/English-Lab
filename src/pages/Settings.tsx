import type { DataStore, PersistState } from '../storage';
import { DataSection } from '../ui/DataSection';

export function Settings({ store, persist }: { store: DataStore; persist: PersistState }) {
  return (
    <div>
      <h1 class="page-title">设置</h1>
      <p class="page-sub">数据与备份。每日学习量、字体大小等设置会在后续模块加入。</p>
      <DataSection store={store} persist={persist} />
    </div>
  );
}
