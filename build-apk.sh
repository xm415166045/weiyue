#!/bin/bash
# ============================================
# 微阅 APP - 本地 APK 构建脚本
# Version: 1.2.0（跨平台：macOS / Windows Git Bash / Linux）
# 构建产物命名规则：微阅-V{version}.apk
# 版本唯一真源：app.json 的 expo.version（脚本递进后同步 package.json / package-lock.json）
# ============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  微阅 APP - APK 本地构建${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# ====== 平台检测 ======
UNAME_S="$(uname -s)"
case "$UNAME_S" in
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  Darwin*)              PLATFORM="macos" ;;
  *)                    PLATFORM="linux" ;;
esac
echo -e "  平台: ${PLATFORM} (${UNAME_S})"

# Git Bash 下环境变量可能是 Windows 风格路径，统一转成 POSIX 路径
to_posix_path() {
  if [ "$PLATFORM" = "windows" ] && command -v cygpath >/dev/null 2>&1; then
    cygpath -u "$1"
  else
    printf '%s' "$1"
  fi
}

case "$PLATFORM" in
  macos)   CMDLINE_ZIP="commandlinetools-mac-11076708_latest.zip" ;;
  windows) CMDLINE_ZIP="commandlinetools-win-11076708_latest.zip" ;;
  *)       CMDLINE_ZIP="commandlinetools-linux-11076708_latest.zip" ;;
esac

# ====== 配置 — 必须使用环境变量，拒绝硬编码路径 ======
if [ -z "$JAVA_HOME" ]; then
    echo -e "${RED}✗ 未设置 JAVA_HOME 环境变量${NC}"
    echo "  请安装 JDK 17 后设置，例如：export JAVA_HOME=/path/to/jdk-17"
    exit 1
fi
if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
    echo -e "${RED}✗ 未设置 ANDROID_HOME 环境变量${NC}"
    echo "  请安装 Android SDK 后设置：export ANDROID_HOME=/path/to/android-sdk"
    exit 1
fi

JAVA_HOME="$(to_posix_path "$JAVA_HOME")"
ANDROID_SDK_DIR="$(to_posix_path "${ANDROID_HOME:-$ANDROID_SDK_ROOT}")"

# macOS 的 JDK bundle 需指向 Contents/Home；Windows / Linux 直接用根目录
JDK_DIR="$JAVA_HOME"
if [ -d "$JAVA_HOME/Contents/Home" ]; then
    JDK_DIR="$JAVA_HOME/Contents/Home"
fi

JAVA_BIN="$JDK_DIR/bin/java"
GRADLE_SCRIPT="./gradlew"
if [ "$PLATFORM" = "windows" ]; then
    JAVA_BIN="${JAVA_BIN}.exe"
    GRADLE_SCRIPT="./gradlew.bat"
fi

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
APK_OUTPUT_DIR="$HOME/Desktop"

# ====== Step 1: 检查 JDK ======
echo ""
echo -e "${YELLOW}[1/6] 检查 Java JDK...${NC}"

if [ -x "$JAVA_BIN" ] && "$JAVA_BIN" -version 2>&1 | grep -q "17"; then
    echo -e "${GREEN}✓ JDK 17 已安装: $JDK_DIR${NC}"
    "$JAVA_BIN" -version 2>&1 | head -1
else
    echo -e "${RED}✗ 未找到 JDK 17（$JAVA_BIN）${NC}"
    echo "  请安装 JDK 17 并确认 JAVA_HOME 指向正确的安装目录。"
    exit 1
fi

export JAVA_HOME="$JDK_DIR"
export PATH="$JDK_DIR/bin:$PATH"

# ====== Step 2: 检查 Android SDK ======
echo ""
echo -e "${YELLOW}[2/6] 检查 Android SDK...${NC}"

if [ -d "$ANDROID_SDK_DIR/build-tools/36.0.0" ] && [ -d "$ANDROID_SDK_DIR/platforms/android-36" ]; then
    echo -e "${GREEN}✓ Android SDK 已安装: $ANDROID_SDK_DIR${NC}"
else
    echo -e "${RED}✗ Android SDK 缺少 build-tools;36.0.0 或 platforms;android-36${NC}"
    echo "  可安装命令行工具：https://dl.google.com/android/repository/${CMDLINE_ZIP}"
    echo "  然后执行：sdkmanager --sdk_root=$ANDROID_SDK_DIR 'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'"
    exit 1
fi

export ANDROID_HOME="$ANDROID_SDK_DIR"
export PATH="$ANDROID_SDK_DIR/platform-tools:$ANDROID_SDK_DIR/cmdline-tools/latest/bin:$PATH"

# ====== Step 3: 自动递进版本号并同步三处 ======
echo ""
echo -e "${YELLOW}[3/6] 版本号递进...${NC}"

cd "$PROJECT_DIR"

CURRENT_VERSION=$(node -e "console.log(require('./app.json').expo.version)")
CURRENT_CODE=$(node -e "console.log(require('./app.json').expo.android?.versionCode || 1)")
echo -e "  当前版本: V${CURRENT_VERSION} (versionCode: ${CURRENT_CODE})"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"
NEW_CODE=$((CURRENT_CODE + 1))

node -e "
const fs = require('fs');
const V = '${NEW_VERSION}', C = ${NEW_CODE};
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n');

const app = read('./app.json');
app.expo.version = V;
if (!app.expo.android) app.expo.android = {};
app.expo.android.versionCode = C;
write('./app.json', app);

const pkg = read('./package.json');
pkg.version = V;
write('./package.json', pkg);

// 锁文件只替换顶层两处 version，避免重排整份 JSON
let lock = fs.readFileSync('./package-lock.json', 'utf8');
lock = lock.replace(/(\"version\": \")[0-9]+\.[0-9]+\.[0-9]+(\",\n  \"lockfileVersion\")/, (m, p1, p2) => p1 + V + p2);
lock = lock.replace(/(\"name\": \"yuewei\",\n      \"version\": \")[0-9]+\.[0-9]+\.[0-9]+(\")/, (m, p1, p2) => p1 + V + p2);
fs.writeFileSync('./package-lock.json', lock);

// 同步 android/app/build.gradle 里 prebuild 写死的 versionCode / versionName，
// 否则 APK 内的版本会与 app.json 漂移（历史上出现过 2.0.28 / 56 vs 2.0.29 / 52）。
const gp = './android/app/build.gradle';
if (fs.existsSync(gp)) {
  const g = fs.readFileSync(gp, 'utf8');
  const ng = g
    .replace(/versionCode\s+\d+/, 'versionCode ' + C)
    .replace(/versionName\s+\"[^\"]*\"/, 'versionName \"' + V + '\"');
  if (ng !== g) fs.writeFileSync(gp, ng);
}
"
echo -e "${GREEN}✓ 版本递进: V${CURRENT_VERSION} → V${NEW_VERSION} (versionCode: ${CURRENT_CODE} → ${NEW_CODE})${NC}"
echo -e "  已同步 app.json / package.json / package-lock.json / android/app/build.gradle"

VERSION="$NEW_VERSION"

# ====== Step 4: 准备 Android 原生项目 ======
echo ""
echo -e "${YELLOW}[4/6] 准备 Android 原生项目...${NC}"

cd "$PROJECT_DIR"

NATIVE_MODULE="android/app/src/main/java/com/yuewei/app/filesaver/FileSaverModule.java"
if [ ! -d "android" ] || [ ! -f "$NATIVE_MODULE" ]; then
    echo -e "${YELLOW}→ 原生工程或自定义 FileSaverModule 缺失，运行 expo prebuild...${NC}"
    echo -e "  （app.plugin.js 会自动恢复 plugins/native/ 下的源码并注册 FileSaverPackage）"
    npx expo prebuild --platform android --no-install
else
    echo -e "${GREEN}✓ Android 原生项目与自定义文件保存模块已就绪${NC}"
fi

# gradle.properties 位于被 .gitignore 忽略的 android/ 目录，换机器会丢。
# 这里按幂等方式补齐 Windows 中文路径与大 AAR 下载所需的两个开关。
GRADLE_PROPS="$PROJECT_DIR/android/gradle.properties"
if [ -f "$GRADLE_PROPS" ]; then
    ensure_gradle_prop() {
        if ! grep -Fq "$1=" "$GRADLE_PROPS"; then
            printf '\n%s=%s\n' "$1" "$2" >> "$GRADLE_PROPS"
            echo -e "  ${YELLOW}→ 已补齐 gradle.properties: $1${NC}"
        fi
    }
    ensure_gradle_prop "android.overridePathCheck" "true"
    ensure_gradle_prop "org.gradle.internal.http.connectionTimeout" "300000"
    ensure_gradle_prop "org.gradle.internal.http.socketTimeout" "300000"
fi

if [ ! -f "$NATIVE_MODULE" ]; then
    echo -e "${RED}✗ prebuild 后仍未找到 $NATIVE_MODULE${NC}"
    echo "  请检查 plugins/native/ 是否存在 FileSaverModule.java 及 app.plugin.js 是否生效。"
    exit 1
fi

# ====== Step 5: 构建 APK ======
echo ""
echo -e "${YELLOW}[5/6] 构建 APK (Release)...${NC}"

cd "$PROJECT_DIR/android"
if [ "$PLATFORM" != "windows" ]; then
    chmod +x gradlew
else
    # Gradle / java 是 Windows 进程，环境变量必须是 Windows 风格路径；
    # 而脚本内部的文件检查用 POSIX 路径，故在调用 gradlew 前才转换。
    export JAVA_HOME="$(cygpath -w "$JDK_DIR")"
    export ANDROID_HOME="$(cygpath -w "$ANDROID_SDK_DIR")"
    # Windows JVM 默认 GBK，而 Git Bash / Node 输出 UTF-8 路径。
    # 项目路径含中文时，Gradle 会把 node_modules 路径读成乱码并报
    # "Included build ... does not exist"，必须强制 UTF-8。
    export GRADLE_OPTS="-Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8"
    export JAVA_TOOL_OPTIONS="-Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8"
fi

echo -e "  版本号: V${VERSION}"
echo -e "${BLUE}→ ${GRADLE_SCRIPT} assembleRelease${NC}"
# 跳过 lint：本机 lintVitalAnalyzeRelease 会抛 IntelliJ ExtensionPoint 异常，
# 与业务代码无关（内测包不做 lint 门禁）。需要 lint 时手动执行 lintRelease。
"$GRADLE_SCRIPT" assembleRelease \
    -x lint -x lintVitalRelease -x lintVitalAnalyzeRelease \
    --console=plain 2>&1

# ====== Step 6: 复制到桌面 ======
echo ""
echo -e "${YELLOW}[6/6] 复制 APK 到桌面...${NC}"

APK_FILE="$PROJECT_DIR/android/app/build/outputs/apk/release/app-release.apk"

if [ ! -f "$APK_FILE" ]; then
    echo -e "${RED}✗ Release APK 未生成！构建失败，请检查上方 Gradle 错误信息${NC}"
    exit 1
fi

mkdir -p "$APK_OUTPUT_DIR"
OUTPUT_NAME="微阅-V${VERSION}.apk"
cp "$APK_FILE" "$APK_OUTPUT_DIR/$OUTPUT_NAME"

APK_SIZE=$(du -h "$APK_OUTPUT_DIR/$OUTPUT_NAME" | cut -f1)
echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  ✅ APK 构建成功！${NC}"
echo -e "${GREEN}============================================${NC}"
echo -e "  版本: V${VERSION}"
echo -e "  文件: ${APK_OUTPUT_DIR}/${OUTPUT_NAME}"
echo -e "  大小: ${APK_SIZE}"
echo -e "${GREEN}============================================${NC}"
