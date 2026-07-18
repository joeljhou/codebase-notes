# Codebase Notes

> Shared, Git-versioned notes for your codebase structure — across VS Code, TRAE, and JetBrains IDEs.

把“这个目录为什么存在”“这个文件能不能改”“这里有什么风险”直接写在项目树旁边，而不是散落在聊天记录、个人笔记和过期文档里。

Codebase Notes 为文件和目录添加共享备注，统一保存在仓库根目录的 `.codebase-notes.json`。团队成员拉取代码后即可看到同一份上下文；使用 JetBrains IDE 的同事也能直接读取和编辑。

![Codebase Notes in VS Code and TRAE](https://raw.githubusercontent.com/joeljhou/codebase-notes/main/docs/assets/trae-codebase-notes.png)

## 适合解决什么问题

| 场景 | 备注示例 |
| --- | --- |
| 新成员熟悉项目 | `订单领域入口，只负责流程编排` |
| 标记架构边界 | `公共协议，修改时必须同步双端实现` |
| 提醒生成物 | `构建产物，不要手动修改` |
| 记录迁移状态 | `旧认证模块，完成迁移后删除` |
| 说明关键脚本 | `发布前唯一的全量验证入口` |

## 核心能力

### 备注就在代码结构旁

右键任意文件或目录即可编辑、设置样式或清除备注。完整内容显示在原生“代码备注”资源树中，不修改系统资源管理器原本的 Git 和主题颜色。

### 五种语义样式

`default`、`info`、`success`、`warning`、`danger` 覆盖普通说明、重要信息、已确认事项、风险和禁止操作。使用上下键切换时，项目树会实时预览颜色。

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
      "text": "应用入口，只负责装配",
      "style": "info"
    },
    "artifacts": {
      "text": "构建产物，不要手动修改",
      "style": "danger"
    }
  }
}
```

建议将 `.codebase-notes.json` 提交到 Git。锁文件和临时文件默认不会作为主数据使用：

```gitignore
.codebase-notes.json.lock
.codebase-notes.json.tmp.*
```

## 常用操作

| 操作 | 入口 |
| --- | --- |
| 编辑备注 | 文件/目录右键 → 代码备注 → 编辑文字备注 |
| 设置样式 | 文件/目录右键 → 代码备注 → 设置备注样式 |
| 搜索备注 | “代码备注”视图标题栏 → 搜索 |
| 返回系统资源管理器 | “代码备注”视图标题栏 → 在资源管理器中显示 |
| 定位到代码备注 | 系统资源管理器右键 → 代码备注 → 在代码备注中显示 |
| 自定义快捷键 | Keyboard Shortcuts 中搜索 `Codebase Notes` |

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
