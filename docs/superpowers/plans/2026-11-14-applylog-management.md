# ApplyLog 时间线、提醒与四状态实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成用户 2026-11-14 的五项开发需求，并验证旧数据兼容及真实页面交互。

**Architecture:** 保持 version 1，读取时派生四状态口径，不迁移或写回历史。时间线用原数组位置与完整数组指纹共同校验删除请求；提醒通过原 ID 更新，独立编辑页使用共享键盘与返回逻辑。题本使用卡片导航、独立展开和长按保护。

**Tech Stack:** 原生微信小程序 JS/WXML/WXSS、Skyline、glass-easel、Node test、微信原生编译器。

**Spec:** 用户本轮完整需求；审查基线见 `APPLYLOG-REVIEW.md`。直接修改现有 ApplyLog 工作区，保留未提交改动，不提交其他已有工作。

## Global Constraints

- 保留 `applylog-data`、version 1、现有 ID、未知元数据与扩展字段。
- 保留视觉风格、Skyline、glass-easel、自定义导航、底栏和共享键盘适配。
- 不新增云服务、UI 库；不清空真实数据。模拟器写盘前备份，finally 恢复核验。
- 新状态仅 `submitted`、`interview`、`offer`、`rejected`。旧 `assessment` 只派生归类，旧 `withdrawn` 由用户确认。
- 时间线只删除，删除不改变当前状态。提醒编辑不操作手机日历。

## Review Focus

- 时间线重复条目及确认弹窗期间刷新：整数组指纹和页面操作世代失效，不能删错。
- 非整分钟历史提醒：表单未改变实际时间时保留原毫秒时间，避免拒绝合法历史编辑。
- 旧放弃记录编辑其他内容、未知状态：前者可读写非状态字段，后者禁止覆盖。
- 保存成功但返回失败：相同表单重试只返回，不重复写入。
- 卡片长按文本、回答展开、快速连点：不发生意外导航，返回保留阅读状态。

### Task 1: 四状态兼容与统计

**Files:** `utils/constants.js`、`utils/store.js`、`utils/ui.js`、`utils/demo.js`、`components/status-tag/*`、首页/详情/我的展示、`tests/management.test.js`、现有状态测试。
**Interfaces:** `effectiveStatus(status)`；可选状态与可读历史状态分开；`snapshot().stats()` 提供 `pendingStatusCount`。
- [x] RED：四状态、新写入拒绝旧状态、旧记录只读不写盘、归类和统计、旧记录普通编辑。
- [x] GREEN：实现并运行针对性测试，再更新因产品口径改变而过期的旧断言。

### Task 2: 时间线删除管理

**Files:** `utils/store.js`、`pages/detail/*`、`tests/management.test.js`。
**Interfaces:** `removeTimelineEntry(id, { index, fingerprint })`；页面条目 key 映射到原位置与数组指纹。
- [x] RED：模式、确认取消、重复/逆序/过期、最后一条、写盘失败、统计及当前状态不变。
- [x] GREEN：模式按钮和 44px 删除热区、防连点、离页失效、空数组校验及提示。

### Task 3: 独立提醒编辑

**Files:** `utils/store.js`、`utils/reminder.js`、`pages/reminder-edit/*`、`pages/detail/*`、`app.json`、测试。
**Interfaces:** `updateReminder(applicationId, reminderId, input)`；编辑路由 `pages/reminder-edit/reminder-edit?id=…&reminder=…`。
- [x] RED：保留 ID/完成/扩展/日历字段、历史时间/秒数、类型草稿、失败重试、返回失败、来源消失。
- [x] GREEN：保存原提醒、共享字段限制、键盘安全区、卡片入口与按钮 catchtap、日历边界文案。

### Task 4: 题本卡片导航与移除复制

**Files:** `pages/questions/*`、`tests/questions.test.js`、针对性交互测试。
**Interfaces:** 原来源 ID 路由保持；回答 catchtap；卡片长按标记与导航锁在重新进入时重置。
- [x] RED：卡片来源校验、防连点、失败恢复、展开/长按、返回状态和删除来源。
- [x] GREEN：移除复制相关代码/样式/测试，绑定主体点击及无障碍语义。

### Task 5: 整体验证与审查记录

- [x] `node --test ./tests/*.test.js`：所有测试通过，记录新旧口径覆盖。
- [x] `node ./tests/validate.js <installed wcc-exec>`：原生模板/样式与 8 页配置通过。
- [x] 独立复核完整本次改动；处理重要问题。
- [x] 模拟器备份、独立 QA 数据验证页面、热区、键盘和路由；恢复原存储及设备配置并核验。Skyline 多行 textarea 显示异常已与原编辑页对照复现，列为未通过的显示验收项，保留完整字符串并记录工具／真机复测边界。
- [x] 更新审查报告，说明手机日历与真机验证边界。
