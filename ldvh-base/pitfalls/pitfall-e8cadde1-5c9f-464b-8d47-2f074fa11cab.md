---
title: 身份判定分裂致关联判死
status: discarded
scope: 适用于「同一身份判定在多层各自维护正则实现」的读写链路：任一层版本位或形态假设漂移，都会让按规范创建的对象在某层被整体拒认，而失败以「数据不可用」的静默降级形式呈现，构建、类型检查与测试均不报错。已验证实例：dsh-ldvh 的 plugin/web，object_uid 判定分散在 api/services、api/routes 与 src 共四处，其中三处取 UUIDv7 形态，与 specs/03 §6.1 的 canonical UUIDv4 冲突。
trigger_signal: 当 identity 字段的版本形态约定变更（如改用其它 UUID 版本或 ULID）、或对象身份判定被再次复制到新的读取层时重审本经验。
disposition: 经验废止（23 §16 第 2 项）：规避已由 specs/06 §6（:124/:159）吸收——同一规则必须通过单一职责入口实现、严禁复制副本逻辑；规则由规范源承载，本条仅作来源引用（23 §6.3）。
object_uid: e8cadde1-5c9f-464b-8d47-2f074fa11cab
fact_type_key: pitfall
created_at: 2026-09-13T10:26:18.813Z
change_log:
  - at: 2026-09-13T10:26:18.813Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 创建：记录「身份判定谓词多层分裂且版本位漂移致关联全量判死」的失败机制与收敛方式
  - at: 2026-10-08T21:36:48.193Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 批次 G 旧号位更正：根因/解决/规避三处「03 §6.1」→「02 §7.1」（经现行 02 §7.1 原文核对为同一 canonical UUIDv4 判定）并加号位注记；scope 字段与其镜像照录不改（scope 逐字不变）
  - at: 2026-10-08T21:37:09.021Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 勘误上一条写入的誊录错误：恢复「症状」「触发条件」两节的原记录文本（识别信号段与四条触发条件，前次写入误以概述替换），仅保留三处号位更正与号位注记；其余内容逐字不变
  - at: 2026-10-13T21:01:54.535Z
    provider: ds41
    model: deepseek-v4.1-flash
    summary: 勘误级更新（23 §9.3，scope 逐字不变）：①「解决」段成功信号的口径由「全仓」收窄为「web 平面」，并加注记如实登记 plugin/lib 侧 8 份同形 v4 副本为有意设计（无漂移，机制条件仍成立）；②「解决」段补「已知的有意例外」一项；③「验证」段补 2026-10-14 复核结论——触发信号未命中、判定未被复制到新读取层（federation.ts 等新增路由无自维护正则）
  - at: 2026-10-27T18:40:01.994Z
    provider: minmax
    model: MiniMax-M3.1-Flash
    summary: 机械化承载盘点登记（2026-10-28）：fact-identity-uid.test.ts 的 canonicalUid 谓词判据；状态与 scope 不变（23 §9.3 补充级更新）。
  - at: 2026-10-27T19:03:57.028Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 经验废止（active→discarded，23 §16 第 2 项，Human 2026-10-28 指令）：规避第 2 条已由 specs/06 §6（:124/:159）吸收为强制规则（单一职责入口、严禁副本），本条不再独立承担约束；正文补记吸收条款的可回指依据（35 §8.6 第 3 项），状态与 scope 为唯一变更。
---

# 身份判定分裂致关联判死

## 症状

对象列表卡片与详情页的正式关联区块，全部条目一律呈现「关联信息不可用」，无任何一条解析成功。失败范围与对象新旧无关、与关联目标是否存在无关——即使是刚刚创建、目标完整可读的关联也同样不可用。

**识别信号**：失败出现在「同一份数据被两个读取层分别判定」的边界上。可在不打开浏览器的情况下直接判定——用规范原文的形态（canonical UUIDv4）构造一个对象，检查关联层谓词是否接受它：

```js
const uid = '034533b2-713b-4825-b675-26ba7b4ae713'  // 事实源中真实存在的 object_uid
writerUidPattern.test(uid)   // true  —— 写入层按 v4 校验，接受
readerUidPattern.test(uid)   // false —— 关联层按 v7 校验，拒绝
```

同时具备以下特征：构建成功、类型检查通过、测试套件全绿、事实源文件内容无损坏——故障只以「数据不可用」的呈现层形态暴露。

## 触发条件

同时满足以下条件时触发：

1. 同一身份判定（本文为 `object_uid`）在多层被**各自实现**，而非共享单一权威；
2. 各实现的形态假设发生**版本位或形态漂移**——本文中三处取 UUIDv7（版本位 `7`），而规范定的是 UUIDv4（版本位 `4`）；
3. 消费方在判定失败时**静默降级**而非报错——关联层返回 `available: false` 占位，把「解析不了」伪装成「关联不可用」这一合法业务状态；
4. 该判定处于数据可达路径的**前置索引**位置——本文的 uid 索引建立失败后整体为空，使所有关联一次性失效，而非逐条失效。

## 根因

`specs/02 §7.1` 明文定义 `object_uid` 为 canonical **UUIDv4**（RFC 9562 版本位 `4`），并显式声明**不采用**时间有序的 UUIDv7——理由是其索引与排序收益只在数据库主键场景成立，而事实源是 `ldvh-base/` 下的文件载体，该收益落空。

但 Web 读取层把这一判定复制成了四份独立正则：`api/services/facts.ts`、`api/services/localFactReader.ts`、`api/routes/cognition.ts`、`src/pages/object-detail/factReadingProjection.ts`。其中三处取了 UUIDv7 形态（版本位 `7`），仅 `localFactReader` 的字段校验取了正确的 v4。

写入端（各 `*-writer.js`）与 `localFactReader` 均按 v4 校验，所以**按规范创建的对象必然带 v4 uid**；而关联层的 v7 谓词必然拒绝它们。`facts.ts` 的 `currentProjectUidTargets()` 在建立 uid 索引时逐项过滤，谓词恒假使索引**恒为空**；随后 `projectFactCardAssociations()` 拿不到 locator，走上静默降级分支返回 `available: false`，前端按约定渲染为「关联信息不可用」。

**已观察**：谓词的版本位是直接原因，且为充分原因——四份副本改为与规范一致的 v4 后，56 个真实对象与 7 条真实关联边全部恢复解析（修复前为 0）。

**未知**：同一判定被复制到新读取层时若不共享实现，是否必然再次漂移；复制的动机（跨 plane 的 import 边界）是否会在其它字段上复现同类问题。

## 解决

把身份判定收敛为**单一权威实现**，放在读写两侧都能到达的 `shared/` 平面，各层一律引用：

- 新增 `plugin/web/shared/factIdentity.ts`，导出 `canonicalUid(value)`（唯一权威判定，含 02 §7.1 引用与漂移历史）；
- `api/services/facts.ts`、`api/services/localFactReader.ts`、`api/routes/cognition.ts`、`src/pages/object-detail/factReadingProjection.ts` 四处调用点改为引用该函数，删除全部内联正则；
- 既有的 v4 字段校验（`localFactReader`）也一并改走同一函数，消除「两份正则各自演进」的结构性隐患。

**成功信号（2026-10-14 口径收窄后）**：**web 平面**不再存在任何自维护的 `object_uid` 形态正则（读写两侧一律经 `shared/factIdentity.ts` 的 `canonicalUid`）；对全部真实对象与关联边，判定与写入端一致接受。收窄理由见下方注记。

**必要边界**：收敛谓词只修复「认不认得出身份」，不改动关联解析的其它环节（目标存在性、类型闭集、状态条件）。若关联仍不可用，需另行检查这些环节，不得据本次修复推断关联层已全面正确。

**口径收窄（2026-10-14 勘误）**：本段原写「**全仓**不再存在任何自维护的 `object_uid` 形态正则」，该口径在今日现状下不成立——`plugin/lib` 侧 8 个文件至今各自维护同一 canonical v4 正则（`adr-writer.js:65`、`friction-writer.js:77`、`norm-writer.js:80`、`pitfall-writer.js:66`、`research-writer.js:68`、`spark-writer.js:82/104`、`workcase-writer.js:368`），且各 writer 另持一份同形的文件名匹配副本；这是 `lib` 与 `web` 两棵树互不 import 的**有意设计**（`workcase-writer.js:1246` 有明文说明）。**它们全部为 v4、无版本位漂移，故本经验的机制条件（判定与规范一致、不存在跨层形态冲突）仍成立**；收窄的只是「单一权威实现」这一措辞的适用范围，不改变根因判断。本例「验证」第 3 项当时即已如实区分「残留 v7 形态」与「各 writer 的 v4 正则」两类，本注记把该区分提到「解决」段，避免读者据原口径误判全仓已收敛为一份实现。

## 规避

1. **核对条件**：任何身份/标识字段的形态判定，先确认规范原文的权威形态（本文为 02 §7.1 的 UUIDv4），再核对各层实现是否一致。
2. **动作**：同一判定不得在多层各自实现——跨 plane 消费时提取到 `shared/`，各层引用同一权威。
3. **机械拦截**：`plugin/web/tests/api/fact-identity-uid.test.ts` 锁定该谓词，断言 v4 接受、v7 拒绝、以及真实 uid 的关联投影不再降级。已验证其有效性——将谓词还原为 v7 时，5 项中 4 项失败（非静默通过）。
4. **例外**：若某层确实需要不同形态的判定（如兼容读取历史 ID），必须与该层的字段语义一并声明，且不得覆盖 canonical 判定本身。**已知的有意例外**：`plugin/lib` 各 writer 的副本（见上注记）——它们不构成漂移风险的前提是「各副本同形且同版本位」，故任何 writer 新增或改动该正则时须与 02 §7.1 对齐。

**号位注记（2026-10-14，批次 G 事实更正）**：本文创建时点（2026-09-13）所引的 `specs/03 §6.1`，经 02–10 重构后为现行 `specs/02 §7.1`「公共身份字段」——该节仍逐字载有同一 canonical UUIDv4 判定与不采用 UUIDv7 的理由（其索引与排序收益只在数据库主键场景成立，事实源为文件载体时该收益落空），本节「根因」「解决」「规避」三处已按现行号位更正。另：frontmatter `scope` 字段与其正文镜像「影响与适用范围」节内的同一处时点号位「specs/03 §6.1」为**冻结字段镜像**（Pitfall 勘误要求 `scope` 逐字不变），照录不改，读时以本条注记的现行号位为准。

**已被规范源吸收（2026-10-28，Human 决定废止）**：上述第 2 条（同一判定不得在多层各自实现）已由 `specs/06` §6 承载——`:124`「对应 Code 必须通过单一职责入口实现，严禁复制副本逻辑」、`:159`「同一规则只存在唯一职责入口实现，无副本逻辑」（未满足时合并到单一入口，未修复前不发布；06 §9.1 第 3 项列为必停）。自该条款生效起，本条不再独立承担约束，仅作为该规则的来源引用保留（23 §6.3、35 §8.6 第 3 项）；须合读 02 §7.1 的权威形态。

## 验证

**已观察**：

1. 以真实数据端到端复验：修复后 56 个对象与 7 条正式关联边的目标全部被 `canonicalUid` 接受，修复前接受数为 0；
2. 反向验证谓词：临时将 `canonicalUid` 还原为 v7 形态，`fact-identity-uid.test.ts` 5 项中 4 项失败，证明拦截真实有效；
3. 全仓扫描确认不再残留 v7 形态正则，且所有 `object_uid` 相关正则（含各 writer 与文件名匹配）一致为 v4；
4. 既有测试套件中 22 处 fixture 曾使用 v7 形态（即把缺陷固化为期望），全部改为 canonical v4 后，web 套件 274/274、plugin 套件 726/726 通过；
5. `tsc -b` 类型检查与 `pnpm build:dsh` 生产构建均通过；改动文件 `eslint` 无新增问题（仓库级 49 项问题在改动前后数量一致，均为既有问题）。

**后续复核（2026-10-14，本仓）**：触发信号未命中——identity 字段的版本形态约定未变（仍为 02 §7.1 的 canonical UUIDv4），且身份判定**未被**复制到新的读取层：`plugin/web/api/routes/federation.ts` 等新增路由不含自维护 uid 正则，全 web 平面仍只有 `shared/factIdentity.ts` 一份判定，四个调用点（`facts.ts:9/130/151/205`、`localFactReader.ts:13/313/340`、`cognition.ts:19/252`、`factReadingProjection.ts:1/193`）全部经 `canonicalUid`。**唯一需要收窄的是「全仓」口径**（见「解决」段注记）：`plugin/lib` 侧的 8 份同形 v4 副本为有意设计且无漂移，使该处以「web 平面」表述才与现状相符。

**未覆盖**：

1. 浏览器中的实际呈现未逐页人工核验，仅验证到投影层输出正确；
2. `friction-writer.js` 的 informs 目标解析退化为文件名拼接（只验文件名不验对象有效性）属另一独立缺口，本次未处理；
3. 其它字段的判定是否也存在多层复制未做全仓普查。


**机械化承载（2026-10-28 盘点）**：`plugin/web/tests/api/fact-identity-uid.test.ts`（5 例，断言 canonicalUid 接受 v4、拒绝 v7 与非规范值，且真实 uid 的关联投影不再降级）已把本条的规避实现为机械判据——权威形态被钉在 `plugin/web/shared/factIdentity.ts` 一份实现上，谓词漂移当场转红（改回 v7 则 5 例中 4 例失败）。覆盖边界：它只锁共享谓词与 factReadingProjection 一条读链，不锁「不得在多层各自实现」——在 `api/services/facts.ts` 另植一份漂移副本时该文件仍全绿（漂移由 `fact-source-metadata.test.ts` 的行为用例偶然捕获）；`plugin/lib` 侧 8 份 writer 副本不在任何用例覆盖内。

## 影响与适用范围

适用于「同一身份判定在多层各自维护正则实现」的读写链路：任一层版本位或形态假设漂移，都会让按规范创建的对象在某层被整体拒认，而失败以「数据不可用」的静默降级形式呈现，构建、类型检查与测试均不报错。已验证实例：dsh-ldvh 的 plugin/web，object_uid 判定分散在 api/services、api/routes 与 src 共四处，其中三处取 UUIDv7 形态，与 specs/03 §6.1 的 canonical UUIDv4 冲突。

**何时可能踩到**：任何「规范定义单一权威形态、而读取层跨 plane 复制判定」的场景；尤其当读取层失败走静默降级、且该判定位于前置索引位置时——此时故障既不被类型系统暴露，也不被测试暴露（若测试 fixture 与错误实现同源，反而会把缺陷固化为期望），只在呈现层显现。

**何时可信**：在「判定已收敛为单一权威 + 有机械拦截」的前提下可信；若判定再次被复制到新读取层，本经验的前提减弱，需重新核对各层形态。若规范改采其它身份形态（如 ULID），本经验的版本位结论随之失效，但「不得多层各自实现」这一机制结论仍然成立。
