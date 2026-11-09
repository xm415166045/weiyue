# 微阅 Yuewei

把微信读书里的划线、想法和书评，收进一个属于自己的书架。

一个基于 Expo / React Native 的本地优先阅读笔记应用。数据存在手机里，不进别人的服务器。

---

## 下载

**[下载最新安装包 yuewei-v2.0.37.apk](https://gitee.com/marcello2026/yuewei/releases/download/v2.0.37/yuewei-v2.0.37.apk)** · [全部版本](https://gitee.com/marcello2026/yuewei/releases)

- 架构 `arm64-v8a` + `x86_64`，覆盖主流真机与模拟器
- Android 7.0 及以上
- debug 签名，仅供内测与个人使用，不能上架应用商店

---

## 功能

**书架**
- 封面网格展示，手机竖屏 3 列、横屏自适应列数
- 按「正在读 / 已读完 / 全部」筛选，支持书名与作者搜索
- 封面本地缓存，断网也能翻

**笔记**
- 每本书归集三类内容：划线、想法、书评
- 按章节排序，支持关键词高亮

**统计**
- 书籍数、笔记数、阅读时长、读完数
- 月度趋势与阅读分布

**导入**
- 通过微信读书 Agent 网关拉取（`i.weread.qq.com/api/agent/gateway`），需自备凭据
- 默认**增量同步**：只拉有变化的书，未变化的跳过
- 提供「强制全量重导」入口，并给出新增 / 更新 / 跳过 / 失败 / 远端移除的明细
- 删除过的书和笔记留墓碑，重导不会复活

**导出**
- Markdown、PDF、EPUB 三种格式
- 通过原生模块经 MediaStore 写入 `Download/微阅/`，不需要存储权限
- 支持推送至 ima 知识库

**其它**
- 深色状态栏与安全区适配，竖屏横屏都可用
- 官方主色 `#114498` 深邃蓝

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | Expo 56 |
| 运行时 | React Native 0.85.3 / React 19.2.3 |
| 语言 | TypeScript 6 |
| 状态 | Redux Toolkit + React Redux |
| 路由 | React Navigation 7（bottom-tabs + native-stack） |
| 持久化 | AsyncStorage（分片存储） |
| 原生 | 自研 FileSaver 模块（Java / MediaStore） |
| 构建 | Gradle + Android SDK 36 |

## 目录结构

```
.
├── App.tsx                  # 应用入口，SafeAreaProvider + Provider
├── app.json                 # Expo 配置
├── app.plugin.js            # prebuild 钩子：恢复原生模块、注入清单配置
├── build-apk.sh             # Android 打包脚本
├── plugins/native/          # 原生模块源码唯一真源
└── src/
    ├── components/          # AlertModal / ConfirmSheet / ExportSheet / Toast
    ├── navigation/          # 底部三 Tab + 笔记详情栈
    ├── screens/             # 书架 / 统计 / 我的 / 笔记详情
    ├── services/            # 导入、导出、存储、封面缓存、同步元数据
    ├── store/               # Redux slices
    ├── theme/               # 色彩系统
    └── types/               # 全局类型
```

`android/` 与 `ios/` 由 `expo prebuild` 生成，不入库。原生模块的源码放在 `plugins/native/`，prebuild 时由 `app.plugin.js` 幂等恢复到 `android/` 下并注册包名。

## 快速开始

```bash
npm install
npm start          # 启动 Metro
npm run android    # 编译并运行安卓
npm run typecheck  # 类型检查
```

首次运行安卓前需要 `npx expo prebuild --platform android` 生成原生工程。

## 构建 Android 安装包

```bash
./build-apk.sh
```

脚本会同步 `app.json` / `package.json` / `build.gradle` 三处版本号，然后产出 release APK。

**踩过的坑，写在前面：**

- **工程路径必须全 ASCII。** Gradle 的 CMake / prefab 在中文路径下会因为编码截断失败，报错信息指向 `prefab_command` 或 gradle-plugin 找不到。把工程复制到 `C:\Users\Public\...` 这类纯英文路径再构建。
- **JDK 与 SDK 都要完整。** 缺 `conf/security/java.security` 的 JDK 副本会以 `java.lang.InternalError` 形式挂掉；缺 `cmake.exe` 的 SDK 会在 C++ 编译阶段停住。
- **lint 任务在本工具链必挂**，构建时加 `-x lint -x lintVitalRelease -x lintVitalAnalyzeRelease`。
- **别一次编 4 个 ABI**，x86 容易挂死。用 `-PreactNativeArchitectures=arm64-v8a,x86_64` 双架构，真机和模拟器都覆盖，两分钟出包。

以上细节在 `AGENTS.md` 里有更完整的记录。

## 数据与隐私

- 笔记、书籍、设置全部存在本机 AsyncStorage，不上传任何第三方服务器
- 导入时才会访问微信读书网关，凭据由用户自己填写
- 导出文件直接落到系统下载目录，应用不做额外留存

## 版本

当前 `2.0.37`（versionCode 65）。

## License

MIT。见 [LICENSE](LICENSE)。
