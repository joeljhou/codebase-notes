# Codebase Notes 实现方案

> 状态：实现中（双端 MVP 已构建）
> 最后更新：2026-07-17
> 适用范围：v1 Monorepo、JetBrains Desktop、VS Code Desktop
> 关联文档：[协议规范](S20260717_platform_codebase_notes_protocol.md)、[集成测试方案](S20260717_platform_codebase_notes_integration_test_plan.md)、[设计评审](../reports/R20260717_platform_codebase_notes_design_review.md)

## 1. 目标与交付策略

v1 交付两个原生适配器：

- JetBrains：Kotlin，使用 Project View 原生扩展点。
- VS Code：TypeScript，使用 Explorer decoration 和 Annotated Files 视图。

两端共享 Schema、fixtures、错误码和 E2E，不共享运行时二进制。实现顺序不是“两端同时铺满”，而是：

1. TypeScript 做第一条可运行竖切，快速验证配置、写入和 VS Code UX。
2. fixtures 固定已验证行为。
3. Kotlin 按同一 fixtures 实现第二条竖切。
4. 最后补并发、路径恢复、打包和兼容矩阵。

开发期的单端竖切不能发布为 v1；它只是降低错误方案被复制两遍的成本。

### 1.1 为什么暂不共享运行时

共享 Wasm、native module、后台服务或跨语言桥接会新增构建、调试、打包、IDE 沙箱和 ABI 风险。当前纯逻辑很小，两个宿主的文件/事件 API 才是主要差异，因此 v1 先用原生实现。

以下任一情况出现时重新评估共享核心，而不是永远拒绝：

- 一个发布周期内出现 2 次由 Kotlin/TypeScript 行为分歧导致的缺陷。
- 计划增加第三个适配器。
- 两端纯核心长期超过约 2000 行且多数改动需要机械复制。

评估顺序是“能否生成共享测试/代码”优先于“直接引入运行时桥接”。

## 2. v1 范围收敛

为了尽快验证核心闭环，v1 明确不实现：

- 嵌套配置、最近祖先发现、shadowed 状态。
- 跨配置根双锁事务和 recovery。
- TreeInfotip XML 导入。
- tags 输入、校验和过滤。
- 自研 lossless JSON AST。
- 外部移动的文件名/hash 自动猜测。
- 自定义 Git merge driver。

首个可验证 MVP 进一步暂缓 JetBrains Tool Window/Relink UI、Git tracked-lock 提示和 alias 全盘诊断；先用 Project View + Edit/Remove + rename/move 验证双端主闭环。

每个 workspace/project root 只有一份配置。这个约束直接移除了后台递归扫描、配置所有权、双文件提交和一批恢复状态。

## 3. 工程结构

目标目录：

```text
codebase-notes/
├── src/
│   ├── jetbrains/
│   │   ├── build.gradle.kts
│   │   ├── settings.gradle.kts
│   │   ├── gradle.properties
│   │   ├── gradlew
│   │   ├── gradle/wrapper/
│   │   └── src/
│   │       ├── main/kotlin/
│   │       ├── main/resources/META-INF/plugin.xml
│   │       ├── test/kotlin/
│   │       └── integrationTest/kotlin/
│   └── vscode/
│       ├── package.json
│       ├── package-lock.json
│       ├── .nvmrc
│       ├── tsconfig.json
│       ├── .vscode-test.mjs
│       └── src/
│           ├── extension.ts
│           ├── core/
│           ├── platform/
│           └── test/
├── spec/
│   ├── codebase-notes.schema.json
│   ├── examples/
│   └── conformance/
├── test-fixtures/workspaces/smoke/
├── VERSION
├── deploy.sh
├── scripts/
│   ├── verify-config-contracts.mjs
│   └── verify-all.sh
├── docs/
├── .editorconfig
├── .gitignore
├── LICENSE
└── README.md
```

两端都是 `src/` 下的独立工程：JetBrains 使用自己的 Gradle Wrapper，VS Code 在自己的目录维护 `package.json`、lockfile 和 Node 版本。根目录不再伪装成 npm workspace；跨端动作统一由根目录的 `deploy.sh` 编排。

## 4. 技术基线与依赖

### 4.1 JetBrains

- JDK 21。
- Kotlin 与 IntelliJ Platform Gradle Plugin 使用锁定版本，不用动态版本。
- 第一条竖切只验证一个当前开发 build；发布前再确认最低 `sinceBuild` 和声明的最高 build。
- 只依赖实际使用的公开 platform module。

### 4.2 VS Code

- TypeScript strict mode。
- Node 版本用 `src/vscode/.nvmrc` 和 CI 固定。
- Desktop Node extension，`extensionKind: ["workspace"]`。
- 不依赖 proposed API，不操作 Explorer DOM。

### 4.3 JSON

- 使用成熟 JSON parser、JSON Schema validator 和普通 JSON tree。
- parser 或轻量 token validator 必须能报告重复 key。
- 两端把 number 归一为 IEEE-754 binary64；parse 后递归校验有限值，整数落在 JavaScript safe integer 范围。
- 未知字段保留语义值，不保留 number token。
- 禁止为了格式保真自研完整 parser/serializer AST。

第三方依赖必须锁版本并进入 license 清单。v1 不引入数据库、daemon、Wasm 或 native module。

## 5. 共享契约层

### 5.1 Schema

`spec/codebase-notes.schema.json` 负责结构约束；大小写、锁、并发写入和原子替换由运行时与 fixtures 覆盖。

发布前必须：

1. 用 JSON Schema 2020-12 meta-schema 校验自身。
2. examples 全部通过，invalid samples 命中预期错误。
3. Schema 副本打进 plugin ZIP 和 VSIX。

### 5.2 Fixture runner

```text
JSON fixture
  -> platform-neutral input DTO
  -> Kotlin/TypeScript operation
  -> normalized result DTO
  -> deep equality
```

fixture 禁止包含平台绝对路径。文件系统语义通过 `caseSensitive`、目录项大小写和事件序列显式输入。

TypeScript runner 是最早可执行参考，但不是“规范真相”；规范与 fixture 才是。若实现和 fixture 冲突，先判断协议是否合理，不能为了保住既有代码篡改期望。

### 5.3 核心边界

两端命名可以语言化，但职责保持一致：

```text
ConfigParser        bytes -> ParsedConfig | Diagnostic
RootPathPolicy      target URI + root -> note key
CaseResolver        target URI -> actual directory-entry casing
MergeEngine         base + disk + intent -> merged | conflict
MovePlanner         notes + rename/relink input -> transaction plan
StableSerializer    JSON tree -> stable UTF-8 bytes
ConfigWriter        plan + lock -> committed snapshot
SearchIndex         snapshot -> path/text results
```

这些类不依赖 UI。平台文件 API、时钟和随机数通过小接口注入。

## 6. JetBrains 适配器

### 6.1 组件

| 组件 | 职责 |
| --- | --- |
| `CodebaseNotesProjectService` | project 生命周期、root 快照和缓存入口 |
| `ConfigRepository` | 解析、锁、合并、稳定写入 |
| `ProjectViewNoteDecorator` | 只查内存并修改 presentation |
| `EditNoteAction` / `RemoveNoteAction` | 单 note 编辑和删除 |
| project service 内的 VFS listener | 收集同 root rename/move，调度后台计划 |

JetBrains Tool Window、搜索和 Relink UI 是下一轮体验项，不进入首个 MVP。VS Code 已有 Annotated Files/Search/Relink，是因为宿主 Explorer 无法直接显示完整尾注。

### 6.2 生命周期与线程

- project service 实现 `Disposable`，message bus 使用 `connect(service)`。
- decorator 只访问不可变 snapshot，禁止读磁盘。
- VFS callback 只提取事件，随后调度 background task。
- 原子替换使用后台 `java.nio.file`；提交后异步 refresh VFS。
- 配置写完后在 EDT 刷新 Project View。
- action `update()` 不解析 JSON。

### 6.3 大小写

在大小写不敏感文件系统上，生成新 key 前通过 VFS/目录枚举逐段取得真实目录项名称。不得用 `toLowerCase()` 作为持久化 key，也不得通过 realpath 穿透符号链接。

## 7. VS Code 适配器

### 7.1 package contributions

`package.json` 至少声明：

- `codebaseNotes.editNote`
- `codebaseNotes.removeNote`
- `codebaseNotes.relinkNote`
- `codebaseNotes.relinkPrefix`
- `codebaseNotes.searchNotes`
- `explorer/context` 单资源菜单
- Explorer 容器下 `codebaseNotes.annotatedFiles` view
- note/missing item context

v1 不依赖未文档化的 Explorer 多选参数。

### 7.2 组件

| 组件 | 职责 |
| --- | --- |
| `ExtensionController` | activate/deactivate 与 disposable 汇总 |
| `VscodeRootResolver` | workspace folder 与 note key |
| `ConfigRepository` | 协议解析、锁、合并和写入 |
| `NoteDecorationProvider` | `N` badge、tooltip、ThemeColor |
| `AnnotatedFilesProvider` | 当前 root notes 与 missing 状态 |
| `RenameTracker` | `onDidRenameFiles` 到 move plan |
| `ConfigWatcher` | root 配置 create/change/delete |
| `CommandHandlers` | 输入、确认、搜索和 Relink 预览 |

### 7.3 文件 API

v1 只对可映射为本地文件、支持 exclusive create 和 atomic replace 的 workspace 启用写入。锁与替换集中在 `AtomicFileStore`，禁止散落 Node `fs` 调用。

Virtual Workspace 和 Remote 进入 unsupported/read-only，不尝试非原子覆盖。

## 8. Root 快照与刷新

不做递归配置发现。每个 boundary root：

1. 只检查 root 下固定配置。
2. 配置存在则加载为 snapshot；不存在则保持 empty 状态。
3. watcher 只监听该文件的 create/change/delete。
4. multi-root 各自维护 snapshot。

Annotated Files 可按 workspace folder 分组，但不存在“尚未扫描的嵌套配置”状态。

## 9. 写入与 Git 辅助

`ConfigRepository` 组合 parser、merge、serializer 和 `AtomicFileStore`，统一返回：

```text
OperationResult
├── Committed(snapshot)
├── NoChange(snapshot)
├── Conflict(code, paths, diskValues, intendedValues)
└── Failed(code, userMessage, technicalCause?)
```

正常冲突不用异常表达。异常边界至少覆盖 parser、file store、watcher callback 和 command handler。

sentinel lock 是跨 JVM/Node 最小共同机制。后续 Git 辅助只做两件事：

- 创建配置时提示忽略 lock/tmp。
- Git 命令可用且发现 lock 被跟踪时告警并提供操作说明。

当前 MVP 尚未实现 tracked-lock 检测。Git 不可用不影响核心功能；插件不自动执行 `git rm --cached`，也不安装 merge driver。

## 10. 实施顺序

### 阶段 0：仓库可构建

状态：已完成。

- 初始化 Git、license、ignore、editorconfig。
- 创建 Gradle Wrapper、npm lockfile 和两个可激活的空壳。
- CI 编译空壳并保存 ZIP/VSIX。

完成标准：干净 clone 可构建。

### 阶段 1：VS Code 竖切

状态：已完成，含 5 个 Extension Host 集成 case。

- 完成 Schema、最小 fixtures 和 Node verifier。
- 实现 root config、标准 JSON 解析、路径、edit/remove、稳定写入。
- 实现 decoration、Annotated Files 和 watcher。

完成标准：在一个真实 workspace 中新增、编辑、删除备注，重载后结果一致。此阶段仅供开发验证，不发布。

### 阶段 2：JetBrains 竖切

状态：代码与打包已完成，真实 IDE 安装冒烟待做。

- 实现对应 core runner。
- 实现 Project View decorator、edit/remove 和 VFS rename/move。
- 两端跑同一批 parse/path/edit/serializer fixtures。

完成标准：两个 IDE 轮流编辑同一配置并自动刷新。

### 阶段 3：数据安全

状态：核心已完成；JetBrains 平台级 dirty Document 自动化仍待补。

- sentinel lock、锁内重读、三方合并。
- fault-injected atomic write。
- malformed/future version/dirty Document/symlink。

完成标准：并发不同 key 不丢，同 key 不静默覆盖，写失败保留原文件。

### 阶段 4：路径生命周期

状态：rename/move 与 VS Code Relink Prefix 已完成；alias 全盘诊断和 JetBrains Relink UI 暂缓。

- 文件/目录 rename。
- 实际大小写解析、case-only rename、alias 诊断。
- missing、单条 Relink、批量前缀 Relink。
- Git branch merge 与外部 `git mv` 场景。

完成标准：常见路径变化可恢复且不靠猜测。

### 阶段 5：发布

状态：VSIX/ZIP 可生成，安装冒烟、Plugin Verifier 和兼容矩阵待做。

- 性能和 dispose 测试。
- Plugin Verifier 与 VS Code 最低版本测试。
- 从 ZIP/VSIX 安装，完成双端 E2E。
- 只声明实际跑过的 OS/IDE 版本。

完成标准：发布报告包含版本、产物 SHA-256、平台和 case ID。

## 11. PR 门槛

早期 PR 只跑已经存在的层级，不能让“未来完整矩阵”阻塞第一条竖切。对应模块落地后，门槛升级为：

```text
Schema/examples validation
Root fixture verifier
Changed adapter unit tests
Changed platform integration tests
Formatting/lint/typecheck
```

涉及 Schema、path、merge、move 或 serializer 的 PR 必须添加共享 fixture；从阶段 2 起两端 runner 都必须通过。

## 12. 发布物

- `codebase-notes-jetbrains-<version>.zip`
- `codebase-notes-vscode-<version>.vsix`
- `codebase-notes.schema.v1.json`
- checksums
- changelog
- 双端集成测试报告
- 第三方 license 清单

Marketplace 不是正确性的前置条件。先保证本地打包安装和数据契约，再做商店发布。
