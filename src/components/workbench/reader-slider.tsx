import { useMemo, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent } from 'react-native';

/**
 * 阅读器章节拖动条（v0.8.0 P1-②）：纯 Responder 手势实现（不引入原生 Slider 依赖）。
 * 拖动中 onPreview 实时回报位置（父级显示章名预览），松手 onCommit 跳章。
 */
interface ReaderSliderProps {
  /** 当前值（0 起） */
  value: number;
  /** 最大值（章节数-1；单章时传 0 禁用拖动） */
  max: number;
  trackColor: string;
  fillColor: string;
  thumbColor: string;
  /** 拖动中（含按下）实时位置 */
  onPreview(index: number): void;
  /** 松手提交跳转 */
  onCommit(index: number): void;
}

const THUMB_SIZE = 14;

export function ReaderSlider(props: ReaderSliderProps) {
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [dragIndex, setDragIndex] = useState(0);

  const clamp = useMemo(
    () => (x: number) => {
      if (width <= 0 || props.max <= 0) return props.value;
      const ratio = Math.min(Math.max(x / width, 0), 1);
      return Math.round(ratio * props.max);
    },
    [width, props.max, props.value],
  );

  const indexFrom = (event: GestureResponderEvent): number =>
    clamp(event.nativeEvent.locationX);

  const responderProps = {
    onStartShouldSetResponder: () => props.max > 0,
    onMoveShouldSetResponder: () => props.max > 0,
    onResponderGrant: (event: GestureResponderEvent) => {
      if (props.max <= 0) return;
      const index = indexFrom(event);
      setDragging(true);
      setDragIndex(index);
      props.onPreview(index);
    },
    onResponderMove: (event: GestureResponderEvent) => {
      if (props.max <= 0) return;
      const index = indexFrom(event);
      setDragIndex(index);
      props.onPreview(index);
    },
    onResponderRelease: (event: GestureResponderEvent) => {
      if (props.max <= 0) return;
      setDragging(false);
      props.onCommit(indexFrom(event));
    },
    onResponderTerminate: () => setDragging(false),
  };

  const activeIndex = dragging ? dragIndex : props.value;
  const ratio = props.max <= 0 ? 0 : Math.min(Math.max(activeIndex / props.max, 0), 1);

  return (
    <View
      style={styles.trackWrap}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      {...responderProps}
    >
      <View style={[styles.track, { backgroundColor: props.trackColor }]} />
      <View
        style={[
          styles.fill,
          { backgroundColor: props.fillColor, width: `${ratio * 100}%` as `${number}%` },
        ]}
      />
      <View
        style={[
          styles.thumb,
          { backgroundColor: props.thumbColor, left: `${ratio * 100}%` as `${number}%` },
          dragging ? styles.thumbActive : null,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  trackWrap: {
    flex: 1,
    height: 36,
    justifyContent: 'center',
  },
  track: {
    height: 3,
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    height: 3,
    borderRadius: 1.5,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    marginLeft: -THUMB_SIZE / 2,
  },
  thumbActive: {
    transform: [{ scale: 1.3 }],
  },
});
