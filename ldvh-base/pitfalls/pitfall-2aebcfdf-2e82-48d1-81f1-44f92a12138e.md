---
title: 全局 sed 翻锁版本号撞改依赖钉且管道掩蔽失败
status: active
scope: 任何对 package-lock.json 做版本号替换的发布/同步流程，尤其版本翻号用全局 sed 的场合；以及任何把验证命令接进管道后以 $? 判断成败的脚本写法。不适用于经 npm 自身机制（--package-lock-only）改锁的流程。
trigger_signal: 发布版本号与锁内任一依赖版本共享数字子串时（如 1.1.5 与 11.1.5）、或引入新的「cmd | tail; echo $?」型验证写法时重审。
object_uid: 2aebcfdf-2e82-48d1-81f1-44f92a12138e
fact_type_key: pitfall
created_at: 2026-11-24T05:16:19.550Z
change_log:
  - at: 2026-11-24T05:16:19.550Z
    provider: dsh-opencode-go
    model: deepseek-v4.1-flash
    summary: 记录 dsh-ldvh 1.1.6 发布时全局 sed 翻 package-lock 版本号撞改 file-entry-cache 依赖钉、叠加管道掩蔽 $? 致本地假绿、CI npm ci 404 的事故与防复发口径
---

# 全局 sed 翻锁版本号撞改依赖钉且管道掩蔽失败

## 症状

dsh-ldvh 1.1.6 发布后，main 分支的 CI 在 `npm ci` 步骤直接失败：run 45330902675 的 `plugin` 与 `install-smoke` 两个 job 同时变红，报错为下载依赖 tarball 时 404。发布树里的 `plugin/package-lock.json` 中，依赖 `file-entry-cache` 的三处版本真值（`11.1.5`）已被改写成不存在的 `11.1.6`：range 钉 `11.1.5 || >11.1.6 <12`、node 的 `version` 字段 `11.1.5`、`resolved` URL `…/file-entry-cache-11.1.5.tgz`。三处都被同步改写，指向 registry 上并不存在的 `file-entry-cache-11.1.6.tgz`。

同一事故还有第二层表现：本地门禁按当时的验证命令跑出 `EXIT=0`，被读作「锁文件验证通过」，直到 CI 红才发现锁本身已损坏。

## 触发条件

- 发布版本翻号用全局替换改写 `package-lock.json`，例如 `s/1.1.5/1.1.6/g`。
- 锁内任何字段的版本子串恰好撞上发布版本号：本次依赖 `file-entry-cache` 的版本是 `11.1.5`，其中含子串 `1.1.5`，被全局替换命中。
- 同类写法在 1.1.5 翻号（`s/1.1.4/1.1.5/g`）时未触发并非安全，只是当次锁里依赖真值恰好是 `11.1.5`，不含子串 `1.1.4`——纯属侥幸，触发条件本身一直在。
- 验证命令把被执行命令接进管道再取 `$?`，例如 `npm ci --silent 2>&1 | tail -1; echo "EXIT=$?"`：`$?` 取到的是管道末尾 `tail` 的退出码，`npm ci` 失败也会被读成 0。

## 根因

两层根因叠加，各自都会独立造成误判：

1. **替换粒度错位**：发布版本号是包自身的字段，而 `package-lock.json` 里同时还存在大量依赖的版本号。全局 sed 无法区分「包的 version」与「依赖的 version」，只要存在子串碰撞，就会把依赖钉改成不存在的版本。npm 端随后按改后的 range/version/resolved 去取 `file-entry-cache-11.1.6.tgz`，registry 没有该产物，`npm ci` 404。
2. **退出码来源错位**：管道中的命令不是最后一个命令，`$?` 反映的是管道末尾命令（`tail`、`grep` 等）的状态。真正的验证主体失败被静默吞掉，本地得到「假绿」——错误不在 CI 才暴露，而在本地本该拦下却没拦下。同型写法在本仓 `sync --check` 的验证里也出现过一次（`node … | grep …; echo $?` 取到的是 `grep` 的退出码）。

## 解决

- 靶向恢复被误改的三处真值：`file-entry-cache` 的 range 钉、`version`、`resolved` URL 全部改回 `11.1.5`。以 dev 侧锁为唯一权威。
- 恢复后核对：发布树锁与 dev 锁仅差两个包版本字段，属设计内差异，其余零差异。
- 提交 `48cd5bdb`，`v1.1.6` tag 已移指到该提交。修复后 main CI 的两 job 恢复正常。
- 影响面澄清：npm 发出的 tarball 不含 `package-lock.json`（在 `files` 白名单之外），已发布的产物不受污染；受影响面是 main 树的源码可安装性（`git clone` 后 `npm ci`）与 CI。

## 规避

翻锁版本号的正确做法（二选一）：

1. 走 `npm install --package-lock-only`，由 npm 只重写包自身的两个 `version` 字段，依赖钉一律不动。
2. 若必须手工替换，对 `"version": "旧号"` 做逐处靶向替换，不碰 `resolved`、range 等字段；替换后 `diff` 全文确认「除版本字段外零差异」再提交。

验证命令取真实退出码（二选一）：

1. 命令后直接跟 `echo $?`，中间不经管道：`npm ci; echo $?`。
2. 必须用管道时先 `set -o pipefail`，让管道失败能上浮为整体非零。

## 验证

- 恢复后复核锁内 `file-entry-cache` 三处均回到 `11.1.5`，且指向的 tarball 存在于 registry。
- `diff` 发布树锁与 dev 锁，确认仅剩两个包版本字段差异。
- 以不经管道的写法重跑 `npm ci` 并直读退出码，确认真实返回 0；CI run 45330902675 重跑后 `plugin` 与 `install-smoke` 双绿。

## 影响与适用范围

任何对 package-lock.json 做版本号替换的发布/同步流程，尤其版本翻号用全局 sed 的场合；以及任何把验证命令接进管道后以 $? 判断成败的脚本写法。不适用于经 npm 自身机制（--package-lock-only）改锁的流程。

补充边界：本坑不污染已发布 tarball（锁在 `files` 白名单外），其破坏面限于 main 树源码可安装性与 CI 判定。同理，管道掩蔽退出码不限于 npm 场景，凡「被验证命令不是管道末位」的写法都在适用面内。
