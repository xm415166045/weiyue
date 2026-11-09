/**
 * 微阅 Expo Config Plugin
 *
 * 在 expo prebuild 后自动注入以下配置：
 *   1. AndroidManifest.xml: 添加 FileProvider（用于 expo-sharing 分享文件）
 *   2. res/xml/file_paths.xml: FileProvider 路径配置
 *   3. 自定义文件保存原生模块：从 plugins/native/ 恢复 Java 源码，并在
 *      MainApplication.kt 中注册 FileSaverPackage
 *
 * 使用方式：app.json 中已自动引用
 *
 * 注意：不再注入任何存储权限（READ/WRITE/MANAGE_EXTERNAL_STORAGE）。
 * 文件保存使用 MediaStore.Downloads（FileSaverModule）+ SAF 降级，
 * 均无需存储权限，适配 targetSdk 36。
 *
 * 为什么有第 3 步：android/ 目录在 .gitignore 中被忽略，且 expo prebuild
 * 可能重新生成原生工程。把自定义模块源码放在 plugins/native/（受版本控制），
 * 由本插件在每次 prebuild 时幂等恢复，避免换机器 / 重建工程后编译失败。
 */
const { withAndroidManifest, withInfoPlist, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/** iPhone / iPad 均允许四个方向（app.json 的 orientation="default"） */
const IOS_ORIENTATIONS = [
  'UIInterfaceOrientationPortrait',
  'UIInterfaceOrientationPortraitUpsideDown',
  'UIInterfaceOrientationLandscapeLeft',
  'UIInterfaceOrientationLandscapeRight',
];

/**
 * 注入 AndroidManifest.xml 修改：
 * - 添加 FileProvider 注册（用于 expo-sharing）
 */
function withAndroidManifestPlugin(config) {
  return withAndroidManifest(config, async (config) => {
    const manifest = config.modResults.manifest;

    // 清理历史遗留的外部存储权限：文件保存已走 MediaStore.Downloads + SAF，
    // targetSdk 36 下不需要 READ/WRITE_EXTERNAL_STORAGE。
    const legacyStoragePermissions = [
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ];
    if (Array.isArray(manifest['uses-permission'])) {
      manifest['uses-permission'] = manifest['uses-permission'].filter(
        (p) => !legacyStoragePermissions.includes(p?.$?.['android:name']),
      );
    }

    // 强制 MainActivity 不锁定方向：android/ 被 .gitignore 忽略，
    // 必须靠插件在每次 prebuild 时保证配置，否则换机器会退回竖屏。
    const activities = manifest.application?.[0]?.activity;
    if (Array.isArray(activities)) {
      for (const activity of activities) {
        if (activity?.$?.['android:name'] === '.MainActivity') {
          activity.$['android:screenOrientation'] = 'unspecified';
        }
      }
    }

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
 * 注入 res/xml/file_paths.xml，并恢复 / 注册自定义文件保存原生模块。
 */
function withAndroidNativeSources(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const androidRoot = config.modRequest.platformProjectRoot;
      const projectRoot = config.modRequest.projectRoot;

      // ---- 1. FileProvider 路径配置 ----
      const resXmlDir = path.join(androidRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(resXmlDir, { recursive: true });

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

      // ---- 2. 恢复自定义原生模块源码（plugins/native/ 为唯一真源）----
      const templateDir = path.join(projectRoot, 'plugins', 'native');
      const targetDir = path.join(
        androidRoot, 'app', 'src', 'main', 'java', 'com', 'yuewei', 'app', 'filesaver',
      );
      if (fs.existsSync(templateDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        for (const name of ['FileSaverModule.java', 'FileSaverPackage.java']) {
          const src = path.join(templateDir, name);
          if (fs.existsSync(src)) {
            fs.copyFileSync(src, path.join(targetDir, name));
          }
        }
      } else {
        console.warn('[微阅 plugin] 缺少 plugins/native/，自定义文件保存模块未恢复');
      }

      // ---- 3. 幂等注册 FileSaverPackage ----
      const mainApp = path.join(
        androidRoot, 'app', 'src', 'main', 'java', 'com', 'yuewei', 'app', 'MainApplication.kt',
      );
      if (fs.existsSync(mainApp)) {
        let kt = fs.readFileSync(mainApp, 'utf8');
        let changed = false;

        if (!kt.includes('com.yuewei.app.filesaver.FileSaverPackage')) {
          kt = kt.replace(
            /(package com\.yuewei\.app[^\n]*\n)/,
            '$1\nimport com.yuewei.app.filesaver.FileSaverPackage\n',
          );
          changed = true;
        }

        if (!kt.includes('add(FileSaverPackage())')) {
          const anchor = 'PackageList(this).packages.apply {';
          if (kt.includes(anchor)) {
            kt = kt.replace(
              anchor,
              anchor +
                '\n          // 自定义原生模块：文件静默保存到 Downloads/微阅/\n' +
                '          add(FileSaverPackage())',
            );
            changed = true;
          } else {
            console.warn(
              '[微阅 plugin] MainApplication.kt 结构已变化，请手工注册 FileSaverPackage',
            );
          }
        }

        if (changed) fs.writeFileSync(mainApp, kt, 'utf8');
      }

      return config;
    },
  ]);
}

/**
 * 幂等注入 iOS 方向配置（Info.plist 同样位于被忽略的 ios/ 目录）。
 */
function withIosOrientations(config) {
  return withInfoPlist(config, (config) => {
    config.modResults.UISupportedInterfaceOrientations = [...IOS_ORIENTATIONS];
    config.modResults['UISupportedInterfaceOrientations~ipad'] = [...IOS_ORIENTATIONS];
    return config;
  });
}

/**
 * 组合所有插件
 */
module.exports = function withYuewei(config) {
  config = withAndroidManifestPlugin(config);
  config = withIosOrientations(config);
  config = withAndroidNativeSources(config);
  return config;
};
