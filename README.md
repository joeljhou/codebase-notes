# Codebase Notes

Codebase Notes 给仓库里的文件和目录添加共享备注。VS Code 和 JetBrains IDE 读取同一份 `.codebase-notes.json`，所以团队不会因为换编辑器丢掉上下文。

插件界面支持英文和简体中文，会自动跟随 IDE 的显示语言；英文是默认回退语言。VS Code 切换显示语言后需要 Reload Window，JetBrains IDE 切换语言后按宿主提示重启。

这份 README 面向拿到仓库、准备开始面试开发任务的开发者。照着走完，你会得到：

- 一套可测试、可构建的本地源码；
- 可安装的 VS Code VSIX 和 JetBrains ZIP；
- 一次在日常 VS Code 与 IntelliJ IDEA 中完成的手动安装和双端联调。

## 下载

当前版本：`0.1.4`

- [JetBrains 插件（ZIP）](https://github.com/joeljhou/codebase-notes/releases/download/v0.1.4/codebase-notes-jetbrains-0.1.4.zip)
- [VS Code / TRAE CN 扩展（VSIX）](https://github.com/joeljhou/codebase-notes/releases/download/v0.1.4/codebase-notes-vscode-0.1.4.vsix)

历史版本和更新说明见 [GitHub Releases](https://github.com/joeljhou/codebase-notes/releases)。

## 效果预览

### IntelliJ IDEA

Project 视图直接在文件和目录后显示备注摘要；同一套公共脚本可以完成双端构建与打包。

![IntelliJ IDEA 中的 Codebase Notes 备注效果](docs/assets/idea-codebase-notes.png)

### TRAE CN

VS Code 扩展可以在 TRAE CN 中运行，“备注资源管理器”按项目结构展示共享备注和强调项。

![TRAE CN 中的 Codebase Notes 备注资源管理器](docs/assets/trae-codebase-notes.png)

## 1. 准备环境

| 工具 | 要求 | 用途 |
| --- | --- | --- |
| Git | 近期版本 | 克隆代码 |
| Node.js | 22，VS Code 工程以 `src/vscode/.nvmrc` 为准 | VS Code 插件、Schema 校验 |
| npm | 随 Node.js 安装 | 安装前端依赖、执行脚本 |
| JDK | 21 | 编译 JetBrains 插件 |
| VS Code | 1.107.0 或更新版本 | 调试、安装 VSIX |
| IntelliJ IDEA | 2025.3 或更新版本，build 253+ | 安装 JetBrains 插件 |

先确认关键版本：

```bash
node --version
npm --version
java -version
```

如果使用 `nvm`，进入 `src/vscode` 目录后执行 `nvm use` 即可切到项目要求的 Node.js 版本。

后面的 VS Code 命令使用 `code` CLI。若 macOS 提示 `code: command not found`，在 VS Code 中打开命令面板，执行 `Shell Command: Install 'code' command in PATH`。

## 2. 克隆并初始化

克隆 GitHub 上的公开仓库：

```bash
git clone https://github.com/joeljhou/codebase-notes.git
cd codebase-notes
cd src/vscode
nvm use       # 没有使用 nvm 可跳过
cd ../..
./deploy.sh init
```

首次运行 Gradle 时会下载 Gradle、IntelliJ Platform SDK 和 Maven 依赖，因此 JetBrains 侧第一次构建会明显更久。

先跑两端最小测试，确认环境没有问题：

```bash
./deploy.sh test
```

Windows PowerShell 请把 `./gradlew` 换成 `./gradlew.bat`。

兼容旧命令的薄封装也会执行相同检查：

```bash
bash scripts/verify-all.sh
```

成功标志是 npm 测试没有失败，并且 Gradle 最后输出 `BUILD SUCCESSFUL`。

## 3. 打包、手动安装并测试 VS Code 插件

从仓库根目录一次生成两端安装包：

```bash
./deploy.sh package
```

VSIX 和 JetBrains ZIP 会统一汇总到 `artifacts/`。VS Code 产物名为：

```text
artifacts/codebase-notes-vscode-<版本号>.vsix
```

不要用命令行安装，本轮直接走用户真实会用到的手动安装流程：

1. 打开 VS Code 的 Extensions 视图。
2. 点击视图右上角的 `...`。
3. 选择 `Install from VSIX...`。
4. 选择 `artifacts/codebase-notes-vscode-<版本号>.vsix`。
5. 安装完成后，点击提示中的 Reload，或执行 `Developer: Reload Window`。

如果之前装过旧版本，请先在 Extensions 中卸载旧版并 Reload，再安装新 VSIX，避免误测缓存中的版本。

打开一个单独的测试项目，然后做一次 VS Code 单端冒烟：

1. 在 Explorer 中右键一个文件或目录。
2. 选择 `代码备注` → `编辑文字备注`，输入任意文字。
3. 确认项目根目录生成了 `.codebase-notes.json`。
4. 确认 Explorer 出现备注 badge/tooltip。
5. 确认 Explorer 下方的 `Annotated Files` 能看到完整备注。
6. 再次右键该路径并清除备注，确认配置和视图同步更新。

## 4. 打包、手动安装并测试 IDEA 插件

只构建 JetBrains 安装包时执行：

```bash
./deploy.sh package jetbrains
```

产物位于：

```text
artifacts/codebase-notes-jetbrains-<版本号>.zip
```

安装步骤：

1. 打开 IntelliJ IDEA 的 `Settings/Preferences` → `Plugins`。
2. 点击齿轮图标，选择 `Install Plugin from Disk...`。
3. 选择刚生成的 ZIP；不要先解压。
4. 按提示重启 IDEA。

如果 IDEA 报插件不兼容，先在 `Help` → `About` 确认 IDE build 是 253 或更新版本。

打开刚才的同一个测试项目，然后做一次 IDEA 单端冒烟：

1. 在 Project 视图中右键一个文件或目录。
2. 选择 `代码备注` → `编辑文字备注`。
3. 确认备注显示在文件名后面。
4. 确认项目根目录的 `.codebase-notes.json` 被更新。
5. 清除备注，确认 Project 视图和配置同步更新。

## 5. 用同一个项目验证双端同步

分别在 VS Code 和 IDEA 中打开同一个测试项目：

1. 在 VS Code 给 `src/App.ts` 添加备注。
2. 等待文件监听刷新，确认 IDEA 的 Project 视图出现相同备注。
3. 在 IDEA 修改备注，确认 VS Code 的 `Annotated Files` 同步更新。
4. 打开项目根目录的 `.codebase-notes.json`，确认两端修改的是同一份数据。

配置格式如下：

```json
{
  "version": 1,
  "notes": {
    "src/App.ts": {
      "text": "应用入口，只做装配",
      "style": "info"
    }
  }
}
```

`text` 是必填的备注正文，长度为 1～2000 个字符。`style` 是可选的视觉强调；在文件或目录上右键并选择“设置备注样式”，弹窗会提供以下五种选择。使用上下键切换时可在项目树中实时预览，按 Enter 保存，按 Esc 取消并恢复原样：

| style | 用途 |
|---|---|
| `default` | 普通说明，显示为偏灰色；写入时省略该字段 |
| `info` | 需要关注的信息，显示为蓝色 |
| `success` | 已确认、稳定或已完成，显示为绿色 |
| `warning` | 风险或待处理事项，显示为黄色 |
| `danger` | 高风险、禁止修改或严重问题，显示为红色 |

旧配置中的 `muted` 仍可读取并显示为灰色，但新菜单不再提供该选项。这样既保持兼容，也避免继续增加含义模糊的样式。

VS Code / TRAE CN 会注册 `codebaseNotes.noteStyle.*Foreground` 主题颜色。默认值与 JetBrains 语义色一致；如需适配自定义主题，可在 `workbench.colorCustomizations` 中覆盖。

`.codebase-notes.json` 是唯一事实来源。插件不会把主数据藏进 `.idea`、`.vscode` 或本机数据库。配置可以提交到 Git，下面两类运行时文件则应保持忽略：

```gitignore
.codebase-notes.json.lock
.codebase-notes.json.tmp.*
```

完成这一节，才算“两个安装包都能工作”验收通过。单独看到插件已安装不算，因为这个项目真正要验证的是两端能安全读写同一份配置。

## 6. 需要改源码时，如何运行开发版

手动安装适合最终验收；日常开发不必每次打包安装，可以使用开发宿主缩短反馈周期。

### VS Code 开发宿主

在仓库根目录执行：

```bash
npm --prefix src/vscode run compile
code --new-window \
  --extensionDevelopmentPath="$PWD/src/vscode" \
  /absolute/path/to/a-test-project
```

修改 TypeScript 后，重新执行 `npm --prefix src/vscode run compile`，再在测试窗口执行 `Developer: Reload Window`。当前项目没有 watch 脚本，所以只 Reload、没有重新构建，不会加载新代码。

### JetBrains 沙箱 IDE

JetBrains 插件是独立的 Gradle 工程。用 IntelliJ IDEA 开发 Kotlin 时，直接打开 `src/jetbrains` 目录，并把 Gradle JVM 设为 JDK 21。

```bash
cd src/jetbrains
./gradlew runIde --args="/absolute/path/to/a-test-project"
```

这个命令启动隔离的 IntelliJ IDEA 2025.3.4 沙箱，不会把开发版插件装进日常 IDEA。修改 Kotlin 后，停止沙箱并重新运行命令。

## 7. 开发时常用命令

根目录的 `deploy.sh` 是公共入口。第一个参数是动作，第二个参数可选 `all`、`vscode` 或 `jetbrains`：

直接运行 `./deploy.sh` 会打开方向键菜单；上下左右均可移动，按 Enter 确认。带参数调用适合脚本和 CI。

| 命令 | 做什么 |
| --- | --- |
| `./deploy.sh init` | 安装 VS Code 依赖，并初始化、校验 JetBrains 插件工程 |
| `./deploy.sh test` | 运行共享协议和两端测试 |
| `./deploy.sh build` | 构建两端工程 |
| `./deploy.sh package` | 生成并汇总两端安装包 |
| `./deploy.sh clean` | 清理两端生成物 |

根目录 `VERSION` 是两端唯一版本源。查看或升级版本：

```bash
./deploy.sh version
./deploy.sh version 0.2.0
```

设置新版本会同步 `src/vscode/package.json` 和 `package-lock.json`；JetBrains Gradle 构建直接读取 `VERSION`。直接编辑 `VERSION` 也可以，构建、测试和打包前会自动同步并校验派生版本。

需要排查单端问题时，VS Code 命令从 `src/vscode` 目录执行：

| 命令 | 做什么 |
| --- | --- |
| `npm test` | 校验共享协议，并运行 VS Code 核心测试 |
| `npm run typecheck` | 只做 TypeScript 类型检查 |
| `npm run compile` | 编译并 bundle VS Code 插件 |
| `npm run test:integration` | 启动 VS Code Electron 集成测试 |
| `npm run package` | 生成 VSIX |

JetBrains 命令从 `src/jetbrains` 执行：

| 命令 | 做什么 |
| --- | --- |
| `./gradlew test` | 运行 Kotlin 核心和共享 fixture 测试 |
| `./gradlew runIde` | 启动带开发版插件的沙箱 IDE |
| `./gradlew buildPlugin` | 生成可安装 ZIP |

## 8. 先看懂这四个目录

```text
spec/                 JSON Schema 与两端共享的一致性用例
src/vscode/           独立的 TypeScript、npm 和 VS Code 插件工程
src/jetbrains/        独立的 Kotlin、Gradle 和 JetBrains 插件工程
scripts/              兼容两端的公共构建、测试与打包入口
docs/platform/        协议、实现方案、测试计划与设计评审
```

项目刻意没有让 Kotlin 和 TypeScript 共享运行时二进制，而是让它们共享 Schema 和测试 fixture。可以把它理解成“同一份法律，两套执行机构”：改一端的核心行为时，通常应该先补 `spec/conformance` 用例，再让两端同时通过，避免编辑器之间悄悄产生语义分叉。

## 9. 常见问题

### `npm ci` 或 TypeScript 构建提示版本不支持

确认 `node --version` 是 22.x。进入 `src/vscode` 目录，使用 nvm 时重新执行 `nvm use`，再执行 `npm ci`。

### Gradle 找不到 Java，或 Kotlin target 报错

确认 `java -version` 是 21，并检查 `JAVA_HOME`。从 IntelliJ IDEA 运行 Gradle 时，还要在 Gradle 设置里把 Gradle JVM 切到 JDK 21。

### 插件加载了，但看不到备注

- 第一次编辑备注前，不会自动创建 `.codebase-notes.json`。
- 配置只从当前 workspace/project root 读取，不扫描嵌套配置。
- VS Code multi-root 中，每个 workspace folder 各自维护一份配置。
- VS Code 原生 Explorer API 只能显示短 badge、颜色和 tooltip；完整文字在 `Annotated Files`。

### 改了源码但行为没变化

VS Code 侧先在 `src/vscode` 目录重新执行 `npm run compile` 再 Reload Window；JetBrains 侧停止并重新运行 `./gradlew runIde`。安装包模式下则需要重新打包、覆盖安装并重启 IDE。

## 进一步阅读

- [文档索引与维护规则](docs/README.md)
- [v1 协议规范](docs/platform/specs/S20260717_platform_codebase_notes_protocol.md)
- [实现方案](docs/platform/specs/S20260717_platform_codebase_notes_implementation.md)
- [IDEA + VS Code 集成测试全流程](docs/platform/specs/S20260717_platform_codebase_notes_integration_test_plan.md)
- [设计与评审结论](docs/platform/reports/R20260717_platform_codebase_notes_design_review.md)
- [JSON Schema](spec/codebase-notes.schema.json)

项目采用 [MIT License](LICENSE)。产品思路参考 [Link-Kou/intellij-treeInfotip](https://github.com/Link-Kou/intellij-treeInfotip)，Codebase Notes 的跨编辑器存储、并发写入、路径事件和 UI 适配为独立实现。
