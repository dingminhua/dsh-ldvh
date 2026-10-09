---
fact_type_key: workcase
object_uid: c6d88dac-adce-408c-8c8e-896fccd0a9dd
title: Web 子进程停摆自愈缺失
status: closed
gist: LDVH 对话 Tab 与侧边栏的 Web 页面由插件自带的 Web 子进程供给；该子进程被源码热刷新回收后没有自愈路径，页面整片空白，设置页探活又走宿主路由因而报「可用」。本单修好回收与重拉的闭环、收紧回收判据、对齐探活口径；要 Human 决定的是关闭时对「宿主未重载、端到端未在真机复验」这一残留如何判定。
summary: |-
  修复 LDVH 插件 Web 呈现的停摆缺陷：对话 Tab 与侧边栏的 LDVH 页面由插件自带的 Express 子进程供给（plugin/lib/web-mount.js 的 createWebApiProcess 起在 127.0.0.1:3299；iframe 用绝对地址 http://127.0.0.1:<webPort>/ldvh/），而该子进程在源码热刷新（fs.watch(plugin/web/api)）触发回收后，只由「走代理的 /ldvh/api/* 请求」重拉——那个请求恰恰来自已经打不开的页面，于是形成死锁：进程一死就再不自愈。

  ### 缺陷三处
  ① 回收后无自愈：kill 之后既不重新预热，也没把重拉挂到探活或页面加载失败的路径上；② 回收触发过宽敏：对 plugin/web/api 下任何 mtime 事件都回收子进程，内容一字未改也回收；③ 探活与消费不同路：客户端探活用相对路径 /ldvh/ 与 /ldvh/api/health，命中的是宿主路由，宿主自己能返回 SPA 与 health，故探活报「可用」而 iframe 实为空白。

  ### 已核事实（2026-10-09 现场取证，两次独立复核）
  原缺陷在运行中的宿主上被原样复现：内容未变的一次触碰即回收子进程，此后约 2 分半内无人请求则一直不恢复，宿主侧 /ldvh/api/health 仍返回 200 而 iframe 实连地址连接失败；只有一次走代理的 /ldvh/api/cognition 请求才把它拉回来——死锁成立。修复后按原故障路径在真实源码树上实跑：仅触碰 mtime 不回收，内容真变则观测到停摆后于约 2.1 秒自愈，全程零人工请求。详见 scratch.local/c6d88dac-现场取证.md。

  ### 两轮独立复核的发现（均已修复并补回归）
  第一轮三处：意外退出自愈写成死代码（守卫恒成立）、真实改码被回收节流静默吃掉、探活只判连通把 500 与被占端口误报可用。第二轮两处：回收进行中落下的改码仍会丢（此后无事件驱动）、health 强判据在生产配置下不可达（子进程 cors 白名单只放行本机 dev server，实测对运行中子进程 Origin: null / dsh-app://app / 127.0.0.1:19387 均无 ACAO）。

  ### 边界
  只修子进程生命周期与探活口径：不重做 Web 页面、不改呈现契约（specs/10 §5.5）、不改宿主 dsh-app 转发与身份头判据、不处理 app.handle 的类型报错（已由 3cfa4fe 独立解决）。
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
gate_1:
  approved_at: 2026-10-09T09:40:26.055Z
  approver: Human（本会话对话决定：「批准执行」）
  authorization_fingerprint: ea320ae84b4babda0f7e19a193caf283e8e7f6d2ef69717376dd00528f6fa170
  scope_snapshot: |-
    做什么：
    - 让 Web 子进程在「源码热刷新回收」与「意外退出」之后都能自愈：回收动作自身负责重新预热，或把重拉挂到探活与页面加载失败的路径上，使页面无需人工干预即可恢复。
    - 收紧回收判据：对 plugin/web/api 下的变更先比对内容（mtime+size 或内容指纹），内容未变不回收，避免无谓停摆。
    - 对齐探活与消费口径：客户端探活须探 iframe 真正要连的那一个地址（由 /ldvh/api/health 的 webPort 得到的绝对回环地址），使「可用」结论代表 iframe 的真实可用性。

    明确不做什么：
    - 不重做 Web 页面、不改呈现契约（specs/10 §5.5 不动）。
    - 不改宿主 dsh-app 转发与身份头判据，d7a19a1 的绕行方案维持。
    - 不处理 plugin/web/api/app.ts 的 app.handle 类型报错（tsc TS2339），它与本缺陷无因果、独立处置。
    - 不改 21 号规范，不改 writer/tools 与其它事实类型。
reviews:
  - at: 2026-10-09T10:19:30.492Z
    provider: workbuddy
    model: space-bunny
    session_id: session-8f9addcd-7208-474d-8f1f-8ecbd8519a75
    session_source: host
    implementer_session_id: session-8f9addcd-7208-474d-8f1f-8ecbd8519a75
    implementer_session_source: host
    summary: 对象：ac94446 的 web-mount.js、client.js 与两个测试文件。基线：提交前版本。方法：读全量代码，/tmp 插桩副本实测（未改仓库），跑 node --test 14 例全过。覆盖：九问逐条核对。未覆盖：dsh-app://app 真机跨源与 cors、Electron 运行时。发现三处实质问题。一，意外退出自愈是死代码：exit 守卫 disposed||spawned!==null 恒成立，spawned 只在 recycleChild 清空；实测 SIGKILL 后 4 秒零请求 pid 未变、isRunning 恒 false，插桩证实定时器早退。预热路径自愈成立，崩溃路径未覆盖。二，回收回调先推进 sourceFingerprint 再调 recycleChild，遇 recycling 或 500ms 节流会静默丢弃真实改码。三，probeLoopback 只判 resolve，子进程 500 或端口被占会误报可用（原实现有 200-400 判据）。另注释仍称指纹含 mtimeMs 与实现不符。边界：仅覆盖静态代码与 Node 侧测试，不证明端口发现不被占端口误导。
  - at: 2026-10-09T10:19:37.408Z
    provider: workbuddy
    model: space-bunny
    session_id: session-8f9addcd-7208-474d-8f1f-8ecbd8519a75
    session_source: host
    implementer_session_id: session-8f9addcd-7208-474d-8f1f-8ecbd8519a75
    implementer_session_source: host
    summary: 对象：ac94446 与 55b40f3 的 web-mount.js、client.js。基线：两提交净变更与 55b40f3 修复 diff。方法：读源码，跑两个测试文件 17/17 通过，/tmp 插桩副本两次真实子进程复现。覆盖：A/B 已修；指纹不含 mtime；dispose 后不复活；无请求自愈；探活同源同端口。未覆盖：Electron 打包态真机 CORS、真实 tsx 启动时序、dist 是否存在。发现两处。A/B 确已修复。残留竞态：recycleChild 早退返回 false 时基线不推进但差异也未排队，实测 v2 回收中落 v3，日志只见一次 recycling，booted=v2 而磁盘=v3，此后无 fs 事件，进程跑旧码。另 C 仅静态层修复：子进程 cors 白名单只有 5173/5174/3000，宿主源与 dsh-app://app 实测 ACAO 缺失，强判据永不可得，500/503/端口被占仍全判 ready，与缺陷③同类。边界：不证明真实 Electron 运行时探活结果与长时稳定性。
  - at: 2026-10-09T10:19:43.617Z
    provider: workbuddy
    model: space-bunny
    session_id: session-8f9addcd-7208-474d-8f1f-8ecbd8519a75
    session_source: host
    implementer_session_id: session-8f9addcd-7208-474d-8f1f-8ecbd8519a75
    implementer_session_source: host
    summary: 对象：三文件 web-mount.js／client.js／web/api/app.ts 及两套测试。基线：ac94446~1→HEAD 净变更。方法：读全量段落，跑 18 例 node --test、tsc -b、eslint、app-contract 4 例全过；另在 /tmp 实测密集改码收敛、dispose 后不复活、四种 Origin 的 ACAO。覆盖：A exit 摘 spawned 后 200ms 重拉且测试断言 pid 变；B 回收成功才推进指纹，节流内两次改码均生效；C 读子进程 success 强判据；D pendingFingerprint 加退避重判，以 spawn 快照断言跑 v3；E health 回 ACAO 后强判据生产可达；指纹只含路径与 size 与内容 sha1。查不了：ACAO 通配使任意网页可探测本机 3299 存活（仅回 success 与 message，无凭据，实测不外扩至 objects）；credentials 与通配的浏览器实际行为、Linux inotify、真实 Electron 渲染。发现：A–E 五处均已修复并有测试钉住，未发现新的实质问题。保证边界：只覆盖该三文件在 Node 下的行为。
  - at: 2026-10-09T10:29:48.760Z
    provider: workbuddy
    model: space-bunny
    session_id: fef0fab6-4736-4022-bd4d-d08197d53fb9
    session_source: host
    implementer_session_id: session-8f9addcd-7208-474d-8f1f-8ecbd8519a75
    implementer_session_source: host
    summary: 基线ac94446~1→HEAD，只读，插桩/tmp。方法：读三文件与两测试，跑node --test(18全过)、tsc(0)、eslint(0)，实测health的CORS、回收中dispose、密集改码。覆盖：A-E各有钉住用例：exit先摘spawned再重拉、回收成功才推进指纹、探活读success且先探/ldvh/、runRecheck退避接住回收中落码、实测health对evil回ACAO:*而/api/objects仍无。未覆盖：真实Electron与Linux inotify退出(本机darwin)。发现：A-E五处均已修复并有测试钉住，未发现新的实质问题；实测密集5改码收敛末版仅spawn 2次，定时器unref、dispose后自然退出不复活，指纹只含路径/长度/内容sha1不含mtime，探活与iframe同源同端口。两点非阻塞：子进程未起时按250ms空转；ACAO:*使网页可探知本机3299有服务(仅常量体回环无凭据)。保证边界：只覆盖三文件本平台行为，不证明生产长时运行与跨平台退出。
result:
  achieved_scope: 计划步骤 1、2、3 全部达成并有自动化测试与现场实跑双重证据；计划步骤 4 部分达成——已取得原缺陷在真实宿主上的现场复现（反向证据）与修复后在真实源码树、真实子进程上的等价实跑，但「不经任何人工请求打开 LDVH 页面、页面正常渲染」未在真机 UI 上复验，因宿主仍跑改动前的代码而重载会中断 Human 当前会话。三次受控提交均过 precheck 与 Git Gate；两轮独立复核共发现五处缺陷，全部修复并补回归；终轮独立复核（隔离子代理会话）确认 A–E 五处均已修复、未发现新的实质问题。plugin 全套 1067 例测试通过，tsc -b 干净，四个改动文件 eslint 干净。
  criteria_checks:
    - evidence: 已达成。web-mount.js 新增 recycleChild：kill 后等旧进程真正退出（等 exit 事件，5s 兜底）即 await ensureReady() 重新预热，不等任何请求；意外退出另经 exit 分支重拉（200ms 后，单飞汇合于 ensureReady）。证据一，自动化用例「source recycle self-heals the child without any incoming request」全程不发任何请求即断言新 pid 就位且 http://127.0.0.1:<port>/api/health 回 200。证据二，现场实跑（真实子进程命令 node --import tsx api/server.ts、真实 plugin/web 源树、真实 Express 与 dist 托管，端口 3399 避开宿主占用的 3299）观测到时间线 1278ms→200、1531ms→失败、1784ms→失败、2058ms→200，且「先观测到停摆才认恢复」，远在 30 秒判据内。宿主日志：api source content changed, recycling child and warming a replacement up → child exited with code 0 → Server ready on port 3399 → replacement child ready on port 3399。
      satisfied: true
    - evidence: 已达成。回收判据改为对 api/ 树逐文件喂「绝对路径 + 内容长度 + 内容 sha1」的内容指纹，不含 mtime/ctime——中途曾误把 mtimeMs 写进指纹，用例当场失败后改正。自动化用例「mtime-only touch keeps the child pid unchanged, real content change replaces it」两条判据均以 pid 断言（utimes 改 mtime 后 pid 不变；writeFile 改内容后 pid 变化）。现场实跑同一条亦通过：仅触碰 mtime 后 4 秒仍 200 且 isRunning 为 true。
      satisfied: true
    - evidence: 已达成。探活改为两段：宿主 /ldvh/api/health 只用于发现 webPort，就绪判定走 iframe 自己的绝对回环 origin。行为用例用两个真实 http.Server 复现「宿主报 200 而 iframe 源已死」的分歧，断言客户端结论为不可用；反向用例断言子进程存活时报可用且探活 URL 恰为 http://127.0.0.1:<childPort>/ldvh/（同源同端口）。两条均真跑客户端逻辑（vm 内执行真实工厂、渲染真实 tab 组件、截获其 setState 结论），非字符串匹配。修复前实测报「可用」的情形已由现场取证复现（子进程死而宿主 health 仍 200）。强判据的生产可达性经复核发现不可达后已补：health 端点回 Access-Control-Allow-Origin 与 X-LDVH-Health，仅限该只读端点，终轮复核实测 /api/objects 仍无 ACAO。
      satisfied: true
    - evidence: 部分达成，如实登记。已取得：① 原缺陷在真实宿主上的现场复现（反向证据）——步骤 4 需触碰 plugin/web/api 下文件，该目录正被运行中宿主的旧代码 watch，这次触碰本身成了原缺陷样本：内容与 HEAD 逐字相同（git 干净）仍被回收，3299 无监听且 pgrep 无子进程，而宿主侧 /ldvh/api/health 仍 200、3299 连不上；约 2 分半内无人请求一直不恢复；宿主本地的 /ldvh/api/governed-projects 返回 200 但不经过子进程故不触发重拉；直到一次真正走代理的 /ldvh/api/cognition 返回 200，6 秒后 3299 才回 200。② 修复后的等价实跑见步骤 1、2 证据。未取得：「不经任何人工请求打开 LDVH 页面，页面正常渲染且该端口保持监听」未在真机 UI 上复验——宿主仍跑改动前的代码，本次改动需插件重载后生效，而重载会中断 Human 当前正在使用的会话，未擅自执行。已用端口 3399 在真实源码树与真实子进程上取得等效证据，但它不等于真机 iframe 渲染已复验。原始观察见 scratch.local/c6d88dac-现场取证.md。
      satisfied: false
  residual:
    - 真机 UI 端到端未复验：改动需插件重载后才对宿主生效，而重载会中断 Human 当前会话，故未擅自执行；已用端口 3399 在真实源码树与真实子进程上取得等效证据，但不等同于真机 iframe 渲染已复验。
outcome: partial
created_at: 2026-09-27T02:51:25.153Z
change_log:
  - at: 2026-09-27T02:51:25.153Z
    provider: ds-4sf
    model: deepseek-v4.1-flash
    summary: 创建工单（C1 提案）：修复 LDVH Web 呈现子进程回收后不自愈与探活口径失真
  - at: 2026-10-09T09:40:26.055Z
    provider: workbuddy
    model: space-bunny
    summary: Gate 1 批准：授权 Web 子进程回收自愈、回收判据收紧与探活口径对齐三项改动面（Human 裁定「批准执行」）；探活退路未获预授权。 [gate_1 approved by Human（本会话对话决定：「批准执行」）; attempt 1 allocated to dsh-space-bunny（本会话主控执行者）]
  - at: 2026-10-09T10:19:11.947Z
    provider: workbuddy
    model: space-bunny
    summary: 执行：完成三处修复并经受控提交 ac94446，两轮独立复核各发现三处与两处缺陷，经 55b40f3 与 45bd1f3 修复。 [attempt 1 heartbeat refreshed]
  - at: 2026-10-09T10:19:30.492Z
    provider: workbuddy
    model: space-bunny
    summary: "录入第一轮独立复核：发现三处实质缺陷（崩溃自愈死代码、改码被节流吃掉、探活只判连通），已全部修复。 [review recorded by session session-8f9addcd-7208-474d-8f1f-8ecbd8519a75; reviews entries: 1]"
  - at: 2026-10-09T10:19:37.408Z
    provider: workbuddy
    model: space-bunny
    summary: "录入第二轮独立复核：发现两处（回收中落码丢失、health 强判据生产不可达），已全部修复。 [review recorded by session session-8f9addcd-7208-474d-8f1f-8ecbd8519a75; reviews entries: 2]"
  - at: 2026-10-09T10:19:43.617Z
    provider: workbuddy
    model: space-bunny
    summary: "录入终轮独立复核：A–E 五处均已修复并有测试钉住，未发现新的实质问题。 [review recorded by session session-8f9addcd-7208-474d-8f1f-8ecbd8519a75; reviews entries: 3]"
  - at: 2026-10-09T10:29:48.760Z
    provider: workbuddy
    model: space-bunny
    summary: "录入独立复核（由隔离子代理会话记录）：A–E 五处均已修复并有测试钉住，未发现新的实质问题。 [review recorded by session fef0fab6-4736-4022-bd4d-d08197d53fb9; reviews entries: 4; 记录自子代理会话 fef0fab6-4736-4022-bd4d-d08197d53fb9 的最终产出（Code 捕获）]"
  - at: 2026-10-09T10:31:14.222Z
    provider: workbuddy
    model: space-bunny
    summary: Gate 2 关闭提案：outcome=partial。计划步骤 1-3 达成（自动化测试与现场实跑双重证据），步骤 4 部分达成——原缺陷已在真实宿主复现、修复后已等价实跑，真机 UI 端到端未复验（需插件重载，会中断 Human 当前会话）。三次受控提交过 Git Gate，两轮独立复核五处发现全部修复，终轮独立复核（隔离子代理）确认无新问题。 [gate_2 closed with outcome=partial; attempt 1 retracted]
---

# Web 子进程停摆自愈缺失

## 摘要

修复 LDVH 插件 Web 呈现的停摆缺陷：对话 Tab 与侧边栏的 LDVH 页面由插件自带的 Express 子进程供给（plugin/lib/web-mount.js 的 createWebApiProcess 起在 127.0.0.1:3299；iframe 用绝对地址 http://127.0.0.1:<webPort>/ldvh/），而该子进程在源码热刷新（fs.watch(plugin/web/api)）触发回收后，只由「走代理的 /ldvh/api/* 请求」重拉——那个请求恰恰来自已经打不开的页面，于是形成死锁：进程一死就再不自愈。

### 缺陷三处
① 回收后无自愈：kill 之后既不重新预热，也没把重拉挂到探活或页面加载失败的路径上；② 回收触发过宽敏：对 plugin/web/api 下任何 mtime 事件都回收子进程，内容一字未改也回收；③ 探活与消费不同路：客户端探活用相对路径 /ldvh/ 与 /ldvh/api/health，命中的是宿主路由，宿主自己能返回 SPA 与 health，故探活报「可用」而 iframe 实为空白。

### 已核事实（2026-10-09 现场取证，两次独立复核）
原缺陷在运行中的宿主上被原样复现：内容未变的一次触碰即回收子进程，此后约 2 分半内无人请求则一直不恢复，宿主侧 /ldvh/api/health 仍返回 200 而 iframe 实连地址连接失败；只有一次走代理的 /ldvh/api/cognition 请求才把它拉回来——死锁成立。修复后按原故障路径在真实源码树上实跑：仅触碰 mtime 不回收，内容真变则观测到停摆后于约 2.1 秒自愈，全程零人工请求。详见 scratch.local/c6d88dac-现场取证.md。

### 两轮独立复核的发现（均已修复并补回归）
第一轮三处：意外退出自愈写成死代码（守卫恒成立）、真实改码被回收节流静默吃掉、探活只判连通把 500 与被占端口误报可用。第二轮两处：回收进行中落下的改码仍会丢（此后无事件驱动）、health 强判据在生产配置下不可达（子进程 cors 白名单只放行本机 dev server，实测对运行中子进程 Origin: null / dsh-app://app / 127.0.0.1:19387 均无 ACAO）。

### 边界
只修子进程生命周期与探活口径：不重做 Web 页面、不改呈现契约（specs/10 §5.5）、不改宿主 dsh-app 转发与身份头判据、不处理 app.handle 的类型报错（已由 3cfa4fe 独立解决）。

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

## 执行

三次受控提交，均过 precheck 与 Git Gate（Git Gate 终闸输出 `LDVH Git Gate (commit-msg) passed`）：
- ac94446 初版实现三处修复；
- 55b40f3 修第一轮独立复核发现的三处（崩溃自愈死代码、改码被节流吃掉、探活只判连通）；
- 45bd1f3 修第二轮独立复核发现的两处（回收中落码丢失、health 强判据生产不可达）。

### 计划步骤 1（回收后自愈）——已达成
`recycleChild()` 在 kill 之后等旧进程**真正退出**（等 exit 事件，5s 兜底）即 `await ensureReady()` 重新预热；意外退出另经 exit 分支重拉。判据证据：自动化用例「source recycle self-heals the child without any incoming request」全程不发任何请求即断言新 pid 就位且回环地址回 200；现场实跑（真实子进程命令 `node --import tsx api/server.ts`、真实 `plugin/web` 源树、真实 Express 与 dist 托管，端口 3399 避开宿主占用的 3299）观测到时间线 1278ms→200、1531ms→失败、1784ms→失败、2058ms→200，**先观测到停摆再谈恢复**，零人工请求。

### 计划步骤 2（回收判据收紧）——已达成
指纹改为对 api/ 树逐文件喂「绝对路径 + 内容长度 + 内容 sha1」，**不含 mtime/ctime**。判据证据：自动化用例「mtime-only touch keeps the child pid unchanged, real content change replaces it」两条均断言（仅触碰 mtime 时 pid 不变；内容真变时 pid 变化）；现场实跑同一条亦通过。

### 计划步骤 3（探活口径对齐）——已达成（强判据的生产可达性经实测补齐）
探活改为两段：宿主 /ldvh/api/health 只用于发现 webPort，就绪判定走 iframe 自己的绝对回环 origin。判据证据：行为用例「client probe reports unavailable when the iframe origin is dead, even though the host route answers」用两个真实 http.Server 复现「宿主报 200 而 iframe 源已死」的分歧，断言客户端结论为不可用；反向用例断言子进程存活时报可用且探活 URL 为 `http://127.0.0.1:<childPort>/ldvh/`（同源同端口）。这两条是**真跑客户端逻辑**（vm 内执行真实工厂、渲染真实 tab 组件、截获其 setState 结论），非字符串匹配。

### 计划步骤 4（现场恢复验证）——**部分达成，如实登记**
已在真实宿主上取得两段证据：
- **原缺陷的现场复现（反向证据）**：步骤 4 需要触碰 `plugin/web/api` 下文件，该目录正被运行中宿主的旧代码 watch，于是这次触碰本身成了原缺陷的样本。观测：内容与 HEAD 逐字相同（git 干净）仍被回收 → 3299 无监听、`pgrep` 无子进程，而宿主侧 /ldvh/api/health 仍 200、3299 连不上；约 2 分半内无人请求则一直不恢复；宿主本地的 /ldvh/api/governed-projects 返回 200 但**不经过子进程**故不触发重拉；直到一次真正走代理的 /ldvh/api/cognition 返回 200，6 秒后 3299 才回 200。缺陷①②③在真实宿主上原样成立。
- **修复后的实跑**：见计划步骤 1、2 的现场证据。

**未取得者（如实声明）**：「不经任何人工请求打开 LDVH 页面，页面正常渲染」这一条**未在真机 UI 上复验**——宿主仍跑改动前的代码，本次改动需插件重载后才生效，而重载会中断你当前正在使用的会话，我不擅自做。已用端口 3399 在真实源码树与真实子进程上取得等效证据（同一 createWebApiProcess、同一回收与自愈路径、同一 dist 托管），但**它不等于真机 iframe 渲染已复验**。原始观察记录见 scratch.local/c6d88dac-现场取证.md。

### 两轮独立复核
第一轮（对象 ac94446）发现三处：① 意外退出自愈是**死代码**——exit 回调 re-warm 守卫 `disposed || spawned !== null` 恒成立，因 spawned 只在 recycleChild 内清空；② 回收回调先推进指纹基线再调 recycleChild，而后者会因 500ms 节流早退 → 真实改码被吃掉；③ 探活只判 resolve，子进程 500、dist 未构建 503、端口被占三者都误报可用。三处均已修（exit 回调中 `if (spawned === proc) spawned = null`；回收成功才推进基线；新增 probeHealthStatus 区分可达与健康）。

第二轮（对象 ac94446+55b40f3）发现两处：④ ①的修法只「不推进基线」不够，v3 落在回收进行中时此后不会再有 fs 事件驱动它（复核者用慢启动子进程实测：进程跑 v2 而磁盘 v3）——已修（pendingFingerprint + 指数退避重判 250ms→5s 封顶）；⑤ probeHealthStatus 的 cors 正常读法在生产**永不可达**——子进程 cors 白名单只有 localhost:5173/5174/3000，对运行中子进程实测 Origin: null / dsh-app://app / 127.0.0.1:19387 均无 ACAO，故强判据形同虚设、500 与 503 仍全判可用——已修（health 端点回 `Access-Control-Allow-Origin: *` 与 `X-LDVH-Health: ok`，仅限该只读端点、其它路由仍受原白名单约束）。

终轮（对象 ac94446+55b40f3+45bd1f3，由隔离子代理会话复核并录入）：A–E 五处均已修复并有测试钉住，未发现新的实质问题；跑 18 例 node --test、tsc -b、eslint、app-contract 4 例全过；另实测密集 5 次改码收敛到末版仅 spawn 2 次、定时器均 unref、dispose 后自然退出且不复活、指纹只含路径/长度/内容 sha1 不含 mtime、探活与 iframe 同源同端口；并实测 `/api/health` 对任意 Origin 回 ACAO 而 `/api/objects` 仍无，确认范围未外扩。复核登记两点非阻塞事项：子进程未起时重判按 250ms 空转（不探盘、不吊住进程）；ACAO 通配使网页可探知本机 3299 有服务（该端点仅回常量体、回环监听、无凭据）。

### 自查中修掉的两处自身错误（如实登记）
- 首次现场实跑把「1.5s 去抖窗口之前取到的 200」记成了「已恢复」——那是旧进程还在服务。改为「先观测到停摆，才认恢复」后才得到有效数字（2058ms）。
- 新写的竞态回归用例**恒过**，即它没进过竞态窗口：子进程在 listen 前 800ms 才 copy 源码，那时磁盘已是 v3。改为「spawn 时刻快照 + 3s 延迟 listen」把回收窗口拉长到超出去抖窗口，并**反向验证**：去掉修复后该用例失败于 `'// v2' !== '// v3'`，与复核者描述的现象一致。

## 结果

### 逐条判据核对
- 计划步骤 1（回收后自愈）：达成。自动化用例全程零请求即断言新 pid 就位且回环回 200；现场实跑先观测到停摆（1531ms、1784ms 两次失败）后于 2058ms 自愈。
- 计划步骤 2（判据收紧）：达成。仅触碰 mtime 时 pid 不变、内容真变时 pid 变化，两条均由测试以 pid 断言；现场实跑同条通过。
- 计划步骤 3（探活口径）：达成。宿主报 200 而 iframe 源已死时探活结论为不可用，子进程存活时报可用且探活 URL 与 iframe 同源同端口；强判据的生产不可达问题已由 health 端点补 ACAO 解决。
- 计划步骤 4（现场恢复验证）：**未完全达成**。原缺陷在真实宿主上被复现（构成反向证据），修复后在真实源码树与真实子进程上取得等价实跑，但真机 UI 渲染未复验。

### 已证实范围
Web 子进程在源码热刷新回收与意外退出两条路径上均能无需人工请求自愈；回收判据只认内容不认 mtime；客户端探活命中 iframe 真实地址且区分可达与健康。三次受控提交均过 precheck 与 Git Gate；plugin 全套 1067 例测试通过，tsc -b 干净，四个改动文件 eslint 干净；两轮独立复核共五处发现全部修复并补回归，终轮独立复核（隔离子代理会话）未发现新的实质问题。

### 未证实范围与残留

- residual:
  - 真机 UI 端到端未复验——本次改动需插件重载后才对宿主生效，而重载会中断 Human 当前正在使用的会话，故未擅自执行；已用端口 3399 在真实源码树与真实子进程上取得等效证据（同一 createWebApiProcess、同一回收与自愈路径、同一 dist 托管），但不等同于真机 iframe 渲染已复验。
    - **接受现状**：该残留是「验证动作待 Human 择机执行」，不是未修复的缺陷——三条代码路径（热刷新、意外退出、探活口径）均已由自动化测试与等价实跑覆盖，且终轮独立复核确认无新的实质问题。Human 重载插件后按原故障路径触碰一次 `plugin/web/api` 下文件即可确认；本单关闭不以该确认生效为前提。

### 关闭后的后续方向
本单关闭后，Web 呈现线继续按 SG-3 走 dogfood 闭环；上述真机复验若 Human 重载后确认通过，即视为本单残留的了结，无需另立单。README 中仍登记为「未核对」的真实 UI 验收四项（设置卡片、会话视图、停用与重启、卸载清理）不在本单范围，按各自登记口径承接。

