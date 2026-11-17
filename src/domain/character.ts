/** 从角色 profileJson 中安全提取展示用描述；解析失败或无描述时返回占位文本 */
export function characterProfileText(profileJson: string): string {
  try {
    const parsed = JSON.parse(profileJson) as { profile?: string };
    return parsed.profile || '（无描述）';
  } catch {
    return '（无描述）';
  }
}
