package com.yuewei.app.filesaver;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.module.annotations.ReactModule;

import java.io.File;
import java.io.FileInputStream;
import java.io.OutputStream;

/**
 * React Native NativeModule — 使用 MediaStore.Downloads 静默保存文件到 Downloads/微阅/
 * 适配 targetSdk 36 + RN 0.85 新架构，无需任何存储权限。
 */
@ReactModule(name = "FileSaverModule")
public class FileSaverModule extends ReactContextBaseJavaModule {

    private final Context context;

    public FileSaverModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.context = reactContext.getApplicationContext();
    }

    @NonNull
    @Override
    public String getName() {
        return "FileSaverModule";
    }

    /**
     * 保存文件到 Downloads/微阅/ 目录（Android 10+ 走 MediaStore，零权限零交互）。
     *
     * @param sourcePath 源文件路径（支持 file:// URI 或绝对路径）
     * @param fileName   目标文件名（含扩展名）
     * @param mimeType   MIME 类型
     */
    @ReactMethod
    public void saveFile(String sourcePath, String fileName, String mimeType, Promise promise) {
        try {
            // 处理 file:// URI：expo-file-system 的 uri 返回 file:// 前缀
            String realPath = sourcePath;
            if (realPath.startsWith("file://")) {
                realPath = realPath.substring(7);
            }

            File sourceFile = new File(realPath);
            if (!sourceFile.exists()) {
                promise.reject("FILE_NOT_FOUND",
                    "源文件不存在: " + realPath + " (original: " + sourcePath + ")");
                return;
            }

            Uri uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                // 先尝试写入 Downloads/微阅 子文件夹
                uri = insertAndWrite(fileName, mimeType, sourceFile,
                    Environment.DIRECTORY_DOWNLOADS + "/微阅");
                // 子文件夹失败（部分 OEM 限制 RELATIVE_PATH 子目录）→ 退回 Downloads 根目录
                if (uri == null) {
                    uri = insertAndWrite(fileName, mimeType, sourceFile,
                        Environment.DIRECTORY_DOWNLOADS);
                }
            } else {
                uri = saveUsingLegacy(fileName, sourceFile);
            }

            if (uri != null) {
                promise.resolve(uri.toString());
            } else {
                promise.reject("SAVE_FAILED",
                    "MediaStore 插入返回 null（系统拒绝写入 Downloads，可能是 OEM 限制）");
            }
        } catch (Exception e) {
            promise.reject("SAVE_ERROR", e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /**
     * 通过 MediaStore.Downloads 插入并写入文件。
     * @param relativePath 形如 "Download" 或 "Download/微阅"
     * @return 成功返回文件 Uri，失败返回 null（不抛异常，由调用方决定兜底）
     */
    private Uri insertAndWrite(String fileName, String mimeType, File sourceFile, String relativePath) {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, relativePath);
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            Uri uri = context.getContentResolver().insert(
                MediaStore.Downloads.EXTERNAL_CONTENT_URI, values
            );
            if (uri == null) return null;

            try {
                OutputStream outputStream = context.getContentResolver().openOutputStream(uri);
                FileInputStream inputStream = new FileInputStream(sourceFile);

                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = inputStream.read(buffer)) != -1) {
                    outputStream.write(buffer, 0, bytesRead);
                }

                inputStream.close();
                outputStream.flush();
                outputStream.close();

                // 标记写入完成，系统文件管理器立即可见
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                context.getContentResolver().update(uri, values, null, null);

                return uri;
            } catch (Exception e) {
                // 写入失败：清理半文件，返回 null 触发兜底
                try { context.getContentResolver().delete(uri, null, null); } catch (Exception ignored) {}
                return null;
            }
        } catch (Exception e) {
            return null;
        }
    }

    private Uri saveUsingLegacy(String fileName, File sourceFile) throws Exception {
        File downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        File yueweiDir = new File(downloadDir, "微阅");
        if (!yueweiDir.exists()) {
            yueweiDir.mkdirs();
        }

        File destFile = new File(yueweiDir, fileName);
        FileInputStream inputStream = new FileInputStream(sourceFile);
        java.io.FileOutputStream outputStream = new java.io.FileOutputStream(destFile);

        byte[] buffer = new byte[8192];
        int bytesRead;
        while ((bytesRead = inputStream.read(buffer)) != -1) {
            outputStream.write(buffer, 0, bytesRead);
        }

        inputStream.close();
        outputStream.flush();
        outputStream.close();

        return Uri.fromFile(destFile);
    }

    /**
     * 通过 Storage Access Framework 将文件写入用户授权的目录树下的「微阅」子文件夹。
     * 适用于 Android 11+ / API 36：无需任何存储权限，依赖用户一次性授予的 treeUri。
     *
     * @param treeUri     用户通过 SAF 授权的目录树 Uri（如 Download 的 tree Uri）
     * @param sourcePath  源文件绝对路径（支持 file:// 前缀）
     * @param fileName    目标文件名（含扩展名）
     * @param mimeType    MIME 类型
     */
    @ReactMethod
    public void saveToSafTree(String treeUri, String sourcePath, String fileName, String mimeType, Promise promise) {
        try {
            String realPath = sourcePath.startsWith("file://") ? sourcePath.substring(7) : sourcePath;
            File sourceFile = new File(realPath);
            if (!sourceFile.exists()) {
                promise.reject("FILE_NOT_FOUND", "源文件不存在: " + realPath);
                return;
            }

            Uri tree = Uri.parse(treeUri);
            ContentResolver cr = context.getContentResolver();
            String rootDocId = DocumentsContract.getTreeDocumentId(tree);
            String safeMime = (mimeType == null || mimeType.isEmpty()) ? "application/octet-stream" : mimeType;

            // 1) 找到或创建「微阅」子文件夹
            Uri yueweiUri = findOrCreateDir(tree, rootDocId, "微阅");
            if (yueweiUri == null) {
                promise.reject("MKDIR_FAILED", "无法创建或找到 微阅 子文件夹");
                return;
            }
            String yueweiDocId = DocumentsContract.getDocumentId(yueweiUri);

            // 2) 若同名文件已存在则删除（覆盖写入）
            Uri existing = findChildByName(tree, yueweiDocId, fileName);
            if (existing != null) {
                try {
                    DocumentsContract.deleteDocument(cr, existing);
                } catch (Exception ignored) {
                }
            }

            // 3) 创建目标文件
            Uri fileUri = DocumentsContract.createDocument(cr, yueweiUri, safeMime, fileName);
            if (fileUri == null) {
                promise.reject("CREATE_FAILED", "无法创建文件: " + fileName);
                return;
            }

            // 4) 写入内容
            try (OutputStream os = cr.openOutputStream(fileUri);
                 FileInputStream is = new FileInputStream(sourceFile)) {
                byte[] buffer = new byte[8192];
                int bytesRead;
                while ((bytesRead = is.read(buffer)) != -1) {
                    os.write(buffer, 0, bytesRead);
                }
            }

            promise.resolve(fileUri.toString());
        } catch (Exception e) {
            promise.reject("SAF_WRITE_ERROR", e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    /** 在指定父文档下查找名为 name 的子文档，找不到返回 null */
    private Uri findChildByName(Uri tree, String parentDocId, String name) {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentDocId);
        try (Cursor c = context.getContentResolver().query(
                childrenUri,
                new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID},
                DocumentsContract.Document.COLUMN_DISPLAY_NAME + "=?",
                new String[]{name},
                null)) {
            if (c != null && c.moveToFirst()) {
                String docId = c.getString(0);
                return DocumentsContract.buildDocumentUriUsingTree(tree, docId);
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    /** 在指定父文档下找到或创建名为 name 的子文件夹，返回其 Uri */
    private Uri findOrCreateDir(Uri tree, String parentDocId, String name) throws Exception {
        Uri existing = findChildByName(tree, parentDocId, name);
        if (existing != null) return existing;
        Uri parentUri = DocumentsContract.buildDocumentUriUsingTree(tree, parentDocId);
        return DocumentsContract.createDocument(
                context.getContentResolver(), parentUri,
                DocumentsContract.Document.MIME_TYPE_DIR, name);
    }
}
