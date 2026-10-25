'use strict';

const path = require('node:path');
const rcedit = require('rcedit');

/**
 * electron-builder 在 Windows 上编辑 exe 资源需要 winCodeSign 里的符号链接，
 * 普通用户权限解压会失败；这里改用 npm 的 rcedit 做同样的图标/版本替换。
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exe = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );
  const icon = path.join(__dirname, '..', 'assets', 'icon.ico');
  await rcedit(exe, {
    icon,
    'version-string': {
      FileDescription: 'iOS Folder Widget',
      ProductName: 'iOS Folder Widget',
      CompanyName: 'ios-folder-widget contributors',
      LegalCopyright: 'Copyright © 2026 ios-folder-widget contributors',
      OriginalFilename: 'iOS Folder Widget.exe',
    },
    'file-version': context.packager.appInfo.version,
    'product-version': context.packager.appInfo.version,
  });
};
