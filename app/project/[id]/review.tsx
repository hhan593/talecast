import { Text, View } from 'react-native';

/** 候选审阅 modal（docs/plan.md 5.5）：人工关口，可随时取消；分章/角色候选随 P1/P2 接入。 */
export default function ReviewModal() {
  return (
    <View className="flex-1 items-center justify-center bg-zinc-50 px-6 dark:bg-zinc-950">
      <Text className="text-base font-semibold text-zinc-800 dark:text-zinc-200">候选审阅</Text>
      <Text className="mt-2 text-center text-sm text-zinc-500 dark:text-zinc-400">
        modal 路由保证审阅可随时取消——系统返回键语义与"撤销"一致。
        分章候选审阅随 P1、角色候选随 P2 接入。
      </Text>
    </View>
  );
}
