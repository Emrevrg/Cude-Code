module.exports = {
  appId: 'dev.codiente.cli',
  productName: 'Codiente',
  directories: { output: 'dist-packages' },
  files: [
    'dist-electron/**/*',
    'dist-renderer/**/*',
    'dist/**/*',
    'node_modules/**/*',
    'package.json',
  ],
  win: {
    target: 'nsis',
    icon: 'assets/icon.ico',
  },
  mac: {
    target: 'dmg',
    icon: 'assets/icon.icns',
    category: 'public.app-category.developer-tools',
  },
  linux: {
    target: 'AppImage',
    icon: 'assets/icon.png',
    category: 'Development',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
};
