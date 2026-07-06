#!/bin/bash
# ============================================
# 微阅 APP - 本地 APK 构建脚本
# Version: 1.1.0
# 构建产物命名规则：微阅-V{version}.apk
# version 从 app.json 的 expo.version 字段读取
# 后续修改版本时只需更新 app.json 中的 version 即可
# ============================================

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  微阅 APP - APK 本地构建${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# 配置 — 必须使用环境变量，拒绝硬编码路径
JDK_DIR="${JAVA_HOME:+${JAVA_HOME%/Contents/Home}}"
if [ -z "$JDK_DIR" ]; then
    echo -e "${RED}✗ 未设置 JAVA_HOME 环境变量${NC}"
    echo "  请安装 JDK 17 并设置环境变量:"
    echo "    export JAVA_HOME=/path/to/jdk17/Contents/Home"
    exit 1
fi
ANDROID_SDK_DIR="${ANDROID_HOME}"
if [ -z "$ANDROID_SDK_DIR" ]; then
    echo -e "${RED}✗ 未设置 ANDROID_HOME 环境变量${NC}"
    echo "  请安装 Android SDK 并设置环境变量:"
    echo "    export ANDROID_HOME=/path/to/android-sdk"
    exit 1
fi
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
APK_OUTPUT_DIR="$HOME/Desktop"

# Step 1: 检查 JDK
echo -e "${YELLOW}[1/6] 检查 Java JDK...${NC}"

if [ -d "$JDK_DIR" ] && "$JDK_DIR/Contents/Home/bin/java" -version 2>&1 | grep -q "17"; then
    echo -e "${GREEN}✓ JDK 17 已安装: $JDK_DIR${NC}"
else
    echo -e "${RED}✗ JDK 17 未找到！请先运行以下命令安装：${NC}"
    echo "  mkdir -p ~/.weread-build"
    echo "  curl -L -o ~/.weread-build/jdk17.tar.gz https://cdn.azul.com/zulu/bin/zulu17.54.21-ca-jdk17.0.13-macosx_aarch64.tar.gz"
    echo "  cd ~/.weread-build && tar -xzf jdk17.tar.gz"
    exit 1
fi

export JAVA_HOME="$JDK_DIR/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
echo "  JAVA_HOME=$JAVA_HOME"
"$JAVA_HOME/bin/java" -version 2>&1 | head -1

# Step 2: 检查 Android SDK
echo ""
echo -e "${YELLOW}[2/6] 检查 Android SDK...${NC}"

if [ -d "$ANDROID_SDK_DIR/build-tools/36.0.0" ] && [ -d "$ANDROID_SDK_DIR/platforms/android-36" ]; then
    echo -e "${GREEN}✓ Android SDK 已安装: $ANDROID_SDK_DIR${NC}"
else
    echo -e "${RED}✗ Android SDK 未找到！请先运行以下命令安装：${NC}"
    echo "  mkdir -p $ANDROID_SDK_DIR/cmdline-tools"
    echo "  curl -L -o /tmp/cmdline-tools.zip https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip"
    echo "  unzip -q -o /tmp/cmdline-tools.zip -d $ANDROID_SDK_DIR/cmdline-tools"
    echo "  mv $ANDROID_SDK_DIR/cmdline-tools/cmdline-tools $ANDROID_SDK_DIR/cmdline-tools/latest"
    echo "  yes | $ANDROID_SDK_DIR/cmdline-tools/latest/bin/sdkmanager --sdk_root=$ANDROID_SDK_DIR \\"
    echo "    'platform-tools' 'platforms;android-36' 'build-tools;36.0.0'"
    exit 1
fi

export ANDROID_HOME="$ANDROID_SDK_DIR"
export PATH="$ANDROID_SDK_DIR/platform-tools:$ANDROID_SDK_DIR/cmdline-tools/latest/bin:$PATH"

# Step 3: 自动递进版本号
echo ""
echo -e "${YELLOW}[3/6] 版本号递进...${NC}"

cd "$PROJECT_DIR"

# 读取当前版本号
CURRENT_VERSION=$(node -e "console.log(require('./app.json').expo.version)")
CURRENT_CODE=$(node -e "console.log(require('./app.json').expo.android?.versionCode || 1)")
echo -e "  当前版本: V${CURRENT_VERSION} (versionCode: ${CURRENT_CODE})"

# 自动递进 patch 版本 (1.7.1 → 1.7.2)
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))"
NEW_CODE=$((CURRENT_CODE + 1))

# 更新 app.json
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('./app.json', 'utf8'));
p.expo.version = '${NEW_VERSION}';
if (!p.expo.android) p.expo.android = {};
p.expo.android.versionCode = ${NEW_CODE};
fs.writeFileSync('./app.json', JSON.stringify(p, null, 2) + '\n');
"
echo -e "${GREEN}✓ 版本递进: V${CURRENT_VERSION} → V${NEW_VERSION} (versionCode: ${CURRENT_CODE} → ${NEW_CODE})${NC}"

VERSION="$NEW_VERSION"

# Step 4: 生成 Android 原生代码（如尚未生成）
echo ""
echo -e "${YELLOW}[4/6] 准备 Android 原生项目...${NC}"

cd "$PROJECT_DIR"

if [ ! -d "android" ]; then
    echo -e "${YELLOW}→ 运行 expo prebuild...${NC}"
    npx expo prebuild --platform android --no-install
fi

echo -e "${GREEN}✓ Android 原生项目已就绪${NC}"

# Step 5: 构建 APK
echo ""
echo -e "${YELLOW}[5/6] 构建 APK (Release)...${NC}"

cd "$PROJECT_DIR/android"
chmod +x gradlew

echo -e "  版本号: V${VERSION}"

echo -e "${BLUE}→ ./gradlew assembleRelease${NC}"
./gradlew assembleRelease --console=plain 2>&1

# Step 6: 复制到桌面
echo ""
echo -e "${YELLOW}[6/6] 复制 APK 到桌面...${NC}"

APK_FILE="$PROJECT_DIR/android/app/build/outputs/apk/release/app-release.apk"

if [ ! -f "$APK_FILE" ]; then
    echo -e "${RED}✗ Release APK 未生成！构建失败，请检查上方 Gradle 错误信息${NC}"
    exit 1
fi

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
