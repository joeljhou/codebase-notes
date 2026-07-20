# Codebase Notes

> Shared, Git-versioned notes for your codebase structure — across VS Code, TRAE, and JetBrains IDEs.

把“这个目录为什么存在”“哪里是项目主干”“新增能力从哪里接入”直接写在项目树旁边，而不是散落在聊天记录、个人笔记和过期文档里。

Codebase Notes 为文件和目录添加共享备注，统一保存在仓库根目录的 `.codebase-notes.json`。团队成员拉取代码后即可看到同一份上下文；使用 JetBrains IDE 的同事也能直接读取和编辑。

![Codebase Notes in VS Code and TRAE](https://raw.githubusercontent.com/joeljhou/codebase-notes/main/docs/assets/trae-codebase-notes.png)

## 适合解决什么问题

| 场景 | 备注示例 |
| --- | --- |
| 新成员熟悉项目 | `订单核心链路` |
| 标记架构边界 | `公共 API 边界` |
| 提醒生成物 | `由 OpenAPI 自动生成` |
| 标记稳定基准 | `版本唯一源` |
| 标记扩展位置 | `新增 Handler 注册` |

## 核心能力

### 备注就在代码结构旁

右键任意文件或目录即可编辑、设置样式或清除备注。完整内容显示在原生“代码备注”资源树中，不修改系统资源管理器原本的 Git 和主题颜色。

### 六种代码地图样式

`default`、`important`、`focus`、`core`、`stable`、`extension` 分别对应普通、重要、关注、核心、稳定和扩展。颜色用于代码导航，不表示错误或告警：红色看主干，黄色看细节，蓝色看重点，绿色找基准，紫色找扩展。使用上下键切换时，项目树会实时预览颜色。

| 样式 | 心智 |
| --- | --- |
| 红色 `core` | 项目主干，优先掌握 |
| 黄色 `focus` | 容易忽略，建议看一眼 |
| 蓝色 `important` | 重要模块或工程入口 |
| 绿色 `stable` | 已确认，可以依赖 |
| 紫色 `extension` | 新增能力从这里接入 |
| 灰色 `default` | 一般职责说明 |

### VS Code 与 JetBrains 共享

两个插件读取同一份 `.codebase-notes.json`，无需导出、同步服务或专用数据库。备注可以跟随分支、代码审查和版本发布一起演进。

![Codebase Notes in IntelliJ IDEA](https://raw.githubusercontent.com/joeljhou/codebase-notes/main/docs/assets/idea-codebase-notes.png)

### 保留原生工作流

- 使用 VS Code 原生 TreeView、右键菜单和键盘操作
- 在系统资源管理器与“代码备注”之间双向定位
- 搜索路径和备注正文
- 文件或目录重命名时同步迁移备注路径
- 丢失路径可重新关联
- 支持 multi-root workspace

## 三步开始

1. 安装扩展并打开一个项目。
2. 在系统资源管理器中右键文件或目录，选择 `Codebase Notes / 代码备注` → `Edit Text Note / 编辑文字备注`。
3. 在资源管理器下方展开 `Codebase Notes / 代码备注` 视图，查看、搜索和管理全部备注。

第一次保存时会自动创建：

```json
{
  "version": 1,
  "notes": {
    "src/App.ts": {
      "text": "前端主入口",
      "style": "core"
    },
    "artifacts": {
      "text": "构建产物，勿手改",
      "style": "focus"
    }
  }
}
```

建议将 `.codebase-notes.json` 提交到 Git。锁文件和临时文件默认不会作为主数据使用：

```gitignore
.codebase-notes.json.lock
.codebase-notes.json.tmp.*
```

让 AI 初始化项目备注时，可直接使用仓库中的[中文初始化规范](https://github.com/joeljhou/codebase-notes/blob/main/docs/platform/specs/S20260720_platform_ai_initialization.md)。

## 常用操作

| 操作 | 入口 |
| --- | --- |
| 编辑备注 | `Option+R`（macOS）/ `Alt+R`（Windows），或文件/目录右键 → 代码备注 → 编辑文字备注 |
| 设置样式 | `Shift+Option+R`（macOS）/ `Shift+Alt+R`（Windows），或文件/目录右键 → 代码备注 → 设置备注样式 |
| 搜索备注 | “代码备注”视图标题栏 → 搜索 |
| 返回系统资源管理器 | “代码备注”视图标题栏 → 在资源管理器中显示 |
| 定位到代码备注 | 系统资源管理器右键 → 代码备注 → 在代码备注中显示 |
| 自定义快捷键 | 默认快捷键可在 Keyboard Shortcuts 中搜索 `Codebase Notes` 后覆盖 |

## 数据与兼容性

- 数据只保存在工作区，不依赖云端服务。
- 写入采用临时文件、锁和冲突检测，避免两个 IDE 同时修改时静默覆盖。
- 配置协议通过 JSON Schema 和跨语言 fixture 同时约束 TypeScript 与 Kotlin 实现。
- 支持英文和简体中文，自动跟随 VS Code 显示语言。
- 需要 VS Code `1.107.0` 或更高版本。

## JetBrains 插件

JetBrains 安装包、双端源码和协议文档位于同一个开源仓库：

- [下载 JetBrains 插件](https://github.com/joeljhou/codebase-notes/releases/latest)
- [查看源码与二次开发指南](https://github.com/joeljhou/codebase-notes)
- [报告问题或提出建议](https://github.com/joeljhou/codebase-notes/issues)

## License

[MIT](https://github.com/joeljhou/codebase-notes/blob/main/LICENSE)
