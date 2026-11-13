# ApplyLog V1.0 发布前收尾实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地完整本地 JSON 备份／整份恢复、能力与隐私说明、表单未保存保护，并按真实证据给出发布前清单。
**Architecture:** 复用 version 1 校验，备份文件包裹格式／版本／时间；导入先预览，确认后独立持久化原值回滚快照，再单次替换业务键并读回核验。说明页与版本来源统一；三类编辑页按实际表单快照比较，共用导航事件及官方离页提醒能力。
**Tech Stack:** 原生 JS/WXML/WXSS、Skyline、glass-easel、微信文件交互、Node test、现有原生编译器；不新增依赖。
**Spec:** 用户本轮完整“V1.0发布前收尾”七节要求，按其明确授权直接实施，不等待方案审批。

## Global Constraints

- 保留 `applylog-data`、version 1、ID、历史状态、合法空时间线、未知元数据／扩展字段；保留底栏、导航、城市／渠道偏好及共享键盘。
- 不增加云同步、AI、标签或图表；不改写用户换行、不切换渲染器掩盖 textarea 问题。
- 备份保持完整 UTF-8 JSON，支持旧完整 JSON；保留损坏数据原始复制。整份恢复不合并、不去重、不先清空，不调用系统日历。
- 恢复前无写入；确认后先保留并核验当前原始值，提供回滚。任何校验／原值备份失败均停止；写后核验失败尝试原样回滚，无法回滚明确告警并保留快照。
- API／容量限制明确报错，文件名含 ApplyLog 与时间；文件仍在小程序内不宣称已保存到手机。
- 日历历史标记保留，导入后增加可选待核对标识，明确系统日历不迁移。说明数据外部备份、删除和微信平台处理边界。
- 以内容初始快照判断未保存，保留草稿，保存成功更新快照；导航／系统返回失败可重试，不能在 onHide/onUnload 强拦。
- 原数据／设备配置先备份后测试并恢复核验，故障注入仅独立数据。后台主体信息／隐私配置、手机通知和输入法均不得虚构通过。

## Review Focus

- 导入预览期间本机数据改变、连点／取消、文件元数据不可信：确认时重新检查，不能覆盖中途新数据。
- 原业务数据损坏也必须能可靠备份供回滚；回滚快照损坏或写入失败不能冒充安全。
- 备份嵌套未知字段、大量中文／emoji、大小边界与容量不足：按真实 UTF-8 字节检查，不截断。
- 恢复后旧日历标记不能代表当前设备事件；完成／逾期提醒也走显式核对。
- 表单展示字段、题目临时 key、类型切换、改回原值与返回失败：不误报、不重复写、不丢未保存内容。

### Task 1: 备份与恢复引擎

**Files:** `utils/store.js`、新 `utils/backup.js`、`utils/privacy.js`、`tests/backup.test.js`、测试辅助。
**Interfaces:** `store.validateData(data)` 无副作用；`backup.parseBackup(text)` 返回数据／时间／数量；`backup.restore(preview)` 和 `backup.rollback()` 做持久快照、替换、读回及回滚；文件选择／UTF-8 导出封装保留微信取消语义。
- [x] RED：新旧文件、损坏／未知版本／重复ID／空时间线／历史状态／扩展字段／字节与容量、预览无写入、失败与回滚、无日历调用。
- [x] GREEN：实现共享校验、容量预检和文件流程；新恢复记录保留日历标记并需用户核对；全套回归。

### Task 2: 备份界面与说明

**Files:** `pages/mine/*`、新 `pages/backup/*`、`pages/help/*`、`utils/app-info.js`、`utils/guide.js`、首页、`app.json`、相关测试。
**Interfaces:** 我的导出／恢复／回滚与旧复制入口；备份页选择→预览→确认；说明页、首次一次性提示；官方 feedback 按钮，运行环境版本统一。
- [x] RED：选择／预览取消不写入，连点／失败／重试，成功后刷新，救援出口可用；首次提示与版本环境。
- [x] GREEN：补 UI、明确隐私及日历边界、删除提示；去掉未配置订阅占位代码；全套回归。

### Task 3: 三类表单未保存保护

**Files:** 新 `utils/leave-guard.js`、`pages/edit/*`、`pages/interview/*`、`pages/reminder-edit/*`、`utils/ui.js`、`tests/leave-guard.test.js`。
**Interfaces:** 页面 `editSnapshot()`，共用初始／保存快照、`requestLeave()`、官方 `enableAlertBeforeUnload`（能力不足明确边界）；公共导航 `delta=0` / `back` 事件。
- [x] RED：无改动／实际改动／改回原值／展示变化／保存后返回失败与重试、重复确认、隐藏草稿不清空。
- [x] GREEN：接入三表单，成功保存立即更新快照并关闭离页提醒；同内容返回重试不重复写盘；全套回归。

### Task 4: 实际验证、复核与发布清单

**Files:** `APPLYLOG-REVIEW.md`；原生 QA 证据放临时目录。
- [x] 运行全部逻辑测试及原生编译／配置校验。
- [x] 官方当前工具及可用 Android 完成可执行的文件、360／390px 界面、三表单输入／保存、导航及日历取消核对；用户于 2026-11-14 补充确认 Android 日历权限拒绝和通知通过，按用户真机复测记载；iOS 等未验证项保留最短步骤。
- [x] 独立完整代码复核，修复重要问题并针对性 RED→GREEN。
- [x] 手机各批原数据与模拟器四键均已恢复／核验，保护文件与 private 配置逐字节相同；报告已区分四类发布项目，后台和剩余真机项未虚构完成。

### Task 5: 用户追加的示例管理范围

**Decision:** 用户明确选择“仅开发者工具中的开发版开放，手机默认隐藏”；不增加登录或服务端，不把环境字段当成微信用户角色认证。
- [x] RED→GREEN：环境矩阵、缺失／异常 API、隐藏处理函数直接调用和确认期间环境变化，3 项针对性测试。
- [x] 页面及处理函数共同限制，仅 `develop` + `devtools` 开放；保留已有示例和数据标识。
- [x] 原生条件渲染复核；完整回归 149／149、原生编译／10 页配置通过，报告已同步。最新示例限制未再次加载到手机，明确保留待手机确认项。
