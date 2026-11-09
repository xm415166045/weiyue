# 微阅（yuewei）工程约定

> 写代码前先读 https://docs.expo.dev/versions/v56.0.0/ 的对应版本文档，不要用旧版 API 猜。

## 关键事实

- 框架：Expo SDK 56 / React Native 0.85.3 / React 19.2.3 / TypeScript 6（`strict: true`）。
- 版本唯一真源：`app.json` 的 `expo.version`。`build-apk.sh` 递进版本时会同步 `package.json` 与 `package-lock.json`，不要只改其中一个。
- 入口链：`index.ts` → `App.tsx` → `src/navigation/AppNavigator.tsx`；底部三 Tab：书架 / 统计 / 我的。
- 色彩唯一真源：`src/theme/colors.ts`（深邃蓝 `#114498`），设计系统文档与之同步。

## 数据与状态

- Redux Toolkit 只管 UI 状态（筛选、排序、多选）；业务数据全部在 AsyncStorage，`src/services/storage.ts` 按 1.5 MB 分片，笔记按 `bookId` 索引。
- 微信读书 `wrk-` API Key、ima `clientId`/`apiKey` 存于 `@weread_settings`，**当前为明文**；涉及凭据的改动先确认安全方案。
- 未使用的依赖：`axios`（服务层统一用 `fetch`）；`playwright` 已移入 devDependencies。

## 文件保存（改动需谨慎）

- 唯一生效的原生实现：`plugins/native/FileSaverModule.java` + `FileSaverPackage.java`（模板），由 `app.plugin.js` 在 prebuild 时恢复到 `android/app/.../filesaver/` 并注册 `FileSaverPackage`。
- JS 桥接层：`src/services/file-saver.ts`（`NativeModules.FileSaverModule`）；四级降级策略在 `src/services/export-service.ts` 的 `saveFile`。
- **不要申请 READ / WRITE / MANAGE_EXTERNAL_STORAGE**：Android 10+ 走 MediaStore.Downloads，降级走 SAF，适配 targetSdk 36。
- `android/`、`ios/` 被 `.gitignore` 忽略；自定义原生源码必须放 `plugins/native/`，否则换机器 / prebuild 后会编译失败。
- 编译产物（`**/build/`、`*.dex`）禁止入库；需要锁指纹请提交 sha 文本，不要提交二进制。

## 构建与校验

- `npm install` 后跑 `npm run typecheck`；本仓库快照不含 `node_modules`。
- APK：`./build-apk.sh`（跨平台），需 JDK 17 + Android SDK 36，产物输出到桌面。
- 文档注意：`项目文档/微阅-技术方案.md` 是 2026-06 的历史方案，顶部现状架构表才是真实实现；`微阅-overview.md` 是 V1.5.3 的历史修复记录。

## 增量导入（2026-11-09 新增）

- 默认增量同步，基线存 `@weread_sync_meta`。签名来自 `/user/notebooks` 的 `reviewCount:noteCount:bookmarkCount:sort`；**绝对不要用 `Book.noteCount` 比较**（展示值与远端声明数口径不同，会退化成全量）。
- 删除墓碑 `@weread_deleted_books` / `@weread_deleted_notes` 由 `storage.deleteBooks/deleteNotes` 写入；增量同步尊重墓碑，强制全量重导忽略并清空。
- 远端返回空列表时，增量模式必须保留本地数据，不能清空。
- 某本书笔记拉取失败时不要更新其签名、保留旧笔记，下次自动重试。

## 横屏（2026-11-09 新增）

- `app.json` 的 `orientation` 为 `default`（Expo 56 合法值，no lock）；尺寸一律用 `useWindowDimensions()`，**禁止模块级 `Dimensions.get('window')` 常量**。
- 书架列数走 `gridColumns()`，统计指标卡列数按宽度分档；横屏左右安全区取 `insets.left/right`。
- 弹层宽度 `min(270, width * 0.8)`，配合 `maxHeight` 与 ScrollView，避免横屏被裁切。
- **`App.tsx` 最外层必须有 `<SafeAreaProvider>`**：`AppTabs` 与四个 Screen 都用 `useSafeAreaInsets()`，而 React Navigation 7 的 `NavigationContainer` 不向 children 提供该 context。缺了会启动即 `No safe area value available` 闪退（2026-11-09 实测）。

## 构建 / 打包（2026-11-09 实测）

- 本机工具链已统一到 `D:\AndroidSDK`（2026-11-09 合并学习台与微阅两套环境）：JDK 17 (Temurin 17.0.20.1) 在 `D:\AndroidSDK\jdk`、Android SDK 在 `D:\AndroidSDK\sdk`（platforms 34/36、build-tools 34.0.0/35.0.0/36.0.0、NDK 27.1、cmake 3.22.1）、`node_modules` 940 个包。该路径本身纯 ASCII，构建时**不需要**再映射 Y:/Z: 盘符。
- **中文工作区路径（曲小明 / 微阅）会让 AGP 的 prefab / CMake / ninja 阶段失败**：cmd.exe 按 GBK 解析 UTF-8 中文路径导致命令行断裂。`android.overridePathCheck=true` 只压掉警告，不解决根因；junction / subst 也都不够（会被解析回真实路径或让 autolinking 失败）。**必须把项目物理复制到纯 ASCII 路径**（当前 `C:\Users\Public\yuewei\src`）配合 subst 盘符构建，完整命令见 `outputs/微阅-横屏与增量导入方案.md` 第六节。
- Windows 下需 `GRADLE_OPTS` / `JAVA_TOOL_OPTIONS` 强制 UTF-8；`android/gradle.properties` 需 `android.overridePathCheck=true` 与 300 秒 HTTP 超时（`build-apk.sh` 会幂等补齐）。
- `build-apk.sh` 递进版本时会同步 `android/app/build.gradle` 的 versionCode / versionName，避免 APK 内版本与 `app.json` 漂移。
- release 构建目前复用 `debug.keystore` 签名，可用于调试安装，**不能上架应用商店**。


- **版本递进必须同步四处**：`app.json`（version + android.versionCode）、`package.json`、`package-lock.json`（顶层与 packages[""] 两处）、`android/app/build.gradle`（versionCode/versionName）；若走 ASCII 沙箱构建，副本的这四处也要同步。build-apk.sh 的 Step 3 已实现该同步。
