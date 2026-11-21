const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// react-native-track-player 的 web 分支引入 shaka-player（仅 web 需要），
// Android/iOS 构建时 Metro 会静态解析该 import 导致打包失败：返回空模块
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('shaka-player')) {
    return { type: 'empty' };
  }
  // react-native-pager-view 无 web 构建（codegenNativeCommands 崩溃），web 端用 stub（issue #93）
  if (platform === 'web' && moduleName === 'react-native-pager-view') {
    return { filePath: require('node:path').join(__dirname, 'stubs/pager-view.web.js'), type: 'sourceFile' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

// expo-sqlite web（issue #93）：worker 引用 .wasm 需注册为资产类型；
// SharedArrayBuffer 需要跨源隔离（COOP/COEP）响应头，否则 web 端 SQLite 无法初始化。
// 注意：enhanceMiddleware 必须挂在 withNativeWind 之后（其返回会重置 server 配置）
config.resolver.assetExts.push('wasm');
const nativewindConfig = withNativeWind(config, { input: './global.css' });
nativewindConfig.server = {
  ...nativewindConfig.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    middleware(req, res, next);
  },
};

module.exports = nativewindConfig;
