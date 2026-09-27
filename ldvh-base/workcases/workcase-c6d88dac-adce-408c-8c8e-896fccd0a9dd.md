---
fact_type_key: workcase
object_uid: c6d88dac-adce-408c-8c8e-896fccd0a9dd
title: Web 子进程停摆自愈缺失
status: draft
gist: LDVH 的对话 Tab 与侧边栏页面由插件自带的 Web 子进程供给；该子进程被源码热刷新回收后没有任何自愈路径，页面会整片空白，只有重载插件或手工发一次请求才能恢复，而设置页的探活走宿主路由、探不出这次故障。本单修好回收与重拉的闭环、收紧回收判据、对齐探活口径；要 Human 决定的是是否把前端兜底与一处类型报错并入范围。
serves: SG-3
summary: |-
  修复 LDVH 插件 Web 呈现的停摆缺陷：对话 Tab 与侧边栏的 LDVH 页面由插件自带的 Express 子进程供给（plugin/lib/web-mount.js 的 createWebApiProcess 起在 127.0.0.1:3299；iframe 用绝对地址 http://127.0.0.1:<webPort>/ldvh/），而该子进程在源码热刷新（fs.watch(plugin/web/api)）触发回收后，只由「走代理的 /ldvh/api/* 请求」重拉——那个请求恰恰来自已经打不开的页面，于是形成死锁：进程一死就再不自愈。

  ### 缺陷三处
  ① 回收后无自愈：kill 之后既不重新预热，也没把重拉挂到探活或页面加载失败的路径上；② 回收触发过宽敏：对 plugin/web/api 下任何 mtime 事件都回收子进程，内容一字未改也回收；③ 探活与消费不同路：客户端探活用相对路径 /ldvh/ 与 /ldvh/api/health，命中的是宿主路由，宿主自己能返回 SPA 与 health，故探活报「可用」而 iframe 实为空白。

  ### 已核事实（2026-09-27 现场取证）
  宿主 09:28:12 启动时子进程预热成功（3299 监听）；09:55:21 plugin/web/api/services/facts.ts 的 mtime 被触碰而内容未变（git 状态干净），回收随即发生；此后 3299 无监听，直到手工请求 http://127.0.0.1:49225/ldvh/api/governed-projects 走代理触发 ensureReady() 才恢复（/ldvh/ 与 /ldvh/api/health 恢复 200）。子进程死时，宿主侧相对路径 /ldvh/ 与 /ldvh/api/health 仍返回 200，故探警报不出故障。另：plugin/web/api/app.ts 的 app.handle 只在类型层报错（tsc TS2339），运行时 express 4.22.2 确有该方法、子进程可正常启动，与本缺陷无因果。

  ### 查重结论
  现有 WorkCase 均不覆盖 Web 子进程生命周期与探活口径：呈现保真与设计语言收敛、卡片与详情对齐设计语言、详情页 YAML 呈现推广三单讲的是页面与字段呈现，关闭侧身份门禁那单讲的是复核身份，均与本单无重叠；本次为该缺陷首次立单。

  ### 边界
  只修子进程生命周期与探活口径：不重做 Web 页面、不改呈现契约（specs/10 §5.5）、不改宿主 dsh-app 转发与身份头判据、不处理 app.handle 的类型报错（除非 Human 并入范围）。
scope: |-
  做什么：
  - 让 Web 子进程在「源码热刷新回收」与「意外退出」之后都能自愈：回收动作自身负责重新预热，或把重拉挂到探活与页面加载失败的路径上，使页面无需人工干预即可恢复。
  - 收紧回收判据：对 plugin/web/api 下的变更先比对内容（mtime+size 或内容指纹），内容未变不回收，避免无谓停摆。
  - 对齐探活与消费口径：客户端探活须探 iframe 真正要连的那一个地址（由 /ldvh/api/health 的 webPort 得到的绝对回环地址），使「可用」结论代表 iframe 的真实可用性。

  明确不做什么：
  - 不重做 Web 页面、不改呈现契约（specs/10 §5.5 不动）。
  - 不改宿主 dsh-app 转发与身份头判据，d7a19a1 的绕行方案维持。
  - 不处理 plugin/web/api/app.ts 的 app.handle 类型报错（tsc TS2339），它与本缺陷无因果、独立处置。
  - 不改 21 号规范，不改 writer/tools 与其它事实类型。
plan:
  - done_criteria: 在本机改动 plugin/web/api 下任一文件触发一次回收，不依赖任何人工请求，http://127.0.0.1:<webPort>/ldvh/ 在 30 秒内恢复 200；并有自动化测试覆盖「回收→自愈」路径且通过
    step: 回收后自愈：源码热刷新回收后子进程自动重新预热
  - done_criteria: 仅触碰 plugin/web/api 下文件的 mtime 而内容不变时，子进程 pid 保持不变；内容真变时 pid 变化——两条均由测试断言
    step: 回收判据收紧：内容未变不回收子进程
  - done_criteria: 子进程不可用时客户端探活结论为「不可用」（修复前实测报「可用」），可用时报「可用」；测试钉住探活 URL 与 iframe 地址同源同端口
    step: 探活口径对齐：探活命中 iframe 真实地址
  - done_criteria: 宿主启动 → 触碰 plugin/web/api 下文件 → 不经任何人工请求打开 LDVH 页面，页面正常渲染且该端口保持监听；记录实跑观察与宿主日志
    step: 现场恢复验证：真实宿主上按原故障路径验证页面自愈
created_at: 2026-09-27T02:51:25.153Z
change_log:
  - at: 2026-09-27T02:51:25.153Z
    provider: ds-4sf
    model: deepseek-v4.1-flash
    summary: 创建工单（C1 提案）：修复 LDVH Web 呈现子进程回收后不自愈与探活口径失真
---

# Web 子进程停摆自愈缺失

## 摘要

修复 LDVH 插件 Web 呈现的停摆缺陷：对话 Tab 与侧边栏的 LDVH 页面由插件自带的 Express 子进程供给（plugin/lib/web-mount.js 的 createWebApiProcess 起在 127.0.0.1:3299；iframe 用绝对地址 http://127.0.0.1:<webPort>/ldvh/），而该子进程在源码热刷新（fs.watch(plugin/web/api)）触发回收后，只由「走代理的 /ldvh/api/* 请求」重拉——那个请求恰恰来自已经打不开的页面，于是形成死锁：进程一死就再不自愈。

### 缺陷三处
① 回收后无自愈：kill 之后既不重新预热，也没把重拉挂到探活或页面加载失败的路径上；② 回收触发过宽敏：对 plugin/web/api 下任何 mtime 事件都回收子进程，内容一字未改也回收；③ 探活与消费不同路：客户端探活用相对路径 /ldvh/ 与 /ldvh/api/health，命中的是宿主路由，宿主自己能返回 SPA 与 health，故探活报「可用」而 iframe 实为空白。

### 已核事实（2026-09-27 现场取证）
宿主 09:28:12 启动时子进程预热成功（3299 监听）；09:55:21 plugin/web/api/services/facts.ts 的 mtime 被触碰而内容未变（git 状态干净），回收随即发生；此后 3299 无监听，直到手工请求 http://127.0.0.1:49225/ldvh/api/governed-projects 走代理触发 ensureReady() 才恢复（/ldvh/ 与 /ldvh/api/health 恢复 200）。子进程死时，宿主侧相对路径 /ldvh/ 与 /ldvh/api/health 仍返回 200，故探警报不出故障。另：plugin/web/api/app.ts 的 app.handle 只在类型层报错（tsc TS2339），运行时 express 4.22.2 确有该方法、子进程可正常启动，与本缺陷无因果。

### 查重结论
现有 WorkCase 均不覆盖 Web 子进程生命周期与探活口径：呈现保真与设计语言收敛、卡片与详情对齐设计语言、详情页 YAML 呈现推广三单讲的是页面与字段呈现，关闭侧身份门禁那单讲的是复核身份，均与本单无重叠；本次为该缺陷首次立单。

### 边界
只修子进程生命周期与探活口径：不重做 Web 页面、不改呈现契约（specs/10 §5.5）、不改宿主 dsh-app 转发与身份头判据、不处理 app.handle 的类型报错（除非 Human 并入范围）。

## 授权范围

做什么：
- 让 Web 子进程在「源码热刷新回收」与「意外退出」之后都能自愈：回收动作自身负责重新预热，或把重拉挂到探活与页面加载失败的路径上，使页面无需人工干预即可恢复。
- 收紧回收判据：对 plugin/web/api 下的变更先比对内容（mtime+size 或内容指纹），内容未变不回收，避免无谓停摆。
- 对齐探活与消费口径：客户端探活须探 iframe 真正要连的那一个地址（由 /ldvh/api/health 的 webPort 得到的绝对回环地址），使「可用」结论代表 iframe 的真实可用性。

明确不做什么：
- 不重做 Web 页面、不改呈现契约（specs/10 §5.5 不动）。
- 不改宿主 dsh-app 转发与身份头判据，d7a19a1 的绕行方案维持。
- 不处理 plugin/web/api/app.ts 的 app.handle 类型报错（tsc TS2339），它与本缺陷无因果、独立处置。
- 不改 21 号规范，不改 writer/tools 与其它事实类型。

## 计划

- 回收后自愈：源码热刷新回收后子进程自动重新预热：判据——在本机改动 plugin/web/api 下任一文件触发一次回收，不依赖任何人工请求，http://127.0.0.1:<webPort>/ldvh/ 在 30 秒内恢复 200；并有自动化测试覆盖「回收→自愈」路径且通过
- 回收判据收紧：内容未变不回收子进程：判据——仅触碰 plugin/web/api 下文件的 mtime 而内容不变时，子进程 pid 保持不变；内容真变时 pid 变化——两条均由测试断言
- 探活口径对齐：探活命中 iframe 真实地址：判据——子进程不可用时客户端探活结论为「不可用」（修复前实测报「可用」），可用时报「可用」；测试钉住探活 URL 与 iframe 地址同源同端口
- 现场恢复验证：真实宿主上按原故障路径验证页面自愈：判据——宿主启动 → 触碰 plugin/web/api 下文件 → 不经任何人工请求打开 LDVH 页面，页面正常渲染且该端口保持监听；记录实跑观察与宿主日志

