/**
 * 微阅 Expo Config Plugin
 *
 * 在 expo prebuild 后自动注入以下配置：
 *   1. AndroidManifest.xml: 添加 FileProvider（用于 expo-sharing 分享文件）
 *   2. res/xml/file_paths.xml: FileProvider 路径配置
 *
 * 使用方式：app.json 中已自动引用
 *
 * 注意：不再注入任何存储权限（READ/WRITE/MANAGE_EXTERNAL_STORAGE）。
 * 文件保存使用 MediaStore.Downloads（expo-file-saver 原生模块）+ SAF 降级，
 * 均无需存储权限，适配 targetSdk 36。
 */
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * 注入 AndroidManifest.xml 修改：
 * - 添加 FileProvider 注册（用于 expo-sharing）
 */
function withAndroidManifestPlugin(config) {
  return withAndroidManifest(config, async (config) => {
    const manifest = config.modResults.manifest;

    // 获取 application 节点
    const app = manifest.application;
    if (!app || !Array.isArray(app) || app.length === 0) return config;

    const appEl = app[0];

    // 检查是否已有主 FileProvider
    const providers = appEl.provider || [];
    const hasFileProvider = Array.isArray(providers)
      ? providers.some((p) => p.$ && p.$['android:name'] === 'androidx.core.content.FileProvider')
      : providers.$ && providers.$['android:name'] === 'androidx.core.content.FileProvider';

    if (!hasFileProvider) {
      const fileProvider = {
        $: {
          'android:name': 'androidx.core.content.FileProvider',
          'android:authorities': '${applicationId}.fileprovider',
          'android:exported': 'false',
          'android:grantUriPermissions': 'true',
        },
        'meta-data': [
          {
            $: {
              'android:name': 'android.support.FILE_PROVIDER_PATHS',
              'android:resource': '@xml/file_paths',
            },
          },
        ],
      };

      if (!Array.isArray(appEl.provider)) {
        appEl.provider = appEl.provider ? [appEl.provider, fileProvider] : [fileProvider];
      } else {
        appEl.provider.push(fileProvider);
      }
    }

    return config;
  });
}

/**
 * 注入 res/xml/file_paths.xml
 */
function withFilePathsXml(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const resXmlDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );

      if (!fs.existsSync(resXmlDir)) {
        fs.mkdirSync(resXmlDir, { recursive: true });
      }

      const filePathsXml = path.join(resXmlDir, 'file_paths.xml');

      if (!fs.existsSync(filePathsXml)) {
        const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <files-path name="internal_files" path="."/>
    <cache-path name="internal_cache" path="."/>
    <external-files-path name="external_files" path="."/>
    <external-cache-path name="external_cache" path="."/>
    <files-path name="yuewei_export" path="yuewei-export/"/>
    <files-path name="covers" path="covers/"/>
</paths>`;
        fs.writeFileSync(filePathsXml, xmlContent, 'utf-8');
      }

      return config;
    },
  ]);
}

/**
 * 组合所有插件
 */
module.exports = function withYuewei(config) {
  config = withAndroidManifestPlugin(config);
  config = withFilePathsXml(config);
  return config;
};
