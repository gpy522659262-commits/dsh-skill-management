/**
 * Skill Manager — browser half.
 *
 * Registers one Settings page ("技能管理") into `settings.section`. The page
 * lists every discovered skill package as a card with its introduction, both
 * invocation routes, and a switch that loads or unloads the skill immediately.
 *
 * It talks to the Host half through the framework-authenticated exact routes
 * the Host registers under `/api/skill-market`, falling back once to the legacy
 * `/skill-market` prefix route when the running Host is an older generation.
 * The page holds no state of its own beyond the last snapshot it received.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-skill-market',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'skill-market';
    /** Preferred exact-route namespace inside the authenticated `/api` bridge. */
    const API_CHANNEL = 'api/skill-market';
    /** Legacy prefix route, used only when the running Host predates it. */
    const LEGACY_CHANNEL = 'skill-market';
    /** Settings navigation id; also the sidebar panel key. */
    const SECTION_ID = 'skill-market';
    /** Sidebar panel key rendered by the `main` slot. */
    const PANEL_ID = 'skill-market';

    /** Required client services. */
    const inject = ['slots', 'locale'];

    const zh = {
      nav: '技能管理',
      title: '技能管理',
      intro: '把本地技能包目录加进来，逐个开关决定是否加载。关闭的技能不会出现在会话技能目录里，模型无法调用它。',
      addDir: '添加技能目录',
      addPlaceholder: '也可以直接输入目录路径，例如 D:\\my-skills',
      add: '添加',
      useDefault: '使用默认目录',
      enableAll: '全部启用',
      disableAll: '全部停用',
      refresh: '刷新',
      loading: '正在读取技能…',
      retry: '重试',
      filterPlaceholder: '按名称或简介筛选…',
      dirsTitle: '技能目录',
      dirsEmpty: '还没有添加任何目录。添加一个包含 SKILL.md 的目录，或把技能包放进默认目录。',
      skillsTitle: '技能包',
      skillsEmpty: '这些目录里没有发现技能包。技能包是含 SKILL.md 的目录，或根目录下的 <名称>.md 文件。',
      skillsFilteredEmpty: '没有匹配的技能。',
      invalidTitle: '无法解析的条目',
      duplicatesTitle: '被同名技能覆盖',
      statDirs: '目录',
      statSkills: '技能',
      statEnabled: '已启用',
      statDisabled: '已停用',
      statInvalid: '无效',
      enabled: '已加载',
      disabledTag: '未加载',
      modelOnly: '仅模型',
      userOnly: '仅用户',
      builtin: '内置目录',
      fromConfig: '来自配置',
      missing: '目录不存在',
      remove: '移除',
      removeConfirm: '从技能管理移除该目录？（不会删除磁盘上的文件）',
      dirEnableAll: '本目录全开',
      dirDisableAll: '本目录全关',
      dirOn: '已启用该目录下的 {n} 个技能。',
      dirOff: '已停用该目录下的 {n} 个技能。',
      packHint: '识别到所属技能包：{path}（{n} 个技能）。当前只加载了这个子目录。',
      usePack: '改为添加技能包',
      packUsed: '已改为技能包：{path}（{n} 个技能）。',
      packResolved: '已把 {picked} 识别为技能包 {path}（{n} 个技能）。',
      invocationTitle: '调用方式',
      modelCall: '模型调用',
      modelCallValue: 'skill 工具，name = ',
      userCall: '用户调用',
      located: '文件',
      fromDir: '来源',
      whenToUse: '适用场景',
      shadowedBy: '已被覆盖',
      watching: '监听中',
      notWatching: '未监听',
      statePath: '状态文件',
      providerRank: '提供器 rank',
      maskedNote: '（{n} 个停用技能仍占用名称，避免其他提供器接管）',
      footerHint: '提示：模型加载技能时会读取完整说明；你也可以在输入框用 /技能名 直接注入该技能。',
      manyEnabled: '当前已启用 {n} 个技能。启用的技能都会写进会话技能目录，建议只保留常用的。',
      busy: '处理中…',
      added: '已添加目录：{path}',
      addedAlready: '该目录已在列表中：{path}',
      removed: '已移除目录：{path}',
      defaultReady: '默认目录已就绪：{path}',
      refreshed: '已重新扫描。',
      toggledOn: '已启用 {name}',
      toggledOff: '已停用 {name}',
      allOn: '已启用全部技能。',
      allOff: '已停用全部技能。',
      failed: '操作失败',
      hostStale: '技能管理服务还没加载（Host 半是旧版本）。请重启 DeepSeek Harness 后再打开本页。',
      colon: '：',
      close: '关闭',
      filterLabel: '筛选技能',
      pickerUnavailable: '目录选择器不可用，请手动输入目录路径。',
      refreshing: '正在后台刷新…',
      staleTitle: '失效的停用记录',
      staleNote: '{n} 个已停用的技能已不存在（目录被删除或技能改名）。',
      prune: '清理',
      pruned: '已清理 {n} 条失效记录。',
      incompleteNote: '扫描不完整（目录预算或深度上限），列表可能缺少技能。',
      truncatedTag: '未扫全',
      configNote: '配置问题：{text}',
      stateErrorNote: '注册表读取失败：{text}（当前沿用上一次的状态）',
      renderFailed: '技能管理渲染失败，请刷新页面重试。',
      expandAll: '展开全部',
      collapseAll: '折叠全部',
      expandPack: '展开技能包',
      collapsePack: '折叠技能包',
      packEmpty: '这个技能包里没有发现技能。',
      packSuggested: '建议整包',
      sessionSkillsLabel: '本次会话技能',
      sessionSkillsTitle: '选择本次会话加载哪些技能',
      sessionSkillsHint: '只影响本会话：全局开关与其它会话不变。',
      sessionSkillsEmpty: '当前没有可选的技能（先在技能管理启用技能）。',
      sessionSkillsNoMatch: '没有匹配的技能。',
      sessionSkillsAll: '全选',
      sessionSkillsNone: '清空',
      sessionSkillsSelected: '已选 {n} / 共 {m}',
      sessionSkillsUnavailable: '当前 Host 无法按会话过滤技能，选择不会生效；请重启 DeepSeek Harness 更新 Host 半。',
      sessionSkillsSaving: '保存中…',
      sessionPackToggle: '切换该技能包的全部技能',
    };

    const en = {
      nav: 'Skill Manager',
      title: 'Skill Manager',
      intro: 'Register local skill-pack directories and switch each skill on or off. A switched-off skill leaves the session catalog, so the model cannot load it.',
      addDir: 'Add skill directory',
      addPlaceholder: 'Or type a directory path, e.g. D:\\my-skills',
      add: 'Add',
      useDefault: 'Use default directory',
      enableAll: 'Enable all',
      disableAll: 'Disable all',
      refresh: 'Refresh',
      loading: 'Reading skills…',
      retry: 'Retry',
      filterPlaceholder: 'Filter by name or description…',
      dirsTitle: 'Skill directories',
      dirsEmpty: 'No directory registered yet. Add a directory that holds SKILL.md packages, or drop packs into the default directory.',
      skillsTitle: 'Skill packages',
      skillsEmpty: 'No skill package found below these directories. A package is a directory holding SKILL.md, or a <name>.md file at a root.',
      skillsFilteredEmpty: 'No skill matches the filter.',
      invalidTitle: 'Entries that could not be parsed',
      duplicatesTitle: 'Hidden by a same-name skill',
      statDirs: 'directories',
      statSkills: 'skills',
      statEnabled: 'enabled',
      statDisabled: 'disabled',
      statInvalid: 'invalid',
      enabled: 'Loaded',
      disabledTag: 'Not loaded',
      modelOnly: 'Model only',
      userOnly: 'User only',
      builtin: 'Built-in root',
      fromConfig: 'From config',
      missing: 'Directory missing',
      remove: 'Remove',
      removeConfirm: 'Remove this directory from Skill Manager? Files on disk are not deleted.',
      dirEnableAll: 'Enable dir',
      dirDisableAll: 'Disable dir',
      dirOn: 'Enabled {n} skills in this directory.',
      dirOff: 'Disabled {n} skills in this directory.',
      packHint: 'Part of a skill pack: {path} ({n} skills). Only this subfolder is registered right now.',
      usePack: 'Register the whole pack',
      packUsed: 'Now using the skill pack: {path} ({n} skills).',
      packResolved: 'Resolved {picked} to the skill pack {path} ({n} skills).',
      invocationTitle: 'How to invoke',
      modelCall: 'Model',
      modelCallValue: 'skill tool, name = ',
      userCall: 'User',
      located: 'File',
      fromDir: 'From',
      whenToUse: 'When to use',
      shadowedBy: 'Shadowed',
      watching: 'watching',
      notWatching: 'not watching',
      statePath: 'State file',
      providerRank: 'Provider rank',
      maskedNote: '({n} disabled skills still hold their name so no other provider can serve it)',
      footerHint: 'Note: the model loads the full instructions through the skill tool; you can also inject a skill directly by typing /name in the composer.',
      manyEnabled: '{n} skills are enabled; every enabled skill lengthens the session skill catalog, so keep only the ones you use.',
      busy: 'Working…',
      added: 'Directory added: {path}',
      addedAlready: 'Directory already registered: {path}',
      removed: 'Directory removed: {path}',
      defaultReady: 'Default directory ready: {path}',
      refreshed: 'Rescanned.',
      toggledOn: 'Enabled {name}',
      toggledOff: 'Disabled {name}',
      allOn: 'Every skill enabled.',
      allOff: 'Every skill disabled.',
      failed: 'Operation failed',
      hostStale: 'The Skill Manager host service is not loaded yet (the running Host half is an older generation). Restart DeepSeek Harness, then reopen this page.',
      colon: ': ',
      close: 'Close',
      filterLabel: 'Filter skills',
      pickerUnavailable: 'The directory picker is unavailable; type the directory path instead.',
      refreshing: 'Refreshing in the background…',
      staleTitle: 'Stale switch records',
      staleNote: '{n} disabled skills no longer exist (their directory was removed or the skill was renamed).',
      prune: 'Clean up',
      pruned: 'Cleaned up {n} stale records.',
      incompleteNote: 'Discovery was incomplete (directory budget or depth limit); the list may be missing skills.',
      truncatedTag: 'partial',
      configNote: 'Configuration issue: {text}',
      stateErrorNote: 'Registry read failed: {text} (using the previous state)',
      renderFailed: 'Skill Manager failed to render; reload the page to retry.',
      expandAll: 'Expand all',
      collapseAll: 'Collapse all',
      expandPack: 'Expand pack',
      collapsePack: 'Collapse pack',
      packEmpty: 'No skill found in this pack.',
      packSuggested: 'whole pack',
      sessionSkillsLabel: 'Session skills',
      sessionSkillsTitle: 'Choose the skills this session loads',
      sessionSkillsHint: 'Affects this session only; global switches and other sessions stay as they are.',
      sessionSkillsEmpty: 'No selectable skill yet (enable skills in Skill Manager first).',
      sessionSkillsNoMatch: 'No skill matches the filter.',
      sessionSkillsAll: 'All',
      sessionSkillsNone: 'None',
      sessionSkillsSelected: '{n} of {m} selected',
      sessionSkillsUnavailable: 'This Host cannot filter skills per session, so the choice would not take effect; restart DeepSeek Harness to load the current Host half.',
      sessionSkillsSaving: 'Saving…',
      sessionPackToggle: 'Toggle every skill in this pack',
    };

    const CSS = `
.dsm-root { display: flex; flex-direction: column; gap: 14px; max-width: 860px; color: var(--dsw-alias-label-primary); }
.dsm-panel { box-sizing: border-box; display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 20px 24px 32px; }
/* The sidebar panel is a fixed-height column: the body scrolls, the panel never
   grows past the viewport. Settings keeps using the shell's own content scroll,
   so the overflow rule is scoped to the panel body only. */
.dsm-panel > .dsm-root { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)) transparent; }
.dsm-panel > .dsm-root::-webkit-scrollbar { width: 10px; height: 10px; }
.dsm-panel > .dsm-root::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 999px; background-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)); background-clip: content-box; }
.dsm-panel > .dsm-root::-webkit-scrollbar-track { background: transparent; }
/* Fallback for a host surface that clips instead of scrolling (for example a
   settings dialog with no scrollable content column): the section owns its own
   overflow. The component only adds this class when no ancestor scrolls. */
.dsm-root-scroll { max-height: 100%; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)) transparent; }
.dsm-root-scroll::-webkit-scrollbar { width: 10px; }
.dsm-root-scroll::-webkit-scrollbar-thumb { border: 3px solid transparent; border-radius: 999px; background-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)); background-clip: content-box; }
.dsm-root-scroll::-webkit-scrollbar-track { background: transparent; }
.dsm-head { display: flex; flex-direction: column; gap: 4px; }
.dsm-heading { margin: 0; font-size: 18px; font-weight: 600; line-height: 26px; }
.dsm-intro { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsm-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsm-spacer { flex: 1 1 auto; }
.dsm-btn { display: inline-flex; align-items: center; justify-content: center; height: 28px; padding: 0 10px; box-sizing: border-box; border: 0; border-radius: var(--dsw-radius-sm, 6px); font: inherit; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); background: transparent; cursor: pointer; }
.dsm-btn-outline { border: 0.5px solid var(--dsw-alias-border-l2); }
.dsm-btn-outline:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsm-btn-primary { padding: 0 14px; height: 30px; font-size: 13px; color: var(--dsw-alias-label-primary-foreground, #fff); background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-brand-primary)); }
.dsm-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-brand-primary)); }
.dsm-btn:disabled { cursor: not-allowed; opacity: 0.45; }
.dsm-btn:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
.dsm-input { flex: 1 1 260px; min-width: 200px; height: 30px; box-sizing: border-box; padding: 0 10px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; }
.dsm-input:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
.dsm-note { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-radius: var(--dsw-radius-sm, 6px); font-size: 12px; line-height: 18px; border: 0.5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
.dsm-note-error { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.dsm-note-ok { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.dsm-note-text { flex: 1 1 auto; overflow-wrap: anywhere; }
.dsm-note-close { border: 0; background: transparent; color: inherit; cursor: pointer; font: inherit; font-size: 14px; line-height: 16px; opacity: 0.7; }
.dsm-stats { display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsm-stat strong { color: var(--dsw-alias-label-primary); font-weight: 600; }
.dsm-section { display: flex; flex-direction: column; gap: 8px; }
.dsm-section-title { margin: 0; font-size: 13px; font-weight: 600; line-height: 20px; color: var(--dsw-alias-label-secondary); }
.dsm-tree { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
.dsm-tree-pack { display: flex; flex-direction: column; min-width: 0; }
.dsm-tree-parent { display: flex; align-items: center; gap: 8px; box-sizing: border-box; width: 100%; padding: 7px 10px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-1); }
.dsm-tree-parent-missing { border-color: var(--dsw-alias-state-warn-primary); }
.dsm-tree-disclosure { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dsm-tree-disclosure:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsm-tree-disclosure:disabled { opacity: 0.35; cursor: default; }
.dsm-tree-disclosure:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
.dsm-tree-chevron { display: block; transition: transform 120ms ease; }
.dsm-tree-chevron-open { transform: rotate(90deg); }
.dsm-tree-title { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 auto; }
.dsm-tree-name { font-size: 13px; font-weight: 600; line-height: 19px; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsm-tree-sub { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsm-tree-meta { flex: 0 0 auto; font-size: 11px; line-height: 17px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); white-space: nowrap; }
.dsm-tree-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 6px; }
.dsm-tree-children { position: relative; display: flex; flex-direction: column; gap: 5px; margin: 6px 0 0 20px; padding-left: 20px; border-left: 1px solid var(--dsw-alias-border-l2); list-style: none; }
.dsm-tree-child { position: relative; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 5px 10px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-bg-layer-1); }
.dsm-tree-child::before { content: ''; position: absolute; left: -21px; top: -7px; box-sizing: border-box; width: 21px; height: calc(50% + 7px); border-left: 1px solid var(--dsw-alias-border-l2); border-bottom: 1px solid var(--dsw-alias-border-l2); border-bottom-left-radius: 9px; pointer-events: none; }
.dsm-tree-child-off { background: var(--dsw-alias-bg-base); }
.dsm-tree-skill { flex: 0 0 auto; max-width: 38%; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; font-weight: 600; line-height: 18px; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsm-tree-child-off .dsm-tree-skill { color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsm-tree-desc { flex: 1 1 auto; min-width: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsm-tree-rel { flex: 0 1 auto; max-width: 26%; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 17px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsm-tree-invalid { border-style: dashed; border-color: var(--dsw-alias-state-error-primary); }
.dsm-tree-invalid .dsm-tree-skill { color: var(--dsw-alias-state-error-primary); }
.dsm-tree-empty { margin: 0; padding: 6px 10px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
/* Session picker: a compact trigger with an anchored popover. */
.dsm-session { position: relative; display: inline-flex; }
.dsm-session-trigger { gap: 6px; }
.dsm-session-trigger > svg { flex: 0 0 auto; }
.dsm-session-count { display: inline-flex; align-items: center; height: 16px; padding: 0 5px; border-radius: 999px; font-size: 10px; line-height: 16px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); }
.dsm-session-panel { position: absolute; right: 0; top: calc(100% + 6px); z-index: 60; display: flex; flex-direction: column; gap: 8px; width: 380px; max-width: calc(100vw - 24px); max-height: min(60vh, 480px); box-sizing: border-box; padding: 10px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-bg-layer-1); box-shadow: var(--dsw-shadow-overlay, 0 10px 30px rgba(0, 0, 0, 0.22)); }
.dsm-session-compact .dsm-session-panel { width: 360px; top: auto; bottom: calc(100% + 6px); }
.dsm-session-head { display: flex; align-items: center; gap: 8px; }
.dsm-session-title { flex: 1 1 auto; font-size: 12px; font-weight: 600; line-height: 18px; color: var(--dsw-alias-label-primary); }
.dsm-session-tools { display: flex; gap: 6px; }
.dsm-session-list { display: flex; flex: 1 1 auto; flex-direction: column; gap: 6px; min-height: 0; margin: 0; padding: 0; list-style: none; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)) transparent; }
.dsm-session-group { display: flex; flex-direction: column; gap: 3px; }
.dsm-session-group-head { display: flex; align-items: center; gap: 6px; }
.dsm-session-pack-box { flex: 0 0 auto; width: 13px; height: 13px; margin: 0; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }
.dsm-session-group-toggle { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; gap: 4px; padding: 2px 0; border: 0; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font: inherit; font-size: 11px; line-height: 16px; text-align: left; cursor: pointer; }
.dsm-session-group-toggle:hover { color: var(--dsw-alias-label-secondary); }
.dsm-session-group-toggle:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 1px; }
.dsm-session-group-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.dsm-session-group-count { flex: 0 0 auto; font-variant-numeric: tabular-nums; }
.dsm-session-children { position: relative; display: flex; flex-direction: column; gap: 2px; margin: 2px 0 0 8px; padding-left: 12px; border-left: 1px solid var(--dsw-alias-border-l2); list-style: none; }
.dsm-session-row { position: relative; padding: 3px 4px; border-radius: 4px; }
.dsm-session-child::before { content: ''; position: absolute; left: -13px; top: -3px; box-sizing: border-box; width: 13px; height: calc(50% + 3px); border-left: 1px solid var(--dsw-alias-border-l2); border-bottom: 1px solid var(--dsw-alias-border-l2); border-bottom-left-radius: 6px; pointer-events: none; }
.dsm-session-fold { flex: 0 0 auto; padding: 0 2px; border: 0; background: transparent; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); font: inherit; font-size: 11px; line-height: 16px; cursor: pointer; }
.dsm-session-fold:hover:not(:disabled) { color: var(--dsw-alias-label-secondary); }
.dsm-session-fold:disabled { opacity: 0.45; cursor: default; }
.dsm-session-row:hover { background: var(--dsw-alias-bg-layer-2); }
.dsm-session-label { display: flex; align-items: center; gap: 6px; min-width: 0; cursor: pointer; }
.dsm-session-name { flex: 0 0 auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--dsw-alias-label-primary); }
.dsm-session-desc { flex: 1 1 auto; min-width: 0; font-size: 11px; line-height: 17px; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsm-session-foot { display: flex; align-items: center; gap: 6px; }
.dsm-session-meta { flex: 1 1 auto; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsm-session-hint { margin: 0; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsm-session-note { margin: 0; font-size: 11px; line-height: 16px; color: var(--dsw-alias-state-warn-primary); }
.dsm-tags { display: flex; flex-wrap: wrap; gap: 4px; flex: 0 0 auto; }
.dsm-tag { display: inline-flex; align-items: center; height: 18px; padding: 0 6px; border-radius: 4px; font-size: 11px; line-height: 18px; border: 0.5px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); }
.dsm-tag-err { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.dsm-switch { box-sizing: border-box; position: relative; flex: 0 0 auto; width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px; background: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)); cursor: pointer; }
.dsm-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.dsm-switch:disabled { cursor: default; opacity: 0.5; }
.dsm-switch:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary)); outline-offset: 2px; }
.dsm-thumb { display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-label-primary-foreground, #fff); transition: transform 120ms ease; }
.dsm-switch[aria-checked='false'] .dsm-thumb { background: var(--dsw-alias-switch-thumb, var(--dsw-alias-bg-base)); }
.dsm-switch[aria-checked='true'] .dsm-thumb { transform: translateX(16px); }
.dsm-empty { margin: 0; padding: 10px 12px; border: 0.5px dashed var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm, 6px); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsm-details { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsm-details summary { cursor: pointer; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.dsm-list { display: flex; flex-direction: column; gap: 4px; margin: 8px 0 0; padding: 0; list-style: none; }
.dsm-list li { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; line-height: 17px; overflow-wrap: anywhere; }
.dsm-footer { display: flex; flex-direction: column; gap: 3px; padding-top: 4px; border-top: 0.5px solid var(--dsw-alias-border-l1); font-size: 11px; line-height: 17px; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }
.dsm-code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
`;

    /** Format one dictionary entry. */
    function format(template, values) {
      return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
    }

    /** The channel that answered last; starts with the preferred exact routes. */
    let channel = API_CHANNEL;

    /**
     * Call one Host endpoint on the same origin and unwrap its envelope.
     *
     * The URL is document-relative, exactly like the shipped Remote calls, so it
     * follows the page's mount. A shell-provided transport fetch is preferred
     * (and bound to its owner) when the page is not served over HTTP. A 404/405
     * on the exact namespace falls back once to the legacy prefix route, so a
     * page that outlives a Host upgrade still works.
     *
     * @param endpoint - the endpoint name.
     * @param payload - JSON request body.
     * @returns the endpoint's value.
     */
    async function call(endpoint, payload) {
      const transport = globalThis.__DSH_TRANSPORT__;
      const send = typeof transport?.fetch === 'function'
        ? transport.fetch.bind(transport)
        : (input, init) => globalThis.fetch(input, init);
      const post = (base) => send(`${base}/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });
      let response = await post(channel);
      if (!response.ok && channel === API_CHANNEL && (response.status === 404 || response.status === 405)) {
        channel = LEGACY_CHANNEL;
        response = await post(channel);
      }
      if (!response.ok) {
        // 404/405 mean the Host half of this plugin is not the running module
        // generation: only the current Host code registers these routes.
        throw new Error(`HTTP ${response.status}`);
      }
      const result = await response.json();
      if (result === null || typeof result !== 'object') throw new Error(`${endpoint}: malformed response`);
      if (result.ok !== true) {
        const error = result.error ?? {};
        throw new Error(typeof error.message === 'string' ? error.message : `${endpoint} failed`);
      }
      return result.value;
    }

    /** Coerce a snapshot invocation policy into safe booleans. */
    function normalizeInvocation(value) {
      const policy = value !== null && typeof value === 'object' ? value : {};
      return {
        modelInvocable: policy.modelInvocable !== false,
        userInvocable: policy.userInvocable !== false,
      };
    }

    /** Render a failure for the user, naming the stale-Host case explicitly. */
    function describeError(t, error) {
      const message = error?.message ?? String(error);
      if (/^HTTP (404|405)$/.test(message)) return t('hostStale');
      return message;
    }

    /** The trailing path segment, used as the pack title. */
    function basenameOf(value) {
      const text = String(value ?? '').replace(/[\\/]+$/, '');
      const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
      return index === -1 ? text : text.slice(index + 1);
    }

    /** One skill row inside a pack. */
    function SkillRow({ t, skill, busy, onToggle }) {
      const off = skill.enabled !== true;
      const invocation = normalizeInvocation(skill.invocation);
      const tags = [];
      if (off !== true && invocation.modelInvocable !== true) {
        tags.push(h('span', { key: 'user', className: 'dsm-tag' }, t('userOnly')));
      }
      if (off !== true && invocation.userInvocable !== true && invocation.modelInvocable === true) {
        tags.push(h('span', { key: 'model', className: 'dsm-tag' }, t('modelOnly')));
      }
      if (skill.kind === 'flat') tags.push(h('span', { key: 'flat', className: 'dsm-tag' }, '.md'));
      if (skill.builtin === true) tags.push(h('span', { key: 'builtin', className: 'dsm-tag' }, t('builtin')));
      // The row stays one line; the description carries the full text and the
      // optional "when to use" hint as its tooltip.
      const descriptionTitle = skill.whenToUse === undefined
        ? skill.description
        : `${skill.description}\n${t('whenToUse')}${t('colon')}${skill.whenToUse}`;
      return h('li', {
        className: `dsm-tree-child${off ? ' dsm-tree-child-off' : ''}`,
        title: `${t('located')}${t('colon')}${skill.path}`,
      }, [
        h('span', { key: 'name', className: 'dsm-tree-skill' }, skill.name),
        h('span', { key: 'desc', className: 'dsm-tree-desc', title: descriptionTitle }, skill.description),
        tags.length === 0 ? null : h('span', { key: 'tags', className: 'dsm-tags' }, tags),
        h('span', {
          key: 'rel',
          className: 'dsm-tree-rel',
          title: `${t('fromDir')}${t('colon')}${skill.root}`,
        }, skill.relative),
        h('button', {
          key: 'switch',
          type: 'button',
          role: 'switch',
          'aria-checked': off ? 'false' : 'true',
          'aria-label': `${skill.name}${t('colon')}${off ? t('disabledTag') : t('enabled')}`,
          className: 'dsm-switch',
          disabled: busy,
          onClick: () => onToggle(skill, !skill.enabled),
        }, h('span', { className: 'dsm-thumb' })),
      ]);
    }

    /** One unparsable entry, shown inside the pack it belongs to. */
    function InvalidRow({ t, entry }) {
      return h('li', { className: 'dsm-tree-child dsm-tree-invalid', title: entry.path }, [
        h('span', { key: 'name', className: 'dsm-tree-skill' }, entry.relative),
        h('span', { key: 'error', className: 'dsm-tree-desc' }, entry.error),
        h('span', { key: 'tag', className: 'dsm-tags' },
          h('span', { className: 'dsm-tag dsm-tag-err' }, t('statInvalid'))),
      ]);
    }

    /**
     * One pack: a registered directory as the parent row, its skills as child
     * rows. The parent row owns the pack-level actions so they are reachable
     * while the pack is collapsed.
     */
    function PackGroup({ t, group, index, open, busy, features, onToggleExpand, onToggleSkill, onDirAll, onRemove, onUsePack }) {
      const { dir, skills, invalid, matchedSkills, matchedInvalid } = group;
      const filtering = matchedSkills !== undefined;
      const visibleSkills = filtering === true ? matchedSkills : skills;
      const visibleInvalid = filtering === true ? matchedInvalid : invalid;
      const enabled = skills.filter((skill) => skill.enabled === true).length;
      const childrenId = `dsm-pack-children-${index}`;
      const canExpand = dir.exists === true;
      const name = basenameOf(dir.path);
      const meta = [
        dir.exists === true ? `${skills.length} ${t('statSkills')}` : t('missing'),
        dir.exists === true && skills.length > 0 ? `${enabled} ${t('statEnabled')}` : '',
        invalid.length > 0 ? `${invalid.length} ${t('statInvalid')}` : '',
        dir.truncated === true ? t('truncatedTag') : '',
        dir.builtin === true ? t('builtin') : '',
        dir.fromConfig === true ? t('fromConfig') : '',
        dir.pack === undefined ? '' : t('packSuggested'),
      ].filter((part) => part !== '').join(' \u00b7 ');

      const children = [];
      if (open === true) {
        for (const skill of visibleSkills) {
          children.push(h(SkillRow, { key: skill.path, t, skill, busy, onToggle: onToggleSkill }));
        }
        for (const entry of visibleInvalid) {
          children.push(h(InvalidRow, { key: entry.path, t, entry }));
        }
        if (children.length === 0) {
          children.push(h('li', { key: 'empty', className: 'dsm-tree-empty' }, t('packEmpty')));
        }
      }

      const scoped = dir.removable !== false && dir.exists === true && features.scopedToggle === true;
      return h('li', { className: 'dsm-tree-pack' }, [
        h('div', {
          key: 'parent',
          className: `dsm-tree-parent${dir.exists === true ? '' : ' dsm-tree-parent-missing'}`,
        }, [
          h('button', {
            key: 'disclosure',
            type: 'button',
            className: 'dsm-tree-disclosure',
            'aria-expanded': open === true ? 'true' : 'false',
            'aria-controls': childrenId,
            'aria-label': `${open === true ? t('collapsePack') : t('expandPack')}${t('colon')}${name}`,
            disabled: canExpand !== true,
            onClick: () => onToggleExpand(dir.path),
          }, h('svg', {
            className: `dsm-tree-chevron${open === true ? ' dsm-tree-chevron-open' : ''}`,
            width: 12,
            height: 12,
            viewBox: '0 0 12 12',
            'aria-hidden': true,
          }, h('path', {
            d: 'M4 2l4 4-4 4',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }))),
          h('div', { key: 'title', className: 'dsm-tree-title' }, [
            h('span', { key: 'name', className: 'dsm-tree-name' }, name),
            h('span', { key: 'path', className: 'dsm-tree-sub', title: dir.path }, dir.path),
          ]),
          h('span', { key: 'meta', className: 'dsm-tree-meta' }, meta),
          h('div', { key: 'actions', className: 'dsm-tree-actions' }, [
            scoped !== true ? null : h('button', {
              key: 'enable-all',
              type: 'button',
              className: 'dsm-btn dsm-btn-outline',
              disabled: busy || skills.length === 0,
              onClick: () => onDirAll(dir, true),
            }, t('dirEnableAll')),
            scoped !== true ? null : h('button', {
              key: 'disable-all',
              type: 'button',
              className: 'dsm-btn dsm-btn-outline',
              disabled: busy || skills.length === 0,
              onClick: () => onDirAll(dir, false),
            }, t('dirDisableAll')),
            dir.pack === undefined || features.replaceWithPack !== true ? null : h('button', {
              key: 'use-pack',
              type: 'button',
              className: 'dsm-btn dsm-btn-outline',
              title: format(t('packHint'), { path: dir.pack.root, n: dir.pack.skills }),
              'aria-label': format(t('packHint'), { path: dir.pack.root, n: dir.pack.skills }),
              disabled: busy,
              onClick: () => onUsePack(dir),
            }, t('usePack')),
            dir.removable === false ? null : h('button', {
              key: 'remove',
              type: 'button',
              className: 'dsm-btn dsm-btn-outline',
              disabled: busy,
              onClick: () => onRemove(dir),
            }, t('remove')),
          ]),
        ]),
        children.length === 0 ? null : h('ul', { key: 'children', className: 'dsm-tree-children', id: childrenId }, children),
      ]);
    }

    /**
     * Session-scoped skill picker: a trigger button plus its popover.
     *
     * `variant: 'hero'` is the labelled New Session row control; `'compact'` is
     * the icon-only composer control. The choice is stored per session by the
     * Host and filters that session's catalog only.
     */
    function createSessionSkillsButton(ctx, variant) {
      const t = ctx.locale.bind(NS);
      return function SessionSkillsButton(props) {
        const sessionId = typeof props?.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : undefined;
        const [open, setOpen] = React.useState(false);
        const [status, setStatus] = React.useState('idle');
        const [data, setData] = React.useState(null);
        const [error, setError] = React.useState(null);
        const [excluded, setExcluded] = React.useState(() => new Set());
        const [filter, setFilter] = React.useState('');
        const [saving, setSaving] = React.useState(false);
        // Viewport coordinates for the popover; null until the trigger is measured.
        const [anchor, setAnchor] = React.useState(null);
        // Packs start collapsed: the picker opens as a list of packs, and the
        // user expands only the ones they want to inspect.
        const [expanded, setExpanded] = React.useState(() => new Set());
        const boxRef = React.useRef(null);

        const adopt = React.useCallback((value) => {
          setData(value);
          setExcluded(new Set(Array.isArray(value.excluded) ? value.excluded : []));
          setStatus('ready');
          setError(null);
        }, []);

        const load = React.useCallback(async () => {
          if (sessionId === undefined) return;
          try {
            adopt(await call('sessionSkills', { sessionId }));
          } catch (cause) {
            if (/^HTTP (404|405)$/.test(cause?.message ?? String(cause))) {
              // An older Host generation has no per-session endpoint: hide the
              // control instead of showing a broken panel.
              setStatus('unavailable');
              return;
            }
            setError(describeError(t, cause));
            setStatus('error');
          }
        }, [sessionId, adopt]);

        React.useEffect(() => {
          void load();
        }, [load]);

        const persist = React.useCallback(async (nextSet) => {
          if (sessionId === undefined) return;
          setExcluded(nextSet);
          setSaving(true);
          setError(null);
          try {
            const value = await call('setSessionSkills', { sessionId, excluded: [...nextSet] });
            setData((previous) => (previous === null ? previous : { ...previous, excluded: value.excluded, canFilter: value.canFilter, warning: value.warning }));
            setExcluded(new Set(Array.isArray(value.excluded) ? value.excluded : []));
          } catch (cause) {
            setError(describeError(t, cause));
          } finally {
            setSaving(false);
          }
        }, [sessionId]);

        // Escape closes; a click outside the control closes too.
        React.useEffect(() => {
          if (!open || typeof document === 'undefined') return undefined;
          const onKey = (event) => {
            if (event.key === 'Escape') setOpen(false);
          };
          const onDown = (event) => {
            const node = boxRef.current;
            if (node !== null && node !== undefined && typeof node.contains === 'function' && node.contains(event.target) === true) return;
            setOpen(false);
          };
          document.addEventListener('keydown', onKey);
          document.addEventListener('mousedown', onDown);
          return () => {
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('mousedown', onDown);
          };
        }, [open]);

        // A slot container may clip its children or create a stacking context,
        // so the popover floats against the viewport: measure the trigger and
        // place the panel below it (or above when the bottom lacks room).
        React.useEffect(() => {
          if (open !== true || typeof window === 'undefined') return;
          const node = boxRef.current;
          if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return;
          const rect = node.getBoundingClientRect();
          const viewportWidth = window.innerWidth > 0 ? window.innerWidth : 1024;
          const viewportHeight = window.innerHeight > 0 ? window.innerHeight : 768;
          const width = Math.min(380, viewportWidth - 24);
          const left = Math.max(12, Math.min(rect.right - width, viewportWidth - width - 12));
          const below = rect.bottom + 6;
          if (viewportHeight - below >= 260) setAnchor({ left, width, top: below });
          else setAnchor({ left, width, bottom: Math.max(12, viewportHeight - rect.top + 6) });
        }, [open]);

        // A slot container may clip its children or create a stacking context,
        // so the popover floats against the viewport: measure the trigger and
        // place the panel below it (or above when the bottom lacks room).
        React.useEffect(() => {
          if (open !== true || typeof window === 'undefined') return;
          const node = boxRef.current;
          if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return;
          const rect = node.getBoundingClientRect();
          const viewportWidth = window.innerWidth > 0 ? window.innerWidth : 1024;
          const viewportHeight = window.innerHeight > 0 ? window.innerHeight : 768;
          const width = Math.min(380, viewportWidth - 24);
          const left = Math.max(12, Math.min(rect.right - width, viewportWidth - width - 12));
          const below = rect.bottom + 6;
          if (viewportHeight - below >= 260) setAnchor({ left, width, top: below });
          else setAnchor({ left, width, bottom: Math.max(12, viewportHeight - rect.top + 6) });
        }, [open]);

        if (sessionId === undefined || status === 'unavailable') return null;

        const skills = Array.isArray(data?.skills) ? data.skills : [];
        const needle = filter.trim().toLowerCase();
        const visible = skills.filter((skill) => {
          if (needle === '') return true;
          const description = typeof skill.description === 'string' ? skill.description : '';
          return skill.name.toLowerCase().includes(needle) || description.toLowerCase().includes(needle);
        });
        const excludedCount = skills.filter((skill) => excluded.has(skill.name)).length;
        const selectedCount = skills.length - excludedCount;
        const canFilter = data?.canFilter !== false;
        const filtering = needle !== '';

        const groups = [];
        const groupIndex = new Map();
        for (const skill of visible) {
          const key = typeof skill.root === 'string' ? skill.root : '';
          let group = groupIndex.get(key);
          if (group === undefined) {
            group = { key, name: basenameOf(key), skills: [] };
            groupIndex.set(key, group);
            groups.push(group);
          }
          group.skills.push(skill);
        }

        const allExpanded = groups.length > 0 && groups.every((group) => expanded.has(group.key));
        const isGroupOpen = (group) => filtering === true || expanded.has(group.key);
        const toggleGroup = (key) => {
          setExpanded((previous) => {
            const next = new Set(previous);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        };

        const anchorStyle = anchor === null ? undefined : {
          position: 'fixed',
          left: `${anchor.left}px`,
          width: `${anchor.width}px`,
          maxWidth: 'calc(100vw - 24px)',
          ...(anchor.top !== undefined
            ? { top: `${anchor.top}px`, bottom: 'auto' }
            : { bottom: `${anchor.bottom}px`, top: 'auto' }),
        };

        const panel = h('div', {
          key: 'panel',
          className: 'dsm-session-panel',
          role: 'dialog',
          'aria-label': t('sessionSkillsTitle'),
          style: anchorStyle,
        }, [
          h('div', { key: 'head', className: 'dsm-session-head' }, [
            h('span', { key: 'title', className: 'dsm-session-title' }, t('sessionSkillsTitle')),
            h('button', {
              key: 'fold',
              type: 'button',
              className: 'dsm-session-fold',
              disabled: filtering === true || groups.length === 0,
              onClick: () => setExpanded(allExpanded ? new Set() : new Set(groups.map((group) => group.key))),
            }, allExpanded ? t('collapseAll') : t('expandAll')),
            saving ? h('span', { key: 'saving', className: 'dsm-session-meta' }, t('sessionSkillsSaving')) : null,
            h('button', {
              key: 'close',
              type: 'button',
              className: 'dsm-note-close',
              'aria-label': t('close'),
              onClick: () => setOpen(false),
            }, '\u00d7'),
          ]),
          canFilter === false ? h('p', { key: 'warn', className: 'dsm-session-note' }, t('sessionSkillsUnavailable')) : null,
          h('div', { key: 'tools', className: 'dsm-session-tools' }, [
            h('input', {
              key: 'filter',
              className: 'dsm-input',
              type: 'text',
              value: filter,
              spellCheck: false,
              placeholder: t('filterPlaceholder'),
              'aria-label': t('filterLabel'),
              style: { flex: '1 1 auto', minWidth: '0' },
              onChange: (event) => setFilter(event.target.value),
            }),
          ]),
          status === 'loading'
            ? h('p', { key: 'loading', className: 'dsm-empty' }, t('loading'))
            : status === 'error'
              ? h('p', { key: 'error', className: 'dsm-session-note' }, `${t('failed')}${t('colon')}${error}`)
              : skills.length === 0
                ? h('p', { key: 'empty', className: 'dsm-empty' }, t('sessionSkillsEmpty'))
                : visible.length === 0
                  ? h('p', { key: 'nomatch', className: 'dsm-empty' }, t('sessionSkillsNoMatch'))
                  : h('ul', { key: 'list', className: 'dsm-session-list' }, groups.map((group, index) => {
                      const openGroup = isGroupOpen(group);
                      const rowsId = `dsm-session-pack-${index}`;
                      const groupSelected = group.skills.filter((skill) => excluded.has(skill.name) === false).length;
                      const allIncluded = group.skills.length > 0 && groupSelected === group.skills.length;
                      return h('li', {
                        key: group.key,
                        className: 'dsm-session-group',
                      }, [
                        h('div', { key: 'head', className: 'dsm-session-group-head' }, [
                          h('input', {
                            key: 'group-box',
                            type: 'checkbox',
                            className: 'dsm-session-pack-box',
                            checked: allIncluded,
                            disabled: saving || group.skills.length === 0,
                            'aria-checked': allIncluded
                              ? 'true'
                              : groupSelected === 0 ? 'false' : 'mixed',
                            'aria-label': `${t('sessionPackToggle')}${t('colon')}${group.name}`,
                            onChange: () => {
                              const next = new Set(excluded);
                              if (allIncluded) {
                                for (const skill of group.skills) next.add(skill.name);
                              } else {
                                for (const skill of group.skills) next.delete(skill.name);
                              }
                              void persist(next);
                            },
                          }),
                          h('button', {
                            key: 'toggle',
                            type: 'button',
                            className: 'dsm-session-group-toggle',
                            'aria-expanded': openGroup === true ? 'true' : 'false',
                            'aria-controls': rowsId,
                            'aria-label': `${openGroup === true ? t('collapsePack') : t('expandPack')}${t('colon')}${group.name}`,
                            onClick: () => toggleGroup(group.key),
                          }, [
                            h('svg', {
                              key: 'chevron',
                              className: `dsm-tree-chevron${openGroup === true ? ' dsm-tree-chevron-open' : ''}`,
                              width: 10,
                              height: 10,
                              viewBox: '0 0 12 12',
                              'aria-hidden': true,
                            }, h('path', {
                              d: 'M4 2l4 4-4 4',
                              fill: 'none',
                              stroke: 'currentColor',
                              strokeWidth: 1.6,
                              strokeLinecap: 'round',
                              strokeLinejoin: 'round',
                            })),
                            h('span', { key: 'name', className: 'dsm-session-group-name', title: group.key }, group.name),
                            h('span', { key: 'count', className: 'dsm-session-group-count' }, `${groupSelected}/${group.skills.length}`),
                          ]),
                        ]),
                        openGroup === true
                          ? h('ul', { key: 'rows', id: rowsId, className: 'dsm-session-children' }, group.skills.map((skill) => h('li', {
                              key: skill.name,
                              className: 'dsm-session-row dsm-session-child',
                            }, h('label', { className: 'dsm-session-label' }, [
                              h('input', {
                                key: 'box',
                                type: 'checkbox',
                                checked: excluded.has(skill.name) === false,
                                disabled: saving,
                                onChange: () => {
                                  const next = new Set(excluded);
                                  if (next.has(skill.name)) next.delete(skill.name);
                                  else next.add(skill.name);
                                  void persist(next);
                                },
                              }),
                              h('span', { key: 'name', className: 'dsm-session-name' }, skill.name),
                              h('span', { key: 'desc', className: 'dsm-session-desc', title: skill.description }, skill.description),
                            ]))))
                          : null,
                      ]);
                    })),
          h('div', { key: 'foot', className: 'dsm-session-foot' }, [
            h('span', { key: 'count', className: 'dsm-session-meta' },
              format(t('sessionSkillsSelected'), { n: selectedCount, m: skills.length })),
            h('button', {
              key: 'all',
              type: 'button',
              className: 'dsm-btn dsm-btn-outline',
              disabled: saving || skills.length === 0,
              onClick: () => void persist(new Set()),
            }, t('sessionSkillsAll')),
            h('button', {
              key: 'none',
              type: 'button',
              className: 'dsm-btn dsm-btn-outline',
              disabled: saving || skills.length === 0,
              onClick: () => void persist(new Set(skills.map((skill) => skill.name))),
            }, t('sessionSkillsNone')),
          ]),
          h('p', { key: 'hint', className: 'dsm-session-hint' }, t('sessionSkillsHint')),
        ]);

        return h('span', {
          className: `dsm-session${variant === 'compact' ? ' dsm-session-compact' : ''}`,
          ref: boxRef,
        }, [
          h('button', {
            key: 'trigger',
            type: 'button',
            className: 'dsm-btn dsm-btn-outline dsm-session-trigger',
            'aria-haspopup': 'dialog',
            'aria-expanded': open === true ? 'true' : 'false',
            title: t('sessionSkillsTitle'),
            onClick: () => {
              if (open) {
                setOpen(false);
                return;
              }
              setOpen(true);
              setExpanded(new Set());
              void load();
            },
          }, [
            h(SkillMarketIcon, { key: 'glyph', size: 14 }),
            variant === 'compact' ? null : h('span', { key: 'label' }, t('sessionSkillsLabel')),
            excludedCount > 0 ? h('span', { key: 'count', className: 'dsm-session-count' }, `\u2212${excludedCount}`) : null,
          ]),
          open === true ? panel : null,
        ]);
      };
    }

    /** The settings page component. */
    function createSection(ctx) {
      const t = ctx.locale.bind(NS);
      return function SkillMarketSection() {
        const [state, setState] = React.useState({ status: 'loading', data: null, error: null });
        const [busy, setBusy] = React.useState(false);
        const [note, setNote] = React.useState(null);
        const [draft, setDraft] = React.useState('');
        const [filter, setFilter] = React.useState('');
        const [visible, setVisible] = React.useState(true);
        const [expanded, setExpanded] = React.useState(() => new Set());
        const [selfScroll, setSelfScroll] = React.useState(false);
        const [refreshing, setRefreshing] = React.useState(false);
        const rootRef = React.useRef(null);
        const latestRef = React.useRef(null);

        /** Adopt one snapshot and remember it for the revision poll. */
        const applySnapshot = React.useCallback((snapshot) => {
          latestRef.current = snapshot;
          setState({ status: 'ready', data: snapshot, error: null });
        }, []);

        const run = React.useCallback(async (endpoint, payload, success) => {
          setBusy(true);
          try {
            const value = await call(endpoint, payload);
            if (value !== null && typeof value === 'object' && value.snapshot !== undefined) {
              applySnapshot(value.snapshot);
            }
            setNote(success === undefined || success === null ? null : { tone: 'ok', text: success });
            return value;
          } catch (error) {
            setNote({ tone: 'error', text: `${t('failed')}${t('colon')}${describeError(t, error)}` });
            return null;
          } finally {
            setBusy(false);
          }
        }, [applySnapshot]);

        // A silent refresh keeps the rendered cards; only the first load shows
        // the blocking "reading skills" state.
        const load = React.useCallback(async (options = {}) => {
          const silent = options.silent === true && latestRef.current !== null;
          if (silent) setRefreshing(true);
          else setState({ status: 'loading', data: null, error: null });
          try {
            applySnapshot(await call('snapshot'));
          } catch (error) {
            if (silent) {
              setNote({ tone: 'error', text: `${t('failed')}${t('colon')}${describeError(t, error)}` });
            } else {
              setState({ status: 'error', data: null, error: describeError(t, error) });
            }
          } finally {
            if (silent) setRefreshing(false);
          }
        }, [applySnapshot]);

        // The settings shell keeps visited panels mounted and merely hides them,
        // so refetch whenever this panel becomes visible again.
        React.useEffect(() => {
          const node = rootRef.current;
          if (node === null || node === undefined || typeof IntersectionObserver === 'undefined') return undefined;
          const observer = new IntersectionObserver((entries) => {
            for (const entry of entries) setVisible(entry.isIntersecting === true);
          });
          observer.observe(node);
          return () => observer.disconnect();
        }, []);

        React.useEffect(() => {
          if (!visible) return;
          void load({ silent: latestRef.current !== null });
        }, [visible, load]);

        // While visible, a cheap revision probe keeps the panel in step with
        // changes made elsewhere (another window, another session, or a script).
        React.useEffect(() => {
          if (!visible || typeof document === 'undefined' || typeof setInterval === 'undefined') return undefined;
          const timer = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            void (async () => {
              try {
                const known = latestRef.current;
                if (known?.features?.revisionProbe === true) {
                  const probe = await call('revision');
                  if (probe !== null && typeof probe === 'object' && probe.revision === known.revision) return;
                }
                await load({ silent: true });
              } catch {
                /* transient failure: the next tick retries */
              }
            })();
          }, 10000);
          return () => clearInterval(timer);
        }, [visible, load]);

        // A host surface may clip instead of scrolling (a settings dialog with no
        // scrollable content column, or a panel container that hides overflow).
        // Probe the ancestors once the snapshot is on screen and, only when none
        // of them scrolls, take over the overflow here.
        React.useEffect(() => {
          if (state.status !== 'ready') return;
          if (typeof window === 'undefined' || typeof document === 'undefined') return;
          if (typeof window.getComputedStyle !== 'function') return;
          const node = rootRef.current;
          if (node === null || node === undefined || typeof node.parentElement === 'undefined') return;
          let current = node.parentElement;
          let scrollable = false;
          while (current !== null && current !== undefined && current !== document.body) {
            const style = window.getComputedStyle(current);
            if (/(auto|scroll|overlay)/.test(String(style.overflowY))) {
              scrollable = true;
              break;
            }
            current = current.parentElement;
          }
          setSelfScroll(scrollable === false);
        }, [state.status]);

        const uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined;

        const addDir = React.useCallback(async (value) => {
          const target = String(value ?? '').trim();
          if (target === '') return;
          const result = await run('addDir', { path: target }, null);
          if (result !== null) {
            setDraft('');
            if (result.resolvedFrom !== undefined) {
              setNote({
                tone: 'ok',
                text: format(t('packResolved'), {
                  picked: result.resolvedFrom.picked,
                  path: result.path,
                  n: result.resolvedFrom.skills,
                }),
              });
              return;
            }
            setNote({
              tone: 'ok',
              text: result.added === true
                ? format(t('added'), { path: target })
                : format(t('addedAlready'), { path: target }),
            });
          }
        }, [run]);

        const pickDir = React.useCallback(async () => {
          if (uiWorkspace === undefined || typeof uiWorkspace.pickDirectory !== 'function') {
            setNote({ tone: 'error', text: t('pickerUnavailable') });
            return;
          }
          let chosen;
          try {
            chosen = await uiWorkspace.pickDirectory();
          } catch (error) {
            setNote({ tone: 'error', text: `${t('failed')}${t('colon')}${describeError(t, error)}` });
            return;
          }
          if (chosen === null || chosen === undefined || chosen === '') return;
          await addDir(chosen);
        }, [uiWorkspace, addDir]);

        const onToggle = React.useCallback(async (skill, enabled) => {
          const result = await run('setEnabled', { name: skill.name, enabled }, null);
          if (result !== null) {
            setNote({
              tone: 'ok',
              text: enabled ? format(t('toggledOn'), { name: skill.name }) : format(t('toggledOff'), { name: skill.name }),
            });
          }
        }, [run]);

        const dirAll = React.useCallback(async (dir, enabled) => {
          const result = await run('setAllEnabled', { enabled, root: dir.path }, null);
          if (result !== null) {
            setNote({ tone: 'ok', text: format(enabled ? t('dirOn') : t('dirOff'), { n: result.affected ?? dir.skills }) });
          }
        }, [run]);

        const usePack = React.useCallback(async (dir) => {
          const result = await run('replaceWithPack', { path: dir.path }, null);
          if (result !== null) {
            setNote({ tone: 'ok', text: format(t('packUsed'), { path: result.path ?? dir.path, n: result.pack?.skills ?? 0 }) });
          }
        }, [run]);

        const removeDir = React.useCallback(async (dir) => {
          const confirmed = typeof window === 'undefined'
            || typeof window.confirm !== 'function'
            || window.confirm(t('removeConfirm'));
          if (!confirmed) return;
          const result = await run('removeDir', { path: dir.path }, null);
          if (result !== null) setNote({ tone: 'ok', text: format(t('removed'), { path: dir.path }) });
        }, [run]);

        // Expansion is keyed by directory path, so a snapshot refresh keeps the
        // packs the user opened open.
        const toggleExpand = React.useCallback((key) => {
          setExpanded((previous) => {
            const next = new Set(previous);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        }, []);

        const data = state.data;
        // Normalize the snapshot defensively: an unexpected shape must not
        // throw during render, because a throwing component blanks the slot.
        const dirs = Array.isArray(data?.dirs) ? data.dirs : [];
        const allSkills = Array.isArray(data?.skills) ? data.skills : [];
        const duplicates = Array.isArray(data?.duplicates) ? data.duplicates : [];
        const invalidEntries = Array.isArray(data?.invalid) ? data.invalid : [];
        const provider = data?.provider ?? { name: 'skill-market', rank: 0, masked: 0 };
        // Older Host generations serve no feature table: hide the controls they
        // cannot answer instead of calling an endpoint they do not implement.
        const features = data?.features ?? {};
        const counts = data?.counts ?? { dirs: 0, skills: 0, enabled: 0, disabled: 0, invalid: 0, duplicates: 0 };
        const needle = filter.trim().toLowerCase();

        // Group skills by the directory they came from: one pack row per
        // registered directory, that directory's skills as its child rows.
        const groups = [];
        const groupOfRoot = new Map();
        for (const dir of dirs) {
          const group = { dir, skills: [], invalid: [] };
          groupOfRoot.set(dir.path, group);
          groups.push(group);
        }
        for (const skill of allSkills) {
          const group = groupOfRoot.get(skill.root);
          if (group !== undefined) {
            group.skills.push(skill);
            continue;
          }
          // Defensive: a skill whose root is not in `dirs` still gets a row.
          const orphan = {
            dir: { path: skill.root, exists: true, removable: false, skills: 1, invalid: 0 },
            skills: [skill],
            invalid: [],
          };
          groupOfRoot.set(skill.root, orphan);
          groups.push(orphan);
        }
        for (const entry of invalidEntries) {
          const group = groupOfRoot.get(entry.root);
          if (group !== undefined) group.invalid.push(entry);
        }

        const matchesSkill = (skill) => {
          if (needle === '') return true;
          const description = typeof skill.description === 'string' ? skill.description : '';
          const relative = typeof skill.relative === 'string' ? skill.relative : '';
          return skill.name.toLowerCase().includes(needle)
            || description.toLowerCase().includes(needle)
            || relative.toLowerCase().includes(needle);
        };
        const matchesInvalid = (entry) => needle === ''
          || String(entry.relative ?? '').toLowerCase().includes(needle)
          || String(entry.error ?? '').toLowerCase().includes(needle);
        const visibleGroups = groups
          .map((group) => ({
            ...group,
            matchedSkills: group.skills.filter(matchesSkill),
            matchedInvalid: group.invalid.filter(matchesInvalid),
          }))
          .filter((group) => needle === '' || group.matchedSkills.length + group.matchedInvalid.length > 0);
        // Open when the user expanded the pack, or while a filter is active
        // (filtering shows only matching packs and their matching rows).
        const isOpen = (group) => (needle === ''
          ? expanded.has(group.dir.path)
          : group.matchedSkills.length + group.matchedInvalid.length > 0);

        const children = [];

        children.push(h('div', { key: 'head', className: 'dsm-head' }, [
          h('h2', { key: 'title', className: 'dsm-heading' }, t('title')),
          h('p', { key: 'intro', className: 'dsm-intro' }, t('intro')),
        ]));

        if (state.status === 'loading' && data === null) {
          children.push(h('p', { key: 'loading', className: 'dsm-empty' }, t('loading')));
        }

        if (state.status === 'error') {
          children.push(h('div', { key: 'error', className: 'dsm-note dsm-note-error' }, [
            h('span', { key: 'text', className: 'dsm-note-text' }, `${t('failed')}${t('colon')}${state.error}`),
            h('button', { key: 'retry', type: 'button', className: 'dsm-btn dsm-btn-outline', onClick: () => void load() }, t('retry')),
          ]));
        }

        if (data !== null && data !== undefined) {
          children.push(h('div', { key: 'bar', className: 'dsm-bar' }, [
            h('button', {
              key: 'pick',
              type: 'button',
              className: 'dsm-btn dsm-btn-primary',
              disabled: busy,
              onClick: () => void pickDir(),
            }, t('addDir')),
            h('button', {
              key: 'default',
              type: 'button',
              className: 'dsm-btn dsm-btn-outline',
              disabled: busy,
              title: data.defaultDir,
              onClick: async () => {
                const result = await run('ensureDefaultDir', {}, null);
                if (result !== null) setNote({ tone: 'ok', text: format(t('defaultReady'), { path: result.path ?? data.defaultDir }) });
              },
            }, t('useDefault')),
            h('span', { key: 'spacer', className: 'dsm-spacer' }),
            h('button', {
              key: 'all-on',
              type: 'button',
              className: 'dsm-btn dsm-btn-outline',
              disabled: busy || counts.skills === 0,
              onClick: async () => {
                const result = await run('setAllEnabled', { enabled: true }, null);
                if (result !== null) setNote({ tone: 'ok', text: t('allOn') });
              },
            }, t('enableAll')),
            h('button', {
              key: 'all-off',
              type: 'button',
              className: 'dsm-btn dsm-btn-outline',
              disabled: busy || counts.skills === 0,
              onClick: async () => {
                const result = await run('setAllEnabled', { enabled: false }, null);
                if (result !== null) setNote({ tone: 'ok', text: t('allOff') });
              },
            }, t('disableAll')),
            h('button', {
              key: 'refresh',
              type: 'button',
              className: 'dsm-btn dsm-btn-outline',
              disabled: busy,
              onClick: async () => {
                const result = await run('refresh', {}, null);
                if (result !== null) setNote({ tone: 'ok', text: t('refreshed') });
              },
            }, t('refresh')),
          ]));

          children.push(h('div', { key: 'manual', className: 'dsm-bar' }, [
            h('input', {
              key: 'input',
              className: 'dsm-input',
              type: 'text',
              value: draft,
              spellCheck: false,
              placeholder: t('addPlaceholder'),
              onChange: (event) => setDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void addDir(draft);
                }
              },
            }),
            h('button', {
              key: 'add',
              type: 'button',
              className: 'dsm-btn dsm-btn-outline',
              disabled: busy || draft.trim() === '',
              onClick: () => void addDir(draft),
            }, t('add')),
          ]));

          if (note !== null) {
            children.push(h('div', { key: 'note', className: `dsm-note ${note.tone === 'error' ? 'dsm-note-error' : 'dsm-note-ok'}` }, [
              h('span', { key: 'text', className: 'dsm-note-text' }, note.text),
              h('button', {
                key: 'close',
                type: 'button',
                className: 'dsm-note-close',
                'aria-label': t('close'),
                onClick: () => setNote(null),
              }, '\u00d7'),
            ]));
          }

          if (busy) children.push(h('p', { key: 'busy', className: 'dsm-intro' }, t('busy')));
          if (refreshing) children.push(h('p', { key: 'refreshing', className: 'dsm-intro' }, t('refreshing')));

          // Configuration diagnostics: a present-but-unusable value is reported
          // instead of being silently replaced by its default.
          if (features.configDiagnostics === true && Array.isArray(data.config?.warnings) && data.config.warnings.length > 0) {
            children.push(h('div', { key: 'config', className: 'dsm-note dsm-note-error' }, [
              h('span', { key: 'text', className: 'dsm-note-text' },
                format(t('configNote'), { text: data.config.warnings.join('；') })),
            ]));
          }

          // Discovery truthfulness: a budget-truncated scan must say so.
          if (data.incomplete === true) {
            children.push(h('div', { key: 'incomplete', className: 'dsm-note' }, [
              h('span', { key: 'text', className: 'dsm-note-text' }, t('incompleteNote')),
            ]));
          }

          if (typeof data.stateError === 'string' && data.stateError !== '') {
            children.push(h('div', { key: 'state-error', className: 'dsm-note dsm-note-error' }, [
              h('span', { key: 'text', className: 'dsm-note-text' },
                format(t('stateErrorNote'), { text: data.stateError })),
            ]));
          }

          // Switched-off names whose skill disappeared: user-controlled cleanup,
          // never an automatic loss of a still-valid preference.
          if (features.pruneDisabled === true && Array.isArray(data.staleDisabled) && data.staleDisabled.length > 0) {
            children.push(h('div', { key: 'stale', className: 'dsm-note' }, [
              h('span', { key: 'text', className: 'dsm-note-text' },
                `${t('staleTitle')}${t('colon')}${format(t('staleNote'), { n: data.staleDisabled.length })}`),
              h('button', {
                key: 'prune',
                type: 'button',
                className: 'dsm-btn dsm-btn-outline',
                disabled: busy,
                onClick: async () => {
                  const result = await run('pruneDisabled', {}, null);
                  if (result !== null) setNote({ tone: 'ok', text: format(t('pruned'), { n: (result.removed ?? []).length }) });
                },
              }, t('prune')),
            ]));
          }

          if (counts.enabled > 40) {
            children.push(h('div', { key: 'many', className: 'dsm-note' }, [
              h('span', { key: 'text', className: 'dsm-note-text' }, format(t('manyEnabled'), { n: counts.enabled })),
            ]));
          }

          children.push(h('div', { key: 'stats', className: 'dsm-stats' }, [
            h('span', { key: 'dirs', className: 'dsm-stat' }, [`${t('statDirs')} `, h('strong', { key: 'v' }, String(counts.dirs))]),
            h('span', { key: 'skills', className: 'dsm-stat' }, [`${t('statSkills')} `, h('strong', { key: 'v' }, String(counts.skills))]),
            h('span', { key: 'on', className: 'dsm-stat' }, [`${t('statEnabled')} `, h('strong', { key: 'v' }, String(counts.enabled))]),
            h('span', { key: 'off', className: 'dsm-stat' }, [`${t('statDisabled')} `, h('strong', { key: 'v' }, String(counts.disabled))]),
            counts.invalid === 0 ? null : h('span', { key: 'invalid', className: 'dsm-stat' }, [`${t('statInvalid')} `, h('strong', { key: 'v' }, String(counts.invalid))]),
          ]));

          children.push(h('div', { key: 'tree-section', className: 'dsm-section' }, [
            h('div', { key: 'head', className: 'dsm-bar' }, [
              h('h3', { key: 'title', className: 'dsm-section-title' }, t('skillsTitle')),
              h('span', { key: 'spacer', className: 'dsm-spacer' }),
              h('button', {
                key: 'expand-all',
                type: 'button',
                className: 'dsm-btn dsm-btn-outline',
                disabled: busy || groups.length === 0,
                onClick: () => setExpanded(new Set(groups.map((group) => group.dir.path))),
              }, t('expandAll')),
              h('button', {
                key: 'collapse-all',
                type: 'button',
                className: 'dsm-btn dsm-btn-outline',
                disabled: busy || expanded.size === 0,
                onClick: () => setExpanded(new Set()),
              }, t('collapseAll')),
              h('input', {
                key: 'filter',
                className: 'dsm-input',
                type: 'text',
                value: filter,
                spellCheck: false,
                placeholder: t('filterPlaceholder'),
                'aria-label': t('filterLabel'),
                style: { flex: '0 1 240px' },
                onChange: (event) => setFilter(event.target.value),
              }),
            ]),
            dirs.length === 0
              ? h('p', { key: 'empty', className: 'dsm-empty' }, t('dirsEmpty'))
              : visibleGroups.length === 0
                ? h('p', { key: 'filtered-empty', className: 'dsm-empty' }, t('skillsFilteredEmpty'))
                : h('ul', { key: 'tree', className: 'dsm-tree' }, visibleGroups.map((group, index) => h(PackGroup, {
                  key: group.dir.path,
                  t,
                  group,
                  index,
                  open: group.dir.exists === true && isOpen(group),
                  busy,
                  features,
                  onToggleExpand: toggleExpand,
                  onToggleSkill: (target, enabled) => void onToggle(target, enabled),
                  onDirAll: (dir, enabled) => void dirAll(dir, enabled),
                  onRemove: (dir) => void removeDir(dir),
                  onUsePack: (dir) => void usePack(dir),
                }))),
          ]));

          if (duplicates.length > 0) {
            children.push(h('details', { key: 'dups', className: 'dsm-details' }, [
              h('summary', { key: 'summary' }, `${t('duplicatesTitle')} (${duplicates.length})`),
              h('ul', { key: 'list', className: 'dsm-list' }, duplicates.map((entry) => h(
                'li',
                { key: entry.path },
                `${entry.name} — ${entry.path} → ${entry.shadowedBy}`,
              ))),
            ]));
          }

          children.push(h('div', { key: 'footer', className: 'dsm-footer' }, [
            h('span', { key: 'state' }, `${t('statePath')}${t('colon')}`, h('span', { className: 'dsm-code' }, String(data.statePath ?? ''))),
            h('span', { key: 'provider' }, [
              `${provider.name} · ${t('providerRank')} ${provider.rank} · `,
              data.watching === true ? t('watching') : t('notWatching'),
              provider.masked > 0 ? ` · ${format(t('maskedNote'), { n: provider.masked })}` : '',
            ].join('')),
            h('span', { key: 'hint' }, t('footerHint')),
          ]));
        }

        return h('div', { className: `dsm-root${selfScroll === true ? ' dsm-root-scroll' : ''}`, ref: rootRef }, children);
      };
    }

    /** The sidebar rail glyph, sized by the sidebar's icon share. */
    function SkillMarketIcon({ size = 16 } = {}) {
      const edge = typeof size === 'number' && size > 0 ? size : 16;
      return h('svg', {
        width: edge,
        height: edge,
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        style: { display: 'block' },
      }, [
        h('path', { key: 'awning', d: 'M1.6 3.2h12.8v2.1H1.6z', fill: 'currentColor' }),
        h('path', { key: 'crate', d: 'M3 6.6h10l-.7 7.1a1.1 1.1 0 0 1-1.1 1H4.8a1.1 1.1 0 0 1-1.1-1z', fill: 'currentColor', opacity: 0.34 }),
        h('rect', { key: 'left', x: 4.7, y: 8.2, width: 2.7, height: 2.7, rx: 0.6, fill: 'currentColor' }),
        h('rect', { key: 'right', x: 8.6, y: 8.2, width: 2.7, height: 2.7, rx: 0.6, fill: 'currentColor', opacity: 0.62 }),
      ]);
    }

    /**
     * Isolate renderer failures: one malformed snapshot entry must not blank the
     * whole Settings slot. Class-based on real React; a passthrough under the
     * test stub, which has no React.Component.
     */
    const SkillMarketBoundary = typeof React.Component === 'function'
      ? class SkillMarketBoundary extends React.Component {
          constructor(props) {
            super(props);
            this.state = { failed: false };
          }

          static getDerivedStateFromError() {
            return { failed: true };
          }

          componentDidCatch(error) {
            if (typeof console !== 'undefined') console.error('[skill-market] render failed', error);
          }

          render() {
            if (this.state.failed) return h('p', { className: 'dsm-empty' }, this.props.failedText);
            return h(this.props.content, {});
          }
        }
      : function SkillMarketBoundary(props) {
          return h(props.content, {});
        };

    /** Cordis browser plugin body. */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'skill-market: dictionaries');
      // Styles must exist before any surface renders: the session picker lives in
      // the conversation shell, so a page that never opened Settings still needs
      // every `.dsm-*` rule. One global stylesheet, removed on dispose.
      ctx.effect(() => {
        if (typeof document === 'undefined' || document.head === undefined) return () => {};
        const style = document.createElement('style');
        style.setAttribute('data-skill-market', '');
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => {
          if (style.parentNode !== undefined && style.parentNode !== null) style.parentNode.removeChild(style);
          else if (typeof style.remove === 'function') style.remove();
        };
      }, 'skill-market: styles');
      const t = ctx.locale.bind(NS);
      const Section = createSection(ctx);

      /** The section behind the error boundary; each slot gets its own instance. */
      function SkillMarketSurface() {
        return h(SkillMarketBoundary, { content: Section, failedText: t('renderFailed') });
      }

      // Settings → 技能管理 (one page next to 「插件」).
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: SECTION_ID,
        order: 18,
        label: () => t('nav'),
        locale: NS,
      }, SkillMarketSurface));

      // The same cards as a first-class sidebar panel, so the surface is
      // reachable without opening Settings (the pattern the Plugins page uses).
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 5,
        label: () => t('nav'),
        locale: NS,
      }, SkillMarketIcon));
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
      }, function SkillMarketPanel() {
        return h('div', { className: 'dsm-panel' }, h(SkillMarketSurface, {}));
      }));

      // Session-scoped skill picker: the New Session row (labelled) and the
      // composer tool row (icon only). Both read `sessionId` from the slot's
      // standard props and hide themselves when the Host cannot serve it.
      const SessionSkillsHero = createSessionSkillsButton(ctx, 'hero');
      const SessionSkillsCompact = createSessionSkillsButton(ctx, 'compact');
      ctx.slots.inject('conversation.hero.options', () => ctx.slots.register({
        name: 'conversation.hero.options',
        id: 'session-skills',
        order: 40,
        label: () => t('sessionSkillsLabel'),
        locale: NS,
      }, SessionSkillsHero));
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'session-skills',
        order: 40,
        label: () => t('sessionSkillsLabel'),
        locale: NS,
      }, SessionSkillsCompact));
    }

    return { inject, apply };
  },
});
