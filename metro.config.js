const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// react-native-track-player 的 web 分支引入 shaka-player（仅 web 需要），
// Android/iOS 构建时 Metro 会静态解析该 import 导致打包失败：返回空模块
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('shaka-player')) {
    return { type: 'empty' };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
