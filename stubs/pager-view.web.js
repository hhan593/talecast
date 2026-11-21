/**
 * react-native-pager-view 的 web 平台 stub（issue #93）。
 * 该库只发布 android/ios 原生实现（无 web 构建），web 端打包会引到
 * PagerViewNativeComponent 的 codegenNativeCommands —— react-native-web
 * 无此导出，整包崩溃。web 是预览/自测面：翻页模式在 web 降级为
 * 简单纵向堆叠容器（阅读器自测请用「上下/滚动」模式），原生端不受影响。
 * 接线见 metro.config.js resolveRequest。
 */
import React from 'react';
import { View } from 'react-native';

class PagerView extends React.Component {
  setPage() {}
  setPageWithoutAnimation() {}
  render() {
    const { children, style } = this.props;
    return (
      <View style={[{ flex: 1 }, style]}>
        {Array.isArray(children) ? children[0] : children}
      </View>
    );
  }
}

export default PagerView;
