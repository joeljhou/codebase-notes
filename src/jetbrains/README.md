# Codebase Notes for JetBrains IDEs

在 Project 视图里为文件或目录添加简短共享笔记，数据写入项目根目录的
`.codebase-notes.json`。右键目标路径即可编辑或删除；重命名和移动路径时，插件会迁移对应键。

界面支持英文和简体中文，并跟随 JetBrains IDE 的显示语言。

## Compatibility

- 最低支持 IntelliJ Platform 2025.3（build `253`）。
- 使用 IntelliJ IDEA 2025.3.4 SDK 编译，并以该版本作为向后兼容基线。
- 不设置 `until-build`；发布前需要用 Plugin Verifier 和真实安装冒烟验证更新版本。

## Build

```bash
./gradlew test
./gradlew buildPlugin
```
