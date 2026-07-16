#!/usr/bin/env bash

# 遇到错误、未定义变量或管道中的失败时立即退出，避免生成半成品。
set -euo pipefail

# 无论从哪个目录调用脚本，都先计算仓库和两个平台工程的绝对路径。
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$script_dir"
vscode_root="$project_root/src/vscode"
jetbrains_root="$project_root/src/jetbrains"
artifacts_root="$project_root/artifacts"
version_script="$project_root/scripts/version.mjs"

# 打印统一入口的使用说明。
usage() {
  cat <<'EOF'
Usage: ./deploy.sh <action> [target]
       ./deploy.sh version [new-version]

Actions:
  init       Install VS Code dependencies and initialize the JetBrains plugin project
  test       Run shared contract and platform tests
  build      Build platform projects
  package    Create VSIX/ZIP packages in artifacts/
  clean      Remove generated build outputs
  version    Show or update the global project version

Targets: all (default), vscode, jetbrains
EOF
}

# 第一个参数决定执行什么动作，第二个参数决定处理哪些平台。
action="${1:-}"
target="${2:-all}"
interactive_mode=false

# 读取一个终端菜单选项。四个方向键都可移动，Enter 确认，q 退出。
select_menu() {
  local title="$1"
  shift
  local options=("$@")
  local selected=0
  local key=""
  local suffix=""

  while true; do
    printf '\033[2J\033[H'
    printf 'Codebase Notes Deploy\n\n'
    printf '%s\n\n' "$title"

    for index in "${!options[@]}"; do
      if [[ "$index" -eq "$selected" ]]; then
        printf '\033[1;36m  ▶ %-12s\033[0m\n' "${options[$index]}"
      else
        printf '    %-12s\n' "${options[$index]}"
      fi
    done

    printf '\nArrow keys: move | Enter: select | q: quit\n'
    IFS= read -rsn1 key

    if [[ "$key" == $'\033' ]]; then
      suffix=""
      # 方向键是 ESC 后跟两个字符；不用小数超时，以兼容 macOS 自带 Bash 3.2。
      IFS= read -rsn2 suffix
      key+="$suffix"
    fi

    case "$key" in
      $'\033[A'|$'\033[D')
        selected=$(((selected - 1 + ${#options[@]}) % ${#options[@]}))
        ;;
      $'\033[B'|$'\033[C')
        selected=$(((selected + 1) % ${#options[@]}))
        ;;
      "")
        menu_selection="${options[$selected]}"
        return 0
        ;;
      q|Q)
        return 1
        ;;
    esac
  done
}

# 没有参数时进入交互菜单；重定向或 CI 等非终端环境不等待按键。
if [[ "$#" -eq 0 ]]; then
  interactive_mode=true
  if [[ ! -t 0 || ! -t 1 ]]; then
    printf 'Interactive mode requires a terminal. Pass an explicit action in non-interactive environments.\n\n' >&2
    usage >&2
    exit 2
  fi

  restore_terminal() {
    printf '\033[?25h'
  }

  printf '\033[?25l'
  trap restore_terminal EXIT
  trap 'exit 130' INT TERM

  if ! select_menu "Select an action:" init test build package clean version exit; then
    printf '\033[2J\033[H'
    exit 0
  fi
  action="$menu_selection"

  if [[ "$action" == "exit" ]]; then
    printf '\033[2J\033[H'
    exit 0
  fi

  if [[ "$action" != "version" ]]; then
    if ! select_menu "Select a target:" all vscode jetbrains; then
      printf '\033[2J\033[H'
      exit 0
    fi
    target="$menu_selection"
  fi

  printf '\033[2J\033[H'
  restore_terminal
  trap - EXIT INT TERM
fi

# version 不属于某个平台：读取或更新 VERSION 后直接退出。
if [[ "$action" == "version" ]]; then
  if [[ "$#" -gt 2 ]]; then
    printf 'Too many arguments for version.\n\n' >&2
    usage >&2
    exit 2
  fi

  new_version="${2:-}"
  if [[ "$interactive_mode" == true ]]; then
    current_version="$(node "$version_script" get --raw)"
    printf 'Current version: %s\n' "$current_version"
    printf 'New version (leave empty to keep current): '
    IFS= read -r new_version
  fi

  if [[ -z "$new_version" ]]; then
    node "$version_script" get
  else
    node "$version_script" set "$new_version"
  fi
  exit 0
fi

# 校验英文动作，并准备稍后展示的结构化名称。
case "$action" in
  init|test|build|package|clean) action_name="$action" ;;
  -h|--help|help|"")
    usage
    exit 0
    ;;
  *)
    printf 'Unknown action: %s\n\n' "$action" >&2
    usage >&2
    exit 2
    ;;
esac

# 执行工程动作前，以根 VERSION 同步并校验 VS Code 派生版本。
if [[ "$action" != "clean" ]]; then
  node "$version_script" sync --quiet
  node "$version_script" check --quiet
fi
project_version="$(node "$version_script" get --raw)"

# 把平台参数转换成待执行的平台数组。
case "$target" in
  all) platforms=(vscode jetbrains) ;;
  vscode|jetbrains) platforms=("$target") ;;
  *)
    printf 'Unknown target: %s\n\n' "$target" >&2
    usage >&2
    exit 2
    ;;
esac

# 每个平台算一个阶段，统一显示进度、目的、目录和底层命令。
total_steps="${#platforms[@]}"
current_step=0
platform_list="$(IFS=,; printf '%s' "${platforms[*]}")"

start_stage() {
  local platform_name="$1"
  local purpose="$2"
  local directory="$3"
  local command="$4"

  current_step=$((current_step + 1))
  printf '\n[%d/%d] %s / %s\n' "$current_step" "$total_steps" "$platform_name" "$action_name"
  printf '  Purpose:   %s\n' "$purpose"
  printf '  Directory: %s\n' "$directory"
  printf '  Command:   %s\n\n' "$command"
}

finish_stage() {
  local platform_name="$1"
  printf '\n  OK: %s %s complete\n' "$platform_name" "$action_name"
}

printf 'Codebase Notes Deploy\n'
printf 'Version: %s\n' "$project_version"
printf 'Action: %s\n' "$action"
printf 'Target: %s\n' "$platform_list"

# 执行 VS Code/npm 工程对应的动作。
run_vscode() {
  case "$action" in
    init)
      start_stage "VS Code" "Install Node.js dependencies from package-lock.json" "src/vscode" "npm ci"
      (cd "$vscode_root" && npm ci)
      ;;
    test)
      start_stage "VS Code" "Validate shared contracts and run TypeScript unit tests" "src/vscode" "npm test"
      npm --prefix "$vscode_root" test
      ;;
    build)
      start_stage "VS Code" "Compile TypeScript and bundle the extension" "src/vscode" "npm run compile"
      npm --prefix "$vscode_root" run compile
      ;;
    package)
      start_stage "VS Code" "Create a VSIX and copy it to artifacts/" "src/vscode" "npm run package"
      # 先删除旧 VSIX，防止 artifacts/ 中混入多个历史版本。
      find "$artifacts_root" -maxdepth 1 -type f -name '*.vsix' -delete
      find "$vscode_root" -maxdepth 1 -type f -name '*.vsix' -delete
      npm --prefix "$vscode_root" run package
      mkdir -p "$artifacts_root"
      cp "$vscode_root/codebase-notes-vscode-${project_version}.vsix" "$artifacts_root/"
      ;;
    clean)
      start_stage "VS Code" "Remove compiled files and generated resources" "src/vscode" "npm run clean"
      npm --prefix "$vscode_root" run clean
      ;;
  esac
  finish_stage "VS Code"
}

# 执行 JetBrains/Gradle 工程对应的动作。
run_jetbrains() {
  case "$action" in
    init)
      start_stage "JetBrains" "Initialize IntelliJ Platform tooling and validate project configuration" "src/jetbrains" "./gradlew initializeIntellijPlatformPlugin verifyPluginProjectConfiguration"
      (cd "$jetbrains_root" && ./gradlew initializeIntellijPlatformPlugin verifyPluginProjectConfiguration)
      ;;
    test)
      start_stage "JetBrains" "Run Kotlin unit tests and shared contract tests" "src/jetbrains" "./gradlew test"
      (cd "$jetbrains_root" && ./gradlew test)
      ;;
    build)
      start_stage "JetBrains" "Compile, test, and build the plugin" "src/jetbrains" "./gradlew build"
      (cd "$jetbrains_root" && ./gradlew build)
      ;;
    package)
      start_stage "JetBrains" "Create a plugin ZIP and copy it to artifacts/" "src/jetbrains" "./gradlew buildPlugin"
      # 先删除旧 ZIP，防止 artifacts/ 中混入多个历史版本。
      find "$artifacts_root" -maxdepth 1 -type f -name '*.zip' -delete
      mkdir -p "$jetbrains_root/build/distributions"
      find "$jetbrains_root/build/distributions" -maxdepth 1 -type f -name '*.zip' -delete
      (cd "$jetbrains_root" && ./gradlew buildPlugin)
      mkdir -p "$artifacts_root"
      cp "$jetbrains_root/build/distributions/codebase-notes-jetbrains-${project_version}.zip" "$artifacts_root/"
      ;;
    clean)
      start_stage "JetBrains" "Remove Gradle build outputs" "src/jetbrains" "./gradlew clean"
      (cd "$jetbrains_root" && ./gradlew clean)
      ;;
  esac
  finish_stage "JetBrains"
}

# 打包前保证公共产物目录存在。
if [[ "$action" == "package" ]]; then
  mkdir -p "$artifacts_root"
fi

# 按用户选择依次执行一个或两个平台。
for platform in "${platforms[@]}"; do
  case "$platform" in
    vscode) run_vscode ;;
    jetbrains) run_jetbrains ;;
  esac
done

# 双端清理时，公共产物也应一起删除。
if [[ "$action" == "clean" && "$target" == "all" ]]; then
  printf '\nAdditional cleanup: artifacts/\n'
  rm -rf "$artifacts_root"
fi

# 给出统一的产物位置，避免用户分别去两个工程目录寻找。
if [[ "$action" == "package" ]]; then
  case "$target" in
    vscode) artifact_pattern='*.vsix' ;;
    jetbrains) artifact_pattern='*.zip' ;;
    all) artifact_pattern='*' ;;
  esac

  printf '\nArtifacts:\n'
  while IFS= read -r artifact; do
    printf '  - %s\n' "${artifact#"$project_root/"}"
  done < <(find "$artifacts_root" -maxdepth 1 -type f -name "$artifact_pattern" | sort)
fi

printf '\nDone: %s / %s\n' "$action" "$platform_list"
