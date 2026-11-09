# MusicFree vs 微阅：Android 文件保存方案对比

> 对比对象：maotoumao/MusicFree @ v0.6.2（https://github.com/maotoumao/MusicFree/releases/tag/v0.6.2）
> 对比侧重点：导出/下载文件如何保存到 Android 本地存储

## 一、MusicFree 的文件保存方案

### 技术栈
- **React Native CLI 0.76.5**（非 Expo 主流程，但依赖里含 expo 系列模块）
- 文件操作库：**`react-native-fs` ^2.20.0**（核心）、`expo-file-system`、`react-native-share`
- 本地键值存储：`react-native-mmkv`（播放记录等，非媒体文件）

### 核心源码文件
| 文件 | 作用 |
|------|------|
| `src/core/downloader.ts` | 下载器：URL → 下载 → 写本地文件 |
| `src/constants/pathConst.ts` | 所有路径常量（含默认下载目录） |
| `src/utils/fileUtils.ts` | 文件工具：加 `file://`、递归建目录、文件名清洗 |

### 保存路径（pathConst.ts）
```js
export const basePath =
    Platform.OS === "android"
        ? RNFS.ExternalDirectoryPath          // Android
        : RNFS.DocumentDirectoryPath;         // iOS（沙盒）

// 默认音乐下载目录 = basePath + "/download/music/"
downloadMusicPath: `${basePath}/download/music/`,
downloadCachePath: `${basePath}/cache/download/`,
```
- **`RNFS.ExternalDirectoryPath` = `/storage/emulated/0/Android/data/<pkg>/files`**
- 这是 **应用专属外部存储目录（app-specific external storage）**，在 Android 10+（API 29+）作用域存储模型下，**应用对自己这个目录拥有自由读写权，无需任何存储权限（不需要 `WRITE_EXTERNAL_STORAGE`）**，且不被 MediaStore 限制。
- 用户可在设置里把 `basic.downloadPath` 改成别处（代码：`configService.getConfig("basic.downloadPath") ?? pathConst.downloadMusicPath`）。

### 写文件逻辑（downloader.ts）
```js
// 1) 先下载到缓存路径
const cacheDownloadPath = addFileScheme(this.getCacheDownloadPath(`${nanoid()}.${extension}`));
// 2) 目标路径（用户配置或默认 ExternalDirectoryPath/download/music/）
const targetDownloadPath = addFileScheme(this.getDownloadPath(`${filename}.${extension}`));

// 3) 确保目录存在（mkdirR 递归建目录）
const folder = path.dirname(targetDownloadPath);
if (!(await exists(folder))) await mkdirR(folder);

// 4) 真正下载
const { promise } = downloadFile({ fromUrl: url, toFile: cacheDownloadPath, background: true, ... });
await promise;
// 5) 从缓存移动到目标
await copyFile(cacheDownloadPath, targetDownloadPath);
```
- 全程 **`react-native-fs` 直接写文件系统绝对路径**，没有任何 MediaStore / SAF（Storage Access Framework）适配。
- `addFileScheme` 仅给路径加 `file://` 前缀，`escapeCharacter` 清洗文件名非法字符，无权限请求代码。

### 权限与失败处理
- 若用户把 `downloadPath` 改成真正的公共 `Download/` 根（`/storage/emulated/0/Download/`），在 Android 11+ 作用域存储下会 **写入失败**，`downloader.ts` 捕获异常后发 `DownloadFailReason.NoWritePermission`——**但它既不请求权限，也不回退到 MediaStore/SAF**。
- 结论：**MusicFree 只能在「应用专属外部目录」零权限工作；默认配置下它根本不支持把文件存到系统公共目录**。

## 二、微阅的文件保存方案（现状）

- **Expo / RN 0.85**，核心在 `src/services/export-service.ts`
- 目标：**像微信一样静默保存到公共 `Download/微阅/`**，让系统文件管理器/所有应用直接可见
- 保存链路（v2.0.23）：
  1. **S1 MediaStore.Downloads 静默保存**（零权限写公共 Download，对标微信）——联想 Android 16 OEM 限制时返回空
  2. **S2 已授权 SAF treeUri 静默写入**（`expo-file-system/legacy` 官方 SAF API，持久化权限）
  3. **S3 SAF 目录选择器**（不设 Download 根，避免 Android 11+ 限制）
  4. **S4 诊断弹窗**（透出每步真实错误）

## 三、关键差异对比

| 维度 | MusicFree | 微阅 |
|------|-----------|------|
| 目标目录 | 应用专属外部存储 `/Android/data/<pkg>/files/download/music/` | 公共 `Download/微阅/`（对标微信） |
| 文件可见性 | 文件管理器需进 `Android/data/<pkg>/` 才能看到；卸载应用即清除 | 所有应用/文件管理器直接可见，卸载仍在 |
| 存储权限 | **零权限**（依赖 ExternalDirectoryPath 作用域合规） | **零权限**（MediaStore / SAF） |
| 是否进公共 Download | **不支持**（无 MediaStore/SAF 适配） | **支持**（核心诉求，MediaStore 优先） |
| 用户可配置路径 | 支持 `basic.downloadPath` | 目前硬编码 `Download/微阅/`（可加配置） |
| 失败兜底 | 报 `NoWritePermission` 即止 | 多级兜底 + 诊断弹窗 |
| 文件名清洗 | `escapeCharacter` 正则清洗 | 需对齐（可借鉴） |
| 递归建目录 | `mkdirR` | 由 expo-file-system/legacy SAF API 处理 |

## 四、结论与对微阅的启示

1. **MusicFree 的「零权限写 ExternalDirectoryPath」是 Android 上最简单稳妥的方案**，但它把文件藏在 `Android/data/<pkg>/files/` 下——用户要进这个目录才能找到，且不算「公共 Download」。这**不满足微阅"像微信一样直接存到本地、用户一眼能找到"的诉求**。

2. **微阅走 MediaStore + SAF 进公共 Download 的方向正确、更激进、更贴合诉求**。MusicFree 因为没做 MediaStore/SAF，一旦用户改到公共目录就失败，恰好反证了微阅双通道方案的必要性。

3. **可借鉴 MusicFree 的工程细节**：
   - `escapeCharacter` 文件名清洗（`/ / \ ? * " < > :` → `_`），防止 OEM/特殊书名导致建文件失败；
   - 下载先写缓存再 `copyFile` 到目标，避免半截文件；
   - 给路径统一加 `file://` scheme 的 `addFileScheme` 思路。

4. **建议微阅增加一个「应用专属目录」最稳兜底**：当 MediaStore 与 SAF 都失败（极端 OEM）时，退而存到 `expo-file-system` 的 `documentDirectory`（Expo 对应 `RNFS.ExternalDirectoryPath` 的等价目录）下 `/微阅/`，保证文件至少落盘、用户能在 `Android/data/<pkg>/files/` 找到，而不是完全失败。

5. 微阅当前的「MediaStore 优先 + SAF 持久兜底 + 选择器 + 诊断弹窗」四级策略，相比 MusicFree 的单一 RNFS 写入 + 失败即止，对 Android 碎片化（尤其联想这类限制 MediaStore 的 OEM）更鲁棒。
