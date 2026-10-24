# English Lab

私人使用的雅思备考学习网站。

线上地址：https://english-lab-mrshder.vercel.app

当前版本 0.2.0 包含：
- 第一步：项目骨架、暗色主题、存储层、导入导出/备份。
- 第二步（先做最急的）：5 个语法点题库、练习、错题本（错因分类）、FSRS 间隔复习、简单首页。
- 还没做：词汇模块、听力、阅读、写作批改、进度统计图表、设置里的学习量调整、云同步。

## 常用命令

```bash
npm install
npm run dev          # 本地开发
npm run typecheck    # 类型检查
npm test             # 单元测试（120 个）
npm run test:e2e     # 构建 + 浏览器端到端测试（16 个）
npm run build        # 生成 dist/
```

端到端测试默认使用 `/opt/pw-browsers/chromium`；本机不同请设置环境变量 `CHROMIUM_PATH`。
注意：Playwright 的 `setInputFiles` 遇到含中文的路径会静默失败，测试里的临时文件一律放在纯 ASCII 目录。

## 静态部署

`dist/` 是纯静态文件：相对路径（`base: './'`）、hash 路由（`#/settings`），无外部请求，不依赖任何云平台。
放到任意静态托管的任意子路径都能运行（e2e 已在 `/lab/v1/` 下验证）。

## 目录

- `src/storage/`：存储层。`types.ts` 是统一接口 `DataStore`（含为未来同步预留的 `SyncAdapter`，V1 不实现）；`dexieBackend.ts`（IndexedDB）与 `memoryBackend.ts` 共用 `store.ts` 里的全部业务规则。
- `src/storage/importExport/`：导出、校验、导入计划、备份、恢复、版本迁移。
- `src/content/`、`content/`：题库格式与内容包（见 `docs/CONTENT-FORMAT.md`）。
- `src/learning/`：判题与错因判断、FSRS 调度、作答记录、查询。
- `src/ui/`、`src/pages/`：界面。
- `tests/unit`、`tests/e2e`：测试。
- `docs/`：ID 规则、迁移规则。

## 数据与备份

- 数据存在浏览器 IndexedDB。iPad Safari 可能在长期不用时清理网站数据，请定期在“设置”导出 JSON 文件并放到“文件”App 或云盘。
- 导入流程：选文件 → 格式校验（失败则整份拒绝，数据不动）→ 预览差异 → 勾选确认 → 自动备份当前数据 → 写入 → 校验，失败自动回滚。
- 本机备份最多保留 10 份，与学习数据在同一浏览器里，不能代替导出文件。
- 恢复备份走同样的预览与确认流程。

## 关键设计

- 复习日志只追加，不能修改或删除（接口层与数据库钩子双重保护）。
- 错题分类：grammar / spelling / vocabulary / unnatural / meaning / mechanics / unclassified；`slip`（笔误）不计入掌握度统计；无法判断的记为 unclassified，不默认算语法。
- 稳定 ID 见 `docs/ID-RULES.md`；迁移见 `docs/MIGRATIONS.md`；题库格式见 `docs/CONTENT-FORMAT.md`。

## 复习规则（FSRS）

- 使用 ts-fsrs，目标记忆率 0.9，关闭同日短期步骤和随机抖动（间隔以天计，结果可重复）。
- 评分由作答结果自动决定：答错=重来，提示后答对=困难，独立答对=良好。
- 每道练习过的题自动建一张复习卡；今天到期（含今天内到期）的卡出现在“复习”里，每日上限 50。
- 同一天重复练习同一道题，只有答错、已到期或第一次做才会更新排期，避免反复推迟复习。
- 每次排期都追加一条不可变日志，含评分、时间、算法名称与版本、完整参数、复习前后状态。

## 错因分类

- 程序只在有把握时自动判断：命中题库登记的常见错误，或长单词只差 1 到 2 个字母（拼写）。
- 其余记为“待分类”，不会默认算成语法；学生可以在答题后或错题本里自己改。
- “手滑”记录在案，但不计入各类错误统计。

## 部署

正式站：https://english-lab-mrshder.vercel.app
推送到 `main` 后会自动重新构建并更新这个地址。

GitHub Pages 工作流（`.github/workflows/deploy.yml`）仍会在推送后跑测试并尝试发布；第一次使用需要在仓库 Settings → Pages 里把 Source 选为 **GitHub Actions**。那条地址是 `https://mrshder.github.io/english-lab/`，目前未开通。

## 谁可以改什么

- **内容（题库、词汇）**：改 `content/*.json`，格式见 `docs/CONTENT-FORMAT.md`，提交后自动校验、发布。AI（Claude、ChatGPT 等）可以通过提交改动来更新题库。
- **学习记录**：保存在你自己的浏览器里，不在仓库里。需要让 AI 看到进度时，在“设置”页导出备份文件发给它。
