import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import { SideDrawer } from '@/components/side-drawer';
import { useProjects } from '@/hooks/use-projects';
import { useI18n } from '@/hooks/use-i18n';
import { useServices } from '@/container';
import { EditDialog } from '@/components/edit-dialog';

export default function BookshelfScreen() {
  const { projects, error, createProject, deleteProject, refresh, updateTags } = useProjects();
  const { t } = useI18n();
  const services = useServices();
  const [createVisible, setCreateVisible] = useState(false);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<'recent' | 'created' | 'title'>('recent');
  const [searchQuery, setSearchQuery] = useState('');
  const [tagDialog, setTagDialog] = useState<{ projectId: string; title: string; initial: string[] } | null>(null);
  const [covers, setCovers] = useState<Record<string, string>>({});
  // 左侧抽屉（issue #62）：入口与展开/收起交互先落地，面板内容后续再定
  const [menuOpen, setMenuOpen] = useState(false);
  const colorScheme = useColorScheme();
  const menuIconColor = colorScheme === 'dark' ? '#EAE3D5' : '#2C2822';

  useEffect(() => {
    void services.settings.getSetting('bookshelf-view').then((saved) => {
      if (saved === 'grid' || saved === 'list') setView(saved);
    });
  }, [services]);

  // 封面路径加载（v0.14.0）：EPUB 导入时提取的内嵌封面
  useEffect(() => {
    if (!projects) return;
    void (async () => {
      const next: Record<string, string> = {};
      for (const project of projects) {
        const path = await services.settings.getSetting(`cover:${project.id}`);
        if (path) next[project.id] = path;
      }
      setCovers(next);
    })();
  }, [projects, services]);

  const toggleView = useCallback(() => {
    setView((current) => {
      const next = current === 'list' ? 'grid' : 'list';
      void services.settings.setSetting('bookshelf-view', next);
      return next;
    });
  }, [services]);

  // 创建书籍：成功后跳书详情页，用户从那里导入文本（service/hook 已就绪，仅缺此 UI 入口）
  const handleCreate = useCallback(
    (title: string) => {
      void createProject(title).then((result) => {
        if (result.ok && result.value) {
          setCreateVisible(false);
          router.push({ pathname: '/project/[id]', params: { id: result.value.id } });
        }
      });
    },
    [createProject],
  );

  // 筛选 + 排序（v0.14.0）：标签 chips 过滤；最近阅读/添加时间/标题
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const project of projects ?? []) for (const tag of project.tags) tags.add(tag);
    return [...tags];
  }, [projects]);
  const visibleProjects = useMemo(() => {
    let list = projects ?? [];
    if (activeTag) list = list.filter((p) => p.tags.includes(activeTag));
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      list = list.filter((p) =>
        p.title.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query) ||
        p.tags.some((tag) => tag.toLowerCase().includes(query)),
      );
    }
    list = [...list];
    if (sortMode === 'recent') list.sort((a, b) => b.updatedAt - a.updatedAt);
    else if (sortMode === 'created') list.sort((a, b) => b.createdAt - a.createdAt);
    else list.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
    return list;
  }, [projects, activeTag, searchQuery, sortMode]);

  const openTagDialog = useCallback((projectId: string, title: string, tags: string[]) => {
    setTagDialog({ projectId, title, initial: tags });
  }, []);

  /** 长按书籍动作（issue #41）：list/grid 共用 */
  const buildLongPressActions = useCallback(
    (item: { id: string; title: string; tags: string[] }) =>
      Alert.alert(item.title, undefined, [
        { text: t('shelf.editTags'), onPress: () => openTagDialog(item.id, item.title, item.tags) },
        {
          text: t('shelf.deleteBook'),
          style: 'destructive',
          onPress: () =>
            Alert.alert(t('shelf.deleteTitle'), t('shelf.deleteConfirm', { title: item.title }), [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.delete'), style: 'destructive', onPress: () => void deleteProject(item.id) },
            ]),
        },
        { text: t('common.cancel'), style: 'cancel' },
      ]),
    [deleteProject, openTagDialog, t],
  );

  /** 封面底色：按书名确定性取色（网格卡与列表封面同源） */
  const coverFor = useCallback((title: string) => {
    const palette = ['#3E4A5B', '#6B4A3A', '#44584A', '#5B3E4A', '#4A5B3E', '#44405B'];
    let sum = 0;
    for (const ch of title) sum += ch.charCodeAt(0);
    return palette[sum % palette.length];
  }, []);

  if (projects === null && !error) {
    return (
      <View className="flex-1 items-center justify-center bg-paper dark:bg-paper-night">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-paper px-4 pb-4 pt-16 dark:bg-paper-night">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('shelf.menu')}
            className="h-9 w-9 items-center justify-center rounded-lg bg-raised dark:bg-raised-night"
            onPress={() => setMenuOpen(true)}
          >
            <Ionicons name="menu" size={20} color={menuIconColor} />
          </Pressable>
          <Text className="font-serif text-3xl font-bold tracking-wide text-ink dark:text-ink-night">{t('shelf.title')}</Text>
        </View>
        <Pressable accessibilityRole="button"
          className="rounded-lg bg-raised px-3 py-1.5 dark:bg-raised-night"
          onPress={toggleView}
        >
          <Text className="text-xs text-ink dark:text-ink-night">{view === 'list' ? t('shelf.grid') : t('shelf.list')}</Text>
        </Pressable>
      </View>
      <Text className="mt-1 text-sm text-muted dark:text-muted-night">
        {t('shelf.subtitle')}
      </Text>

      <TextInput
        accessibilityLabel={t('shelf.searchPlaceholder')}
        className="mt-3 rounded-xl border border-line bg-card px-4 py-2.5 text-sm text-ink dark:border-line-night dark:bg-card-night dark:text-ink-night"
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder={t('shelf.searchPlaceholder')}
        placeholderTextColor="#8C8272"
        clearButtonMode="while-editing"
      />

      {error ? (
        <Text className="mt-4 rounded-lg bg-danger-soft p-3 text-sm text-danger dark:bg-danger-nightsoft dark:text-danger-night">
          {error}
        </Text>
      ) : null}

      <Pressable accessibilityRole="button"
        className="mt-4 items-center rounded-xl bg-accent py-3 active:bg-accent-deep"
        onPress={() => setCreateVisible(true)}
      >
        <Text className="font-semibold text-white">{t('shelf.add')}</Text>
      </Pressable>

      {allTags.length > 0 ? (
        <View className="mt-3 flex-row flex-wrap items-center gap-2">
          {([null, ...allTags] as (string | null)[]).map((tag) => (
            <Pressable
              key={tag ?? '__all'}
              accessibilityRole="button"
              className={`rounded-full px-3 py-1 ${activeTag === tag ? 'bg-accent' : 'bg-raised dark:bg-raised-night'}`}
              onPress={() => setActiveTag(tag)}
            >
              <Text className={`text-xs ${activeTag === tag ? 'font-semibold text-white' : 'text-ink dark:text-ink-night'}`}>
                {tag ?? t('shelf.filterAll')}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            className="rounded-full bg-raised px-3 py-1 dark:bg-raised-night"
            onPress={() => setSortMode((m) => (m === 'recent' ? 'created' : m === 'created' ? 'title' : 'recent'))}
          >
            <Text className="text-xs text-ink dark:text-ink-night">
              {t('shelf.sort')}:{sortMode === 'recent' ? t('shelf.sortRecent') : sortMode === 'created' ? t('shelf.sortCreated') : t('shelf.sortTitle')}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        key={view}
        className="mt-4"
        data={visibleProjects}
        keyExtractor={(item) => item.id}
        numColumns={view === 'grid' ? 3 : 1}
        columnWrapperStyle={view === 'grid' ? { gap: 10 } : undefined}
        contentContainerStyle={view === 'grid' ? { gap: 10 } : undefined}
        renderItem={({ item }) =>
          view === 'list' ? (
            <Pressable accessibilityRole="button"
              className="rounded-r-xl rounded-l-sm border-l-[3px] border-accent bg-card p-4 active:bg-raised dark:bg-card-night dark:active:bg-raised-night"
              onPress={() => router.push({ pathname: '/project/[id]', params: { id: item.id } })}
              onLongPress={() => buildLongPressActions(item)}
            >
              <Text className="font-serif text-base font-semibold tracking-wide text-ink dark:text-ink-night">{item.title}</Text>
              {item.tags.length > 0 ? (
                <Text className="mt-0.5 text-[10px] text-accent" numberOfLines={1}>
                  {item.tags.join(' / ')}
                </Text>
              ) : null}
              <Text className="mt-1 text-xs text-muted dark:text-muted-night">
                revision {item.revision} · {new Date(item.updatedAt).toLocaleString('zh-CN')}
              </Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button"
              className="flex-1 rounded-2xl border border-line bg-card p-2.5 active:bg-raised dark:bg-card-night dark:active:bg-raised-night"
              onPress={() => router.push({ pathname: '/project/[id]', params: { id: item.id } })}
              onLongPress={() => buildLongPressActions(item)}
            >
              <View
                className="aspect-[3/4] rounded-lg items-center justify-center"
                style={{ backgroundColor: coverFor(item.title) }}
              >
                {covers[item.id] ? (
                  <Image
                    source={{ uri: covers[item.id] }}
                    className="h-full w-full rounded-lg"
                    accessibilityLabel={t('shelf.coverLabel', { title: item.title })}
                  />
                ) : (
                  <Text className="font-serif text-sm tracking-widest text-paper">
                    {item.title.slice(0, 4).split('').join('\n')}
                  </Text>
                )}
              </View>
              <Text className="mt-2 font-serif text-xs font-semibold text-ink dark:text-ink-night" numberOfLines={1}>
                {item.title}
              </Text>
              <Text className="mt-0.5 text-[10px] text-faint dark:text-faint-night" numberOfLines={1}>
                revision {item.revision}
              </Text>
            </Pressable>
          )
        }
        ItemSeparatorComponent={view === 'list' ? () => <View className="h-2" /> : undefined}
        ListEmptyComponent={
          <View className="items-center py-16">
            <Text className="text-center text-sm text-muted dark:text-muted-night">
              {t('shelf.empty')}
              {'\n'}
              {t('shelf.longPressHint')}
            </Text>
          </View>
        }
        ListFooterComponent={
          projects && projects.length > 0 ? (
            <Pressable accessibilityRole="button" className="mt-3 items-center py-2" onPress={() => void refresh()}>
              <Text className="text-xs text-faint">{t('shelf.refresh')}</Text>
            </Pressable>
          ) : undefined
        }
      />

      <EditDialog
        visible={tagDialog !== null}
        title={tagDialog ? `${tagDialog.title}${t('shelf.tagsDialogSuffix')}` : ''}
        initialValue={tagDialog?.initial.join(' / ') ?? ''}
        keyboardType="default"
        onConfirm={(value) => {
          if (!tagDialog) return;
          void updateTags(tagDialog.projectId, value.split(/[\s/、,，]+/));
          setTagDialog(null);
        }}
        onClose={() => setTagDialog(null)}
      />

      <EditDialog
        visible={createVisible}
        title={t('shelf.addTitle')}
        initialValue=""
        confirmLabel={t('shelf.create')}
        onConfirm={handleCreate}
        onClose={() => setCreateVisible(false)}
      />

      {/* 左侧抽屉（issue #62）：面板内容后续再定，先放版本与设置入口 */}
      <SideDrawer side="left" open={menuOpen} onClose={() => setMenuOpen(false)}>
        <Text className="font-serif text-2xl font-bold tracking-wide text-ink dark:text-ink-night">TaleCast</Text>
        <Text className="mt-1 text-xs text-muted dark:text-muted-night">
          v{Constants.expoConfig?.version ?? '—'}
        </Text>
        <Pressable
          accessibilityRole="button"
          className="mt-6 flex-row items-center gap-3 rounded-xl bg-raised px-4 py-3 dark:bg-raised-night"
          onPress={() => {
            setMenuOpen(false);
            router.navigate('/settings');
          }}
        >
          <Ionicons name="settings-outline" size={18} color={menuIconColor} />
          <Text className="text-sm text-ink dark:text-ink-night">{t('settings.title')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          className="mt-2 flex-row items-center gap-3 rounded-xl bg-raised px-4 py-3 dark:bg-raised-night"
          onPress={() => {
            setMenuOpen(false);
            router.push('/book-source');
          }}
        >
          <Ionicons name="cloud-download-outline" size={18} color={menuIconColor} />
          <Text className="text-sm text-ink dark:text-ink-night">{t('bookSource.title')}</Text>
        </Pressable>
      </SideDrawer>
    </View>
  );
}
