import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';


let crashLog: { record(source: 'boundary', error: unknown): Promise<void> } | null = null;
function getCrashLog() {
  if (!crashLog) {
    // 惰性解析：模块加载时组合根尚未装配（_layout 先 import 本文件），快照会永久拿到空对象（issue #31）
    crashLog =
      (globalThis as { __talecastServices?: { crashLog?: { record(source: 'boundary', error: unknown): Promise<void> } } })
        .__talecastServices?.crashLog ?? null;
  }
  return crashLog;
}

/**
 * 全局错误边界（v0.8.0）：渲染异常不再白屏，给出可操作的兜底界面。
 * 挂载于 app/_layout.tsx 根部，包住全部路由。
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
    void getCrashLog()?.record('boundary', error);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-paper px-8 dark:bg-paper-night">
        <Text className="font-serif text-xl font-bold text-ink dark:text-ink-night">
          出错了
        </Text>
        <Text className="text-center text-sm text-muted dark:text-muted-night" numberOfLines={6}>
          {this.state.error.message || '发生未知渲染错误'}
        </Text>
        <Pressable
          className="rounded-xl bg-accent px-6 py-3 active:bg-accent-deep"
          onPress={() => this.setState({ error: null })}
        >
          <Text className="font-semibold text-white">重试</Text>
        </Pressable>
        <Text className="text-center text-xs text-faint">
          重试无效请重启应用；书籍与进度数据不受影响
        </Text>
      </View>
    );
  }
}
