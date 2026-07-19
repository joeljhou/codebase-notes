# Codebase Notes 集成测试全流程

> 状态：实现中
> 最后更新：2026-07-17
> 适用范围：v1 开发、双端联调和发布验收
> 关联文档：[协议规范](S20260717_platform_codebase_notes_protocol.md)、[实现方案](S20260717_platform_codebase_notes_implementation.md)、[设计评审](../reports/R20260717_platform_codebase_notes_design_review.md)

## 1. 当前状态与原则

截至 2026-07-17，双端 adapter、构建脚本和共享 fixtures 已创建。当前自动化结果：Schema verifier 通过；TypeScript 40 个测试通过；Kotlin 34 个测试通过；VS Code Extension Host 5 个 case 通过；两个发布包均可构建。真实 JetBrains IDE 安装、跨编辑器 E2E 和兼容矩阵尚未执行。

测试按实现阶段递增。第一条竖切不需要先搭完所有 OS、IDE 和 UI 自动化；但 v1 发布前必须完成双端、并发写入、原子写和打包安装验证。

## 2. 测试分层

| 层级 | 证明什么 | 启动 IDE | 阶段 |
| --- | --- | --- | --- |
| L0 Schema/fixtures | 输入与协议样例有效 | 否 | 从阶段 1 起 |
| L1 core unit | parser/path/merge/move/serializer | 否 | 对应模块落地后 |
| L2 platform integration | command、watcher、VFS、Document、dispose | 是 | 各端竖切 |
| L3 UI smoke | 真实树、主题色、tooltip、对话框 | 是 | nightly/发布 |
| L4 packaged install | 用户拿到的 ZIP/VSIX 可运行 | 是 | 发布 |
| L5 cross-editor E2E | 两端同时操作不丢数据 | 两个 IDE | 发布 |

L0/L1 不能证明平台事件接对了，开发模式也不能证明发布包可用。

## 3. 固定 fixture

`test-fixtures/workspaces/smoke`：

```text
smoke/
├── .codebase-notes.json
├── .gitignore
├── README.md
└── src/
    ├── App.ts
    ├── payment/PaymentService.ts
    └── legacy/OldService.ts
```

fixture 不含嵌套配置和 TreeInfotip XML。测试不能直接改仓库样本；`npm run fixture:reset` 复制到系统临时目录并输出绝对路径。

## 4. 干净 clone 入口

目标命令：

```bash
./deploy.sh init
./deploy.sh test
```

`deploy.sh` 是两端统一入口；`scripts/verify-all.sh` 是兼容旧命令的薄封装。两者都不跳过失败。

## 5. L0：Schema 与共享契约

`npm --prefix src/vscode run verify:spec` 必须覆盖：

- Schema 自身符合 draft 2020-12。
- `spec/examples/*.json` 全部通过。
- invalid samples 对应预期 error code。
- fixture id 唯一，input/expected 结构合法。
- 已落地的 runner 不得静默跳过 fixture。

核心 fixture：

| 文件 | 重点 |
| --- | --- |
| `parse-config.json` | BOM、重复 key、尾逗号、safe integer、指数、future version |
| `note-text.json` | Unicode code point 长度与全空白拒绝 |
| `normalize-path.json` | 非法 segment、分隔符、根 key |
| `sort-keys.json` | ASCII、中文、组合字符、emoji、前缀 |
| `serialize-config.json` | 双端稳定字节输出、未知字段、负零 |
| `three-way-merge.json` | 不同 key 合并、同 key 冲突 |
| `move-directory.json` | 目录映射与目标冲突 |
| `relink-prefix.json` | 确定性前缀映射 |

超大整数的期望是 `CBN001_INVALID_CONFIG`，不再测试 number token 原样写回。

## 6. L1：Core unit tests

### 6.1 TypeScript

```bash
npm --prefix src/vscode run typecheck
./deploy.sh test vscode
```

使用临时目录、fake clock 和注入式 file store。阶段 1 先跑 TypeScript runner。

### 6.2 Kotlin

```bash
cd src/jetbrains
./gradlew test
```

阶段 2 加入 Kotlin runner。纯核心测试使用普通 JUnit 5，不启动 IDE fixture。

### 6.3 必测故障点

| 用例 | 预期 |
| --- | --- |
| 两进程编辑不同 key | 后提交者锁内重读，两条都保留 |
| 两进程编辑同一 key | `CBN003_WRITE_CONFLICT`，不写 |
| 活锁 owner | 超时返回 `CBN004_LOCKED`，不删锁 |
| stale lock | 仅确认 PID 失效或用户确认后删除 |
| Git 跟踪 lock（后续项） | 告警 `CBN008_LOCKFILE_TRACKED`，不自动执行 Git 命令 |
| 临时文件写失败 | 原配置字节不变 |
| atomic replace 失败 | 原配置字节不变，tmp 可清理 |
| 未知字段 | 修改 note 后语义值仍存在 |
| 超出 safe integer | 配置非法，不写回近似值 |
| `-0`/指数 | 允许规范化，重读后语义值一致 |
| `version: 2` | 只读，原字节不变 |
| 配置 symlink | `CBN007_UNSAFE_CONFIG`，不替换链接 |
| alias key | `CBN006_ALIAS_CONFLICT`，禁止写入 |
| 目录迁移冲突 | 整批不提交 |
| 前缀 Relink 中一个目标冲突 | 整批不提交 |

## 7. L2：VS Code Extension Host

```bash
npm --prefix src/vscode run compile
npm --prefix src/vscode run test:integration
```

使用 `@vscode/test-cli` 与 `@vscode/test-electron`。测试：

1. 激活扩展并确认 commands 注册。
2. edit/remove service 修改 root 配置。
3. decoration provider 返回 tooltip 和 ThemeColor，不显示额外 badge。
4. Annotated Files 返回 path、description 和 missing 状态。
5. `workspace.applyEdit` rename 后 key 迁移。
6. 外部修改配置后 snapshot 和 tree 刷新。
7. 配置 Document dirty 时写入被拒绝。
8. multi-root 分别读取各 root 配置，不发现子目录同名文件。
9. dispose 后文件变化不再触发 callback。

provider 返回 decoration 只属于 L2；Explorer 真实显示属于 L3。

## 8. L2：JetBrains 平台测试

### 8.1 Light/platform tests

```bash
cd src/jetbrains
./gradlew test
```

以下是发布前待补的平台测试；当前 `./gradlew test` 覆盖纯核心和共享 fixture，不启动 IDE：

- project service 创建与 dispose。
- `VirtualFile` 到 root/key。
- action 在无配置、future version、配置文件自身等状态下的可见性。
- decorator 对有/无 note 的 `PresentationData`。
- dirty Document 拒绝写入。
- VFS rename/move 到 move plan。
- case-insensitive root 使用目录项真实大小写。

### 8.2 Starter/Driver integration

```bash
cd src/jetbrains
./gradlew buildPlugin integrationTest
```

安装刚构建的 plugin distribution，验证加载、Project View、Edit/Remove、rename、外部配置刷新和 project dispose。失败时保留 IDE log、thread dump 和截图。Tool Window/Relink UI 不属于当前 MVP。

## 9. L3：视觉冒烟

### 9.1 JetBrains

```bash
cd src/jetbrains
./gradlew runIde --args="/absolute/path/to/temp-smoke"
```

检查：

- 备注在文件名尾部，不替换主文本。
- 中文、emoji、多行和长文本显示合理，全文可查看。
- Light/Darcula/高对比主题可读。
- Edit/Remove/Relink 的显示条件正确。
- case-only rename、Undo/Redo 后没有 alias。
- 关闭项目或禁用插件后不再写配置。

### 9.2 VS Code

从 `src/vscode` 按 F5 打开临时 fixture。检查：

- Explorer 有主题色和完整 tooltip，不显示额外 badge。
- Annotated Files 不复制整棵 Explorer。
- Search 只匹配 path/text。
- missing 与 Relink Prefix 预览清楚。
- multi-root 分组正确。
- Reload Window 后没有重复 watcher。

## 10. L4：发布包安装

### 10.1 JetBrains ZIP

```bash
cd src/jetbrains
./gradlew clean buildPlugin verifyPlugin
shasum -a 256 build/distributions/*.zip
```

使用干净 QA profile 从磁盘安装 ZIP，打开临时 fixture，跑 L3 关键路径并记录 IDE build 与插件版本。

### 10.2 VSIX

```bash
./deploy.sh package vscode
code --profile "Codebase Notes QA" \
  --install-extension artifacts/codebase-notes-*.vsix \
  --force
```

确认 commands、view、badge、rename 和 watcher；卸载并 Reload 后 view/menu 消失，配置不被修改。

## 11. L5：双端联调

IDEA 与 VS Code 使用 L4 产物，同时打开同一临时目录。每一步等待 watcher 完成，目标刷新延迟先定为本机 2 秒内。

| ID | 操作 | 预期 |
| --- | --- | --- |
| E2E-01 | 无配置打开 root | 不自动创建；首次 Edit 才询问 |
| E2E-02 | VS Code 新增中文备注 | IDEA 看到同一内容 |
| E2E-03 | IDEA 新增不同 key | VS Code 刷新，旧 note 不丢 |
| E2E-04 | 一端编辑，另一端删除不同 key | 锁内合并，两种意图都保留 |
| E2E-05 | 同时编辑同一 key | 后提交端显示冲突 |
| E2E-06 | 文件 rename 与目录 move | key 整批迁移 |
| E2E-07 | case-only rename | key 使用实际大小写，无 alias |
| E2E-08 | 终端 `git mv` 目录 | notes 变 missing；Relink Prefix 后整批恢复 |
| E2E-09 | future version / malformed JSON | 两端只读，原文件不被覆盖 |
| E2E-10 | 另一 IDE 有未保存配置 buffer | 插件不声称能合并其内存内容 |
| E2E-11 | lock/tmp 未被 ignore | 告警和修复说明明确 |
| E2E-12 | 禁用一个扩展 | 禁用端停止写；启用后从磁盘恢复 |

每步运行：

```bash
npm run verify:workspace -- /absolute/path/to/temp-smoke
```

检查严格 JSON、Schema、排序、LF、结尾换行、无 lock/tmp 残留和 note 状态。

## 12. Git 协作专项

在临时 Git 仓库创建两个分支：

1. 两分支分别新增不同 key，再 merge。允许 Git 自动合并或显式冲突；最终人工/自动结果必须通过 workspace 校验且两条 note 都在。
2. 两分支修改同一 key。若 Git 冲突，适配器必须只读且不覆盖冲突标记。
3. 不安装 `union` driver，确认文档没有暗示同 key 可自动安全合并。
4. 意外提交 lock 后新 clone，适配器提示 tracked lock，并能在用户清理后继续写入。

这里验证产品边界，不要求插件替用户执行 Git merge。

## 13. OS 与版本策略

为了快速验证：

- 开发竖切先在一台主力 macOS + 当前 IDE 版本跑 L0～L3。
- PR 用 Linux 跑 L0/L1 和能稳定运行的 L2。
- 发布前至少在 macOS、Windows 验证 atomic replace、case-only rename 和 lock recovery。
- JetBrains/VS Code 只声明实际跑过的最低与最高版本。

没有执行过的平台或版本不得写进发布文案。兼容矩阵后补可以，虚假兼容不可以。

## 14. 发布阻断条件

出现任一情况不得发布：

- 两端对共享 fixture 结果不一致。
- atomic write 故障会破坏原配置。
- 同 key 冲突被静默覆盖。
- rename/relink 丢失源 note。
- future version 或 invalid config 被写回。
- case-insensitive root 产生重复 alias。
- ZIP/VSIX 只能开发模式运行。
- dispose 后仍有 watcher 写入。
- 没有用发布包完成 L5。

## 15. 测试报告

在 `docs/platform/reports/` 新建：

```text
R<YYYYMMDD>_platform_codebase_notes_cross_editor_test.md
```

记录插件版本/commit、产物 SHA-256、OS/文件系统、JDK/Node、IDE build、case ID、失败与已知问题，结论为 `pass | conditional pass | fail`。日志和 artifact 不得包含完整 note text。
