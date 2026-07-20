# Codebase Notes for JetBrains IDEs

在 Project 视图里为文件或目录添加简短共享笔记，数据写入项目根目录的
`.codebase-notes.json`。右键目标路径即可编辑或删除；重命名和移动路径时，插件会迁移对应键。

默认快捷键：

- 编辑文字备注：`Option+R`（macOS）/ `Alt+R`（Windows）
- 设置备注样式：`Shift+Option+R`（macOS）/ `Shift+Alt+R`（Windows）

如果“设置备注样式”与 IDE 的“重新运行测试”等操作冲突，请在 Keymap 中搜索 `Codebase Notes` 或对应的 IDE 操作，删除或修改其中一个快捷键。

界面支持英文和简体中文，并跟随 JetBrains IDE 的显示语言。

## 代码地图样式

颜色用于代码导航，不表示错误或告警：

- 红色 `core`：核心，项目主干。
- 黄色 `focus`：关注，容易忽略的细节。
- 蓝色 `important`：重要，重要模块或工程入口。
- 绿色 `stable`：稳定，唯一事实来源或可靠基准。
- 紫色 `extension`：扩展，新增能力的接入位置。
- 灰色 `default`：普通职责说明。

记忆方式：红色看主干，黄色看细节，蓝色看重点，绿色找基准，紫色找扩展。

## Compatibility

- 最低支持 IntelliJ Platform 2025.3（build `253`）。
- 使用 IntelliJ IDEA 2025.3.4 SDK 编译，并以该版本作为向后兼容基线。
- 不设置 `until-build`；发布前需要用 Plugin Verifier 和真实安装冒烟验证更新版本。

## Build

```bash
./gradlew test
./gradlew buildPlugin
```
