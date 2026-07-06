package expo.modules.filesaver

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileInputStream

class ExpoFileSaverModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ExpoFileSaver")

    /**
     * Save a file to the Downloads directory using MediaStore API.
     * No permissions required on Android 10+.
     *
     * @param sourceUri Local file:// URI of the file to save
     * @param fileName Target filename (e.g. "book.pdf")
     * @param mimeType MIME type (e.g. "application/pdf")
     * @return The content:// URI of the saved file
     */
    AsyncFunction("saveToDownloadsAsync") { sourceUri: String, fileName: String, mimeType: String, promise: Promise ->
      try {
        val sourcePath = sourceUri.removePrefix("file://")
        val sourceFile = File(sourcePath)

        if (!sourceFile.exists()) {
          promise.reject(
            "FILE_NOT_FOUND",
            "Source file not found: $sourcePath",
            null
          )
          return@AsyncFunction
        }

        val uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          saveUsingMediaStore(fileName, mimeType, sourceFile)
        } else {
          saveUsingLegacyMethod(fileName, sourceFile)
        }

        if (uri != null) {
          promise.resolve(uri.toString())
        } else {
          promise.reject(
            "SAVE_FAILED",
            "Failed to save file to Downloads",
            null
          )
        }
      } catch (e: Exception) {
        promise.reject(
          "SAVE_ERROR",
          "Error saving file: ${e.message}",
          e
        )
      }
    }
  }

  /**
   * Android 10+ (API 29+): Use MediaStore.Downloads
   * Zero permissions required for own files.
   */
  private fun saveUsingMediaStore(fileName: String, mimeType: String, sourceFile: File): android.net.Uri? {
    val resolver = context.contentResolver

    val contentValues = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, fileName)
      put(MediaStore.Downloads.MIME_TYPE, mimeType)
      put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/微阅")
      put(MediaStore.Downloads.IS_PENDING, 1)
    }

    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, contentValues)
      ?: return null

    try {
      resolver.openOutputStream(uri)?.use { outputStream ->
        FileInputStream(sourceFile).use { inputStream ->
          inputStream.copyTo(outputStream)
        }
      }

      // Mark as complete so the system indexes the file
      contentValues.clear()
      contentValues.put(MediaStore.Downloads.IS_PENDING, 0)
      resolver.update(uri, contentValues, null, null)

      return uri
    } catch (e: Exception) {
      // Clean up the failed entry
      try { resolver.delete(uri, null, null) } catch (_: Exception) {}
      throw e
    }
  }

  /**
   * Legacy method for Android 9 and below (API < 29).
   */
  private fun saveUsingLegacyMethod(fileName: String, sourceFile: File): android.net.Uri? {
    val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
    val yueweiDir = File(downloadsDir, "微阅")
    if (!yueweiDir.exists()) {
      yueweiDir.mkdirs()
    }

    val destFile = File(yueweiDir, fileName)
    sourceFile.copyTo(destFile, overwrite = true)

    return android.net.Uri.fromFile(destFile)
  }
}
