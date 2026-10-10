---
title: 默认构建命令产出白屏产物
status: observing
phenomenon: package.json 中惯例命名的默认构建脚本 `build` 产出未挂 `/ldvh` 前缀的产物，而该产物正被宿主直接服务，故一次误用即令整个 Web 界面白屏，防护只存在于需另行发起的测试套件中。
impact: medium
object_uid: efa9b5ef-ce16-423a-abcf-b0bbea721405
fact_type_key: friction
created_at: 2026-10-10T21:26:17.871Z
change_log:
  - at: 2026-10-10T21:26:17.871Z
    provider: workbuddy
    model: deepseek-v4.1-flash
    summary: 摩擦发现机械通道创建（04 §8.4 第 3 项）
occurrence:
  count: 1
  first_at: 2026-10-10T21:25:33.857Z
  last_at: 2026-10-10T21:25:33.857Z
  human_return_at: null
---

# 默认构建命令产出白屏产物

## 现象
package.json 中惯例命名的默认构建脚本 `build` 产出未挂 `/ldvh` 前缀的产物，而该产物正被宿主直接服务，故一次误用即令整个 Web 界面白屏，防护只存在于需另行发起的测试套件中。

## 入账依据
可归因性：归因到仓内 `plugin/web/package.json` 的脚本命名与 vite base 配置——同一份仓内存在 `build` 与 `build:dsh` 两个构建入口，而惯例命名的那一个产出的是**已知损坏**的产物，且没有任何就地防护（base 不写在 config 里、不写在脚本里、也不由构建本身校验），兜底只存在于一个需要**另行发起**的测试套件里。宿主经符号链接直接服务本仓 `dist/`（该目录被 gitignore、不受版本控制），故损坏产物即刻可被加载。预期收益：把 base 固化进 vite 默认配置、或使 `build` 直接等价于 `build:dsh`、或让构建在产物无前缀时自检失败——任一项即可把「靠记得跑另一个命令」换成「构建自己不让过」，从机制上消除该失效面。
