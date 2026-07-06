import { NativeModules, Platform } from 'react-native';

/**
 * 文件保存模块 — 使用 MediaStore.Downloads 静默保存到 Downloads/微阅/。
 * 基于标准 React Native NativeModule。
 */

const FileSaver = NativeModules.FileSaverModule;

/**
 * 保存文件到 Downloads/微阅/ 目录（静默保存，零权限零交互）。
 *
 * @param sourcePath 源文件路径（file:// URI 或绝对路径）
 * @param fileName   目标文件名（含扩展名）
 * @param mimeType   MIME 类型
 * @returns 保存后的 content:// URI，失败或不可用时返回 null
 */
export async function saveToDownloadsAsync(
  sourcePath: string,
  fileName: string,
  mimeType: string,
): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  if (!FileSaver) {
    console.warn('[FileSaver] NativeModules.FileSaverModule not available');
    return null;
  }

  try {
    // 双保险：JS 侧也剥离 file:// 前缀
    const cleanPath = sourcePath.startsWith('file://')
      ? sourcePath.substring(7)
      : sourcePath;

    return await FileSaver.saveFile(cleanPath, fileName, mimeType);
  } catch (e) {
    console.warn('[FileSaver] saveFile failed:', e);
    return null;
  }
}

/** 当前平台是否支持静默保存到 Downloads */
export function isSaveToDownloadsAvailable(): boolean {
  return Platform.OS === 'android' && !!FileSaver;
}

/**
 * 通过 Storage Access Framework 将文件写入用户授权的目录树下的「微阅」子文件夹。
 * 依赖用户一次性授予的 treeUri（由 expo-file-system 的 SAF 授权返回）。
 *
 * @param treeUri     用户授权的目录树 Uri（如 Download 的 tree Uri）
 * @param sourcePath  源文件路径（file:// URI 或绝对路径）
 * @param fileName    目标文件名（含扩展名）
 * @param mimeType    MIME 类型
 * @returns 保存后的 content:// URI，失败或不可用时返回 null
 */
export async function saveToSafTreeAsync(
  treeUri: string,
  sourcePath: string,
  fileName: string,
  mimeType: string,
): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  if (!FileSaver || !treeUri) {
    console.warn('[FileSaver] saveToSafTree 不可用: FileSaver=' + !!FileSaver + ', treeUri=' + !!treeUri);
    return null;
  }

  try {
    // 双保险：JS 侧也剥离 file:// 前缀
    const cleanPath = sourcePath.startsWith('file://')
      ? sourcePath.substring(7)
      : sourcePath;

    return await FileSaver.saveToSafTree(treeUri, cleanPath, fileName, mimeType);
  } catch (e) {
    console.warn('[FileSaver] saveToSafTree failed:', e);
    return null;
  }
}

export default { saveToDownloadsAsync, isSaveToDownloadsAvailable, saveToSafTreeAsync };
