/**
 * 文件保存桥接层 — 统一访问自定义原生模块 FileSaverModule。
 *
 * 唯一生效的原生实现：
 *   android/app/src/main/java/com/weiyue/app/filesaver/FileSaverModule.java
 *   由 android/app/src/main/java/com/weiyue/app/MainApplication.kt 中
 *   手工注册的 FileSaverPackage 提供 NativeModules.FileSaverModule。
 *
 * 说明：历史上 modules/expo-file-saver 下另有一份 Kotlin Expo 模块
 * （ExpoFileSaver），但 JS 侧从未调用 requireNativeModule('ExpoFileSaver')，
 * 属于死代码，已移除。保存策略的四级降级见 export-service.ts。
 */
import { NativeModules, Platform } from 'react-native';

interface FileSaverNative {
  saveFile(sourcePath: string, fileName: string, mimeType: string): Promise<string | null>;
  saveToSafTree(
    treeUri: string,
    sourcePath: string,
    fileName: string,
    mimeType: string,
  ): Promise<string | null>;
}

const FileSaver = NativeModules.FileSaverModule as FileSaverNative | undefined;

/** 当前平台是否可静默保存到公共下载目录 */
export function isSaveToDownloadsAvailable(): boolean {
  return Platform.OS === 'android' && !!FileSaver;
}

function stripFileScheme(path: string): string {
  return path.startsWith('file://') ? path.substring(7) : path;
}

/**
 * S1 主路径：MediaStore.Downloads 静默保存到 Download/微阅/。
 * Android 10+ 零权限、零交互；失败返回 null，由调用方降级到 SAF。
 */
export async function saveToDownloadsAsync(
  sourcePath: string,
  fileName: string,
  mimeType: string,
): Promise<string | null> {
  if (!isSaveToDownloadsAvailable() || !FileSaver) return null;

  try {
    return await FileSaver.saveFile(stripFileScheme(sourcePath), fileName, mimeType);
  } catch (e) {
    console.warn('[FileSaver] saveFile failed:', e);
    return null;
  }
}

/**
 * S2 备用：写入用户已授权的 SAF 目录树下的「微阅」子目录。
 * 注意：当前 export-service.ts 的 safWriteFile 走 Expo 官方 SAF API，
 * 此接口保留给需要原生 DocumentsContract 写入的场景。
 */
export async function saveToSafTreeAsync(
  treeUri: string,
  sourcePath: string,
  fileName: string,
  mimeType: string,
): Promise<string | null> {
  if (Platform.OS !== 'android' || !FileSaver || !treeUri) return null;

  try {
    return await FileSaver.saveToSafTree(treeUri, stripFileScheme(sourcePath), fileName, mimeType);
  } catch (e) {
    console.warn('[FileSaver] saveToSafTree failed:', e);
    return null;
  }
}

export default { saveToDownloadsAsync, isSaveToDownloadsAvailable, saveToSafTreeAsync };
