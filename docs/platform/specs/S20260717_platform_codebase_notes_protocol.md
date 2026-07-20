# Codebase Notes v1 协议规范

> 状态：实现中（核心契约已落地）
> 最后更新：2026-07-20
> 适用范围：本地文件系统上的 JetBrains 与 VS Code Desktop 适配器
> 关联文档：[实现方案](S20260717_platform_codebase_notes_implementation.md)、[集成测试方案](S20260717_platform_codebase_notes_integration_test_plan.md)、[设计评审](../reports/R20260717_platform_codebase_notes_design_review.md)

本文只定义 v1 为了“两种 IDE 共用一份备注”必须一致的行为。文中“必须/禁止”需要 conformance fixture；平台 UI 细节不进入协议。

## 1. 范围与术语

- **配置文件**：边界根下固定的 `.codebase-notes.json`。
- **边界根**：VS Code workspace folder，或 JetBrains project base directory；没有本地 base directory 的项目只读且不受支持。
- **note key**：相对边界根的规范路径；`.` 代表边界根自身。
- **touched paths**：一次操作明确读取或修改的 note key 集合。

v1 的约束刻意保持简单：

- 每个边界根最多一份配置，只读取根目录下的 `.codebase-notes.json`。
- 不发现、不合并嵌套配置。
- VS Code multi-root 中每个 workspace folder 独立。
- 不自动迁移跨边界根移动的备注。
- 只支持普通本地文件和目录。Remote、Virtual Workspace、Web Extension 与非本地 JetBrains VFS 在单独验证前不得标为支持。

## 2. 配置格式

最小文件：

```json
{
  "version": 1,
  "notes": {}
}
```

完整示例：

```json
{
  "$schema": "./spec/codebase-notes.schema.json",
  "version": 1,
  "notes": {
    ".": {
      "text": "支付服务主干",
      "style": "core"
    },
    "src/payment/PaymentService.kt": {
      "text": "支付核心链路",
      "style": "core"
    }
  }
}
```

### 2.1 字段

| 字段 | 要求 |
| --- | --- |
| `$schema` | 可选，只用于编辑器提示；插件校验使用内置 Schema |
| `version` | 必填，v1 固定为整数 `1` |
| `notes` | 必填，key 为规范路径，value 为 note |
| `note.text` | 必填，1～2000 个 Unicode code point 且至少含一个非空白字符 |
| `note.style` | 可选：`default`、`important`、`focus`、`core`、`stable`、`extension` |

`style` 是代码地图语义，不表示错误、警告或运行状态：

| 值 | 颜色 | 心智 |
| --- | --- | --- |
| `default` | 灰色 | 普通职责说明 |
| `important` | 蓝色 | 重要模块或工程入口 |
| `focus` | 黄色 | 容易忽略的关系、约束或细节 |
| `core` | 红色 | 项目主干，应该优先掌握 |
| `stable` | 绿色 | 唯一事实来源或可靠基准 |
| `extension` | 紫色 | 新增能力的接入位置 |

`tags` 不属于 v1 公共模型。v1 搜索只消费 path 和 text；需要标签时再通过小版本正式加入。

未知顶层字段和 note 字段允许存在。适配器写回时必须保留其 JSON 语义值；number 统一按 IEEE-754 binary64 解释，不保证原字面量。需要精确保存的大整数、十进制数或标识符必须使用字符串。

### 2.2 JSON 解析

- 编码必须是 UTF-8；允许读取 UTF-8 BOM，写回时移除 BOM。
- 使用成熟 JSON parser 和 JSON tree，不自研 lossless AST。
- 输入必须是严格 JSON，不接受注释、尾逗号、`NaN` 或 `Infinity`。
- 重复 object key 会静默覆盖 note，仍必须通过解析器能力或独立的轻量校验通道拒绝；不为此实现完整 JSON parser。
- 两端把所有 number 归一为 IEEE-754 binary64。值必须有限；归一后为整数的值必须落在 JavaScript safe integer 范围 `[-9007199254740991, 9007199254740991]`。超出范围时报告非法配置，调用方应改用字符串。
- `-0`、指数写法和小数的字面形式允许在写回后规范化，只保证 JSON 数值语义。
- 解析失败时保留磁盘原文，不自动修复或覆盖。

### 2.3 两阶段版本判断

加载顺序固定：

1. 解析 JSON object，只检查 `version`。
2. `version === 1`：用 v1 Schema 和运行时规则完整校验。
3. `version > 1`：进入只读模式并显示版本诊断，不假设未来 `notes` 仍符合 v1，也不展示或迁移其内容。
4. `version` 缺失、不是整数或小于 1：报告损坏，禁止写入。

高版本判断不能先经过 `version: { "const": 1 }` 的 v1 Schema。

## 3. 路径规范

### 3.1 生成规则

适配器必须通过平台 URI/path API 计算相对路径，不能用字符串截断绝对路径。

1. 目标等于边界根时 key 为 `.`。
2. 其他目标取相对路径，各 segment 以 `/` 连接。
3. 保留文件系统目录项的大小写和 Unicode 序列，不统一小写，也不做 NFC/NFD 转换。
4. 在大小写不敏感文件系统上，为已有目标创建或迁移 key 前，必须按目录项逐段取得实际大小写；禁止直接相信调用方传入的字符串大小写。
5. 获取实际大小写不能解析到符号链接真实目标。符号链接按项目树中可见的链接路径记 key。

不存在的旧路径无法查询实际大小写时保留配置中的 key；Relink 的新目标必须存在并使用实际大小写。

### 3.2 非根 key 的硬约束

以下路径全部非法：

```text
                         # 空字符串
/src/App.kt              # POSIX 绝对路径
C:/repo/App.kt           # Windows 盘符绝对路径
src\App.kt               # 反斜杠
src//App.kt              # 空 segment
src/                     # 尾部斜杠
./src/App.kt             # . segment
src/../App.kt            # .. segment
.codebase-notes.json     # 配置文件自身
pkg/.codebase-notes.json # 任意嵌套配置文件
```

控制字符 U+0000～U+001F 和 U+007F 也禁止出现在 key 中。`.` 是唯一合法的单点路径。

### 3.3 路径相等与排序

- 相等判断遵守边界根所在文件系统的大小写语义。
- case-only rename 仍必须更新 key 的显示形式。
- 不根据文件系统语义合并 Unicode。
- 如果已有配置中的两个 key 指向文件系统同一路径，报告 `CBN006_ALIAS_CONFLICT` 并禁止写入，直到用户人工消除歧义。
- 输出排序按 Unicode scalar value 逐个比较；前缀相同时短 key 在前，禁止 locale collation。

conformance tests 必须以 `caseSensitive: true|false` 和虚拟目录项大小写显式运行，不依赖 CI 主机文件系统。

## 4. 配置位置

配置只存在于边界根：

```text
workspace-root/
├── .codebase-notes.json
└── ...
```

- 展示和扫描不能自动创建配置。
- 用户首次执行写命令时才询问是否在边界根创建。
- 子目录中的同名文件不属于 v1 配置，适配器不发现、不监听、不合并。
- 配置 create/delete/rename 后，只需刷新对应边界根，无需递归扫描仓库。

这个限制有意推迟 monorepo 分区配置。先证明单文件、双编辑器、并发写入和路径生命周期可靠，再决定是否引入所有权与跨配置事务。

## 5. 读取模型与状态

每个边界根最多维护一个快照：

```text
ConfigSnapshot
├── uri
├── rawDigest
├── parsedRoot
├── versionMode        # writable-v1 | readonly-future | invalid
├── notesByExactKey
├── filesystemCaseMode
└── diagnostics
```

状态码在两端保持同名，UI 文案可以平台化：

| 代码 | 含义 |
| --- | --- |
| `CBN001_INVALID_CONFIG` | JSON、Schema 或运行时规则非法 |
| `CBN002_FUTURE_VERSION` | 高版本只读 |
| `CBN003_WRITE_CONFLICT` | touched path 三方合并冲突 |
| `CBN004_LOCKED` | 其他进程持有锁 |
| `CBN005_MISSING` | key 对应路径不存在 |
| `CBN006_ALIAS_CONFLICT` | 多个 key 指向文件系统同一路径 |
| `CBN007_UNSAFE_CONFIG` | 配置是 symlink 或存储不支持安全替换 |
| `CBN008_LOCKFILE_TRACKED` | 锁文件被 Git 跟踪或未忽略 |

## 6. 写入协议

### 6.1 前置条件

写入前必须满足：

- 配置是合法 v1。
- 当前边界根允许写入。
- `.codebase-notes.json` 没有未保存的本端编辑器 Document。
- 配置不是符号链接，底层存储支持 exclusive create 与原子替换。
- 操作明确给出 base snapshot、touched paths 和 intended values。

删除 note 用 intended value `absent` 表示，不能用空 text 模拟。

### 6.2 跨进程锁

Node 与 JVM 没有简单、可移植且语义一致的 OS advisory lock。v1 保留同目录 sentinel lock：

```text
.codebase-notes.json.lock
```

使用 exclusive create（JVM `CREATE_NEW`、Node `open(..., "wx")`）获取。内容至少包括随机 token、PID、hostname 和创建时间：

1. 最多重试 2 秒，使用短随机退避。
2. 正常持锁操作目标小于 1 秒；锁存在超过 30 秒视为可疑，不自动删除。
3. 只有能确认同主机 PID 已不存在，或用户明确确认时，才移除 stale lock。
4. `finally` 中只删除 token 与自己一致的锁。

仓库应忽略该文件：

```gitignore
.codebase-notes.json.lock
.codebase-notes.json.tmp.*
```

创建配置时适配器应提示该规则。检测到锁文件被 Git 跟踪时报告 `CBN008_LOCKFILE_TRACKED` 并引导用户移除跟踪；Git 检测不可用时不阻断正常写入。插件退出清理只是兜底，不能代替 token 校验和 stale-lock 恢复。

### 6.3 锁内三方合并

获取锁后重新读取磁盘快照 `D`，命令开始时快照为 `B`，用户意图为 `I`。对每个 touched path：

| 条件 | 结果 |
| --- | --- |
| `D == B` | 应用 `I` |
| `I == B` | 保留 `D` |
| `D == I` | 保留 `D`，视为已完成 |
| 其他 | `CBN003_WRITE_CONFLICT`，整次操作不写入 |

未 touched 的 note 一律取 `D`。未知字段以磁盘最新值为基础；用户明确编辑完整 note object 时除外。

冲突 UI 提供“保留磁盘”“应用我的版本”“编辑后重试”。用户选择必须产生新操作和新 base，不能绕过锁直接写。

### 6.4 稳定序列化

写回必须满足：

- UTF-8 无 BOM、LF、2 空格缩进、文件结尾一个换行。
- 根字段顺序：`$schema`（若有）、`version`、`notes`、其他字段。
- note 字段顺序：`text`、`style`、其他字段。
- `notes` 和其他 object key 用 3.3 的 comparator 排序；array 顺序保持不变。
- 未知字段保留 JSON 语义值；number 可以规范化，不保留原 token。

### 6.5 原子替换

序列化后：

1. 在同目录 exclusive create `.codebase-notes.json.tmp.<token>`。
2. 写完并 flush/fsync 临时文件。
3. 平台允许时 best-effort fsync 目录。
4. 用 atomic move + replace 替换目标；不支持时中止，禁止“先删后写”。
5. 已有配置的普通权限位应用到临时文件；无法安全处理时替换前中止。
6. 清理临时文件，更新快照和 digest，再释放锁。

watcher 收到自身写入事件时通过 digest 合并刷新，不能触发重复写入。

## 7. Git 协作边界

`.codebase-notes.json` 可以提交到 Git，但“可提交”不等于“永不冲突”：

- 稳定排序和一条 note 一个 object 会降低不同 key 修改的 diff 噪声。
- 不同 key 的分支修改通常可由 Git 自动合并，但不作协议保证。
- 同一 key 被多人修改时必须人工选择或合并。
- 冲突标记会让 JSON 非法；适配器进入 `CBN001_INVALID_CONFIG`，绝不覆盖文件。
- 解决冲突后运行 workspace 校验，再提交。

v1 不提供 `union` merge driver。文本 union 可能制造重复 key 或非法 JSON，比显式冲突更危险。以后只有在 object-aware merge driver 有真实需求和测试样本时再引入。

## 8. 编辑、搜索和展示

- 新增与编辑共用一个命令；输入框初值为现有 text。
- 用户取消不写文件；纯空白输入报校验错误。
- 删除仅在 note 存在时出现，执行后删除整个 note object。
- 单次编辑只处理一个路径；批量前缀 Relink 是路径恢复操作，不是批量改正文。
- 搜索域固定为 note key 和 `text`，使用不区分大小写的子串匹配；结果按规范 key 排序。
- 完整 `text` 保存在配置中；树上把换行折叠为空格并按平台截断，tooltip/详情视图展示全文。
- `style` 是语义提示，不保证两个 IDE 的 RGB 相同。

JetBrains 使用 Project View location string。VS Code Explorer 使用主题色和 tooltip，不显示额外 badge；Annotated Files 视图使用 `TreeItem.description` 展示摘要。

## 9. Rename、Move 与 Relink

### 9.1 IDE 内同一边界根移动

文件迁移把 `notes[old]` 迁到 `notes[new]`。目录迁移匹配：

```text
key == oldPrefix || key.startsWith(oldPrefix + "/")
```

先计算完整计划，再一次提交。任一目标冲突则整批不写。一个事件批次需覆盖链式 rename 和 case-only rename。

### 9.2 IDE 外部移动

终端 `mv`、Finder 或 Git checkout 可能只产生 delete/create。v1 不按文件名、内容 hash 或时间窗口自动猜测：

- 保留原 key 并标记 `CBN005_MISSING`。
- 单条 `Relink Note` 让用户选择同一边界根内的新路径。
- `Relink Prefix` 让用户选择一个 missing 旧前缀和一个已存在的新目录，按相对后缀批量生成迁移计划。
- 批量 Relink 必须先预览；任一目标不存在或冲突则整批不写。

这覆盖 `git mv old-dir new-dir` 的常见恢复场景，同时避免基于相似度的误配。

### 9.3 跨边界根移动

v1 不自动修改两份配置，也不提供跨根事务。源 note 保持 missing；用户在目标根新增 note，确认后删除源 note。需要跨根原子迁移的真实案例出现后再设计。

## 10. 性能与生命周期

- 解析、hash、迁移计划和磁盘写入不能在 UI thread/EDT 执行。
- JetBrains VFS listener 只收集事件并调度后台任务。
- watcher 只监听边界根配置文件，不递归扫描仓库。
- workspace/project roots 变化时重建对应快照。
- watcher、event emitter、message bus connection 和 Tree View 必须在 dispose 时释放。

建议基线：1 万条 notes 的解析与索引不阻塞 UI；精确阈值在基准测试有数据后再定，不提前把猜测写成发布门槛。

## 11. 隐私与安全

- v1 不上传备注，不包含 telemetry。
- 日志不得输出完整 note text；默认只记录配置 URI、key、状态码和摘要。
- 配置文本按不可信输入处理，不解释 Markdown/HTML，不执行命令 URI。
- 路径校验先于任何写入。

## 12. 必备 conformance fixtures

```text
spec/conformance/
├── parse-config.json
├── normalize-path.json
├── resolve-path-case.json
├── sort-keys.json
├── edit-note.json
├── three-way-merge.json
├── move-file.json
├── move-directory.json
├── relink-prefix.json
├── forward-compatibility.json
└── unknown-fields.json
```

每个 fixture 有稳定 `id`、输入、文件系统 case mode、期望输出或 error code。两端 runner 必须逐个报告 fixture id。

`parse-config.json` 至少包含 duplicate key、BOM、尾逗号、超出 safe integer、指数、负零和 future version。超出 safe integer 的期望是拒绝，不再要求两端实现 lossless number token。
