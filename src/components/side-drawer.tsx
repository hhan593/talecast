import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

/**
 * 左/右侧滑出抽屉（issue #62 书架左抽屉 + issue #65 详情页右抽屉共用）。
 * 半屏（78% 宽）+ 半透明遮罩，200ms 滑入/滑出 + 遮罩渐隐；收起态不挡下层触摸。
 * 面板底色/圆角随侧向固定，内容由 children 注入（调用方自带内边距与条目）。
 */
export function SideDrawer(props: {
  side: 'left' | 'right';
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const anim = useRef(new Animated.Value(0)).current; // 0 收起 → 1 展开
  // 面板实测宽度（issue #121）：原生驱动不支持 % 字符串插值（静默失效 →
  // 面板不可见但触摸层仍拦截点击），隐藏偏移必须用数值像素
  const [panelWidth, setPanelWidth] = useState(0);

  useEffect(() => {
    Animated.timing(anim, { toValue: props.open ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [props.open, anim]);

  const fromLeft = props.side === 'left';
  return (
    <View pointerEvents={props.open ? 'auto' : 'none'} className="absolute inset-0" style={styles.layer}>
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: '#000000', opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] }) }]}
      >
        <Pressable accessibilityRole="button" style={StyleSheet.absoluteFill} onPress={props.onClose} />
      </Animated.View>
      <Animated.View
        className={`absolute inset-y-0 w-[78%] bg-paper px-5 pb-6 pt-16 dark:bg-paper-night ${
          fromLeft ? 'left-0 rounded-r-2xl' : 'right-0 rounded-l-2xl'
        }`}
        onLayout={(e) => setPanelWidth(e.nativeEvent.layout.width)}
        style={{
          transform: [
            {
              // 隐藏偏移 = 实测宽度 × 1.1（数值像素，原生驱动可用）：
              // 收起时完全离屏，open 状态与视觉严格一致（issue #121）
              translateX: anim.interpolate({
                inputRange: [0, 1],
                outputRange: fromLeft ? [-panelWidth * 1.1, 0] : [panelWidth * 1.1, 0],
              }),
            },
          ],
        }}
      >
        {props.children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 抽屉层抬到同屏列表/卡片之上
  layer: { zIndex: 50 },
});
