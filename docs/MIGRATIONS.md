# 数据版本与迁移

- 导出文件包含 `format: "english-lab-export"` 与 `schemaVersion`（当前 1）。
- `src/storage/importExport/migrations.ts` 中的 `MIGRATIONS` 是按版本号逐级升级的函数表，当前为空（只有版本 1）。
- 导入时：文件版本低于当前 → 依次执行迁移后再校验；文件版本高于当前 → 直接拒绝（提示升级程序）。
- 数据库结构变更使用 Dexie 的 `version(n)`，同时递增 `SCHEMA_VERSION` 并在 `MIGRATIONS` 里加一级。
- 每次迁移都必须带单元测试：旧版样例文件 → 迁移 → 通过校验。
- 时间字段必须是严格 UTC ISO（带毫秒，`toISOString()` 格式）。
