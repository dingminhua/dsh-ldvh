// Host goal synchronization for WorkCase controlled writes (specs/21 §14).
//
// The host service is faked here: these tests pin the DECISION the plugin makes
// for each write point and each current-goal state. What they cannot show is
// that the real host behaves like the fake — the contract was read from the
// host's own Inspect channel (`ctx.get("goals")`, create/get/edit/resume/pause/
// complete/clear, GoalView{phase, activation, revision}), not inferred.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	GOALS_CONFLICT,
	rearmInFlightWorkcaseGoal,
	workcaseUidFromObjective,
	GOALS_UNAVAILABLE,
	GOAL_WRITE_POINTS,
	goalCarriesObject,
	goalObjectiveFor,
	objectiveTitleOf,
	resolveGoalsService,
	syncWorkcaseGoal,
} from '../lib/workcase-goals.js';

const UID = '11112222-3333-4444-5555-666677778888';
const OTHER = '99998888-7777-6666-5555-444433332222';
const AGENT = { id: 'session-test' };

/** A fake goals service that records every call and serves a scripted current goal. */
function fakeGoals(current = undefined) {
	const calls = [];
	let state = current;
	return {
		calls,
		get: (agent) => {
			calls.push(['get', agent]);
			return state;
		},
		create: (agent, request) => {
			calls.push(['create', agent, request]);
			state = { id: 'g-new', revision: 7, objective: request.objective, phase: 'active', activation: 'armed' };
			return state;
		},
		edit: (agent, ref, request) => {
			calls.push(['edit', agent, ref, request]);
			state = { ...state, ...request, revision: ref.revision + 1 };
			return state;
		},
		resume: (agent, ref) => {
			calls.push(['resume', agent, ref]);
			state = { ...state, phase: 'active', activation: 'armed', revision: ref.revision + 1 };
			return state;
		},
		pause: (agent, ref) => {
			calls.push(['pause', agent, ref]);
			state = { ...state, phase: 'paused', activation: 'disarmed', revision: ref.revision + 1 };
			return state;
		},
		complete: (agent, ref) => {
			calls.push(['complete', agent, ref]);
			state = { ...state, phase: 'complete', activation: 'disarmed', revision: ref.revision + 1 };
			return state;
		},
		clear: (agent, ref) => {
			calls.push(['clear', agent, ref]);
			state = undefined;
			return { id: ref.id, revision: ref.revision + 1 };
		},
	};
}

function ctxWith(goals) {
	return { get: (key) => (key === 'goals' ? goals : undefined) };
}

function goalView(overrides = {}) {
	return {
		id: 'g-1',
		revision: 3,
		objective: goalObjectiveFor(UID, '某工单'),
		phase: 'active',
		activation: 'armed',
		...overrides,
	};
}

test('目标文本以规定形式承载对象标识', () => {
	assert.equal(goalObjectiveFor(UID, '承重声明的撤除条件与机械守门'), `推进 workcase-${UID} 到 Gate 2（承重声明的撤除条件与机械守门）`);
	assert.equal(goalCarriesObject(goalObjectiveFor(UID, 'x'), UID), true);
	assert.equal(goalCarriesObject(goalObjectiveFor(OTHER, 'x'), UID), false);
	assert.equal(goalCarriesObject(undefined, UID), false);
});

test('服务不可用：设置点 fail-closed 拒绝，收口点降级为 none 并如实报告（D1/D3，Human 2026-10-15 裁定）', async () => {
	const cases = [
		[undefined, 'no service context'],
		[{}, 'no service context'],
		[{ get: () => undefined }, 'ctx.get("goals") is undefined'],
		[{ get: () => ({}) }, 'ctx.get("goals") is undefined'],
		[{ get: () => { throw new Error('boom'); } }, 'boom'],
	];
	for (const [ctx, word] of cases) {
		const resolved = resolveGoalsService(ctx);
		assert.equal(resolved.ok, false, `service must be unavailable for ${JSON.stringify(ctx)}`);
		assert.equal(resolved.code, GOALS_UNAVAILABLE);
		assert.match(resolved.message, new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		for (const point of ['approve', 'execute']) {
			const synced = await syncWorkcaseGoal({ ctx, agent: AGENT, point, objectUid: UID, title: 't' });
			assert.equal(synced.ok, false, `${point} 须拒绝`);
			assert.equal(synced.code, GOALS_UNAVAILABLE);
		}
		// 收口点：不拒绝，但也不假装做过——降级必须可从结果读出。
		for (const point of ['close', 'cancel', 'rebatch']) {
			const synced = await syncWorkcaseGoal({ ctx, agent: AGENT, point, objectUid: UID, title: 't' });
			assert.equal(synced.ok, true, `${point} 不得因目标服务不可用而拒绝收口`);
			assert.equal(synced.action, 'none');
			assert.equal(synced.detail.degraded, true, `${point} 须如实登记降级`);
		}
	}
});

test('取不到调用会话的 agent：设置点拒绝，收口点降级', async () => {
	const goals = fakeGoals(undefined);
	const setting = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: null, point: 'approve', objectUid: UID, title: 't' });
	assert.equal(setting.ok, false);
	assert.equal(setting.code, GOALS_UNAVAILABLE);
	const closing = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: null, point: 'close', objectUid: UID, title: 't' });
	assert.equal(closing.ok, true);
	assert.equal(closing.action, 'none');
	assert.equal(closing.detail.degraded, true);
	assert.equal(goals.calls.length, 0, '不得在 agent 缺失时对服务做任何调用');
});

test('批准／接手：无当前目标即创建，目标文本含本对象标识', async () => {
	for (const point of ['approve', 'execute']) {
		const goals = fakeGoals(undefined);
		const synced = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point, objectUid: UID, title: '标题甲' });
		assert.equal(synced.ok, true, `${point} 应成功`);
		assert.equal(synced.action, 'created');
		assert.deepEqual(goals.calls[1], ['create', AGENT, { objective: goalObjectiveFor(UID, '标题甲') }]);
	}
});

test('批准／接手：当前目标已指向同一对象即复用（武装中且文本一致 = kept）', async () => {
	for (const point of ['approve', 'execute']) {
		const goals = fakeGoals(goalView());
		const synced = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point, objectUid: UID, title: '某工单' });
		assert.equal(synced.ok, true);
		assert.equal(synced.action, 'kept');
		assert.equal(goals.calls.length, 1, '复用时只读不写');
	}
});

test('批准／接手：同对象但解除武装或暂停／受阻时重新武装（resume）', async () => {
	const cases = [
		{ activation: 'disarmed' },
		{ phase: 'paused', activation: 'disarmed' },
		{ phase: 'blocked', activation: 'disarmed' },
	];
	for (const overrides of cases) {
		const goals = fakeGoals(goalView(overrides));
		const synced = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point: 'execute', objectUid: UID, title: '某工单' });
		assert.equal(synced.ok, true, JSON.stringify(overrides));
		assert.equal(synced.action, 'resumed');
		assert.deepEqual(goals.calls[1], ['resume', AGENT, { id: 'g-1', revision: 3 }]);
	}
});

test('批准／接手：同对象但已完成时按契约重建（create 是唯一可替换已完成目标的动作）', async () => {
	const goals = fakeGoals(goalView({ phase: 'complete', activation: 'disarmed' }));
	const synced = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point: 'approve', objectUid: UID, title: '新标题' });
	assert.equal(synced.ok, true);
	assert.equal(synced.action, 'recreated');
	assert.deepEqual(goals.calls[1], ['create', AGENT, { objective: goalObjectiveFor(UID, '新标题') }]);
});

test('批准／接手：同对象、武装中但文本已变即改写（edit）', async () => {
	const goals = fakeGoals(goalView());
	const synced = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point: 'approve', objectUid: UID, title: '改名之后' });
	assert.equal(synced.ok, true);
	assert.equal(synced.action, 'edited');
	assert.deepEqual(goals.calls[1], ['edit', AGENT, { id: 'g-1', revision: 3 }, { objective: goalObjectiveFor(UID, '改名之后') }]);
});

test('冲突：设置点拒绝写入；收口点不做任何事——但两者都不得清除或覆盖他人目标（D1，Human 2026-10-15 裁定）', async () => {
	for (const point of GOAL_WRITE_POINTS) {
		const goals = fakeGoals(goalView({ objective: goalObjectiveFor(OTHER, '别的工单') }));
		const synced = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point, objectUid: UID, title: 't' });
		if (point === 'approve' || point === 'execute') {
			assert.equal(synced.ok, false, `${point} 遇他对象目标应拒绝`);
			assert.equal(synced.code, GOALS_CONFLICT);
		} else {
			assert.equal(synced.ok, true, `${point} 不得因与他对象目标冲突而拒绝收口`);
			assert.equal(synced.action, 'none');
			assert.match(synced.detail.reason, /another object/);
		}
		assert.deepEqual(goals.calls, [['get', AGENT]], `${point} 只允许读取，不得清除或覆盖他人目标`);
	}
});

test('收口·关闭：属于本对象的当前目标即完成（complete）', async () => {
	const goals = fakeGoals(goalView());
	const synced = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point: 'close', objectUid: UID, title: '某工单' });
	assert.equal(synced.ok, true);
	assert.equal(synced.action, 'completed');
	assert.deepEqual(goals.calls[1], ['complete', AGENT, { id: 'g-1', revision: 3 }]);
});

test('收口·取消：属于本对象的当前目标即清除（clear）', async () => {
	const goals = fakeGoals(goalView());
	const synced = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point: 'cancel', objectUid: UID, title: '某工单' });
	assert.equal(synced.ok, true);
	assert.equal(synced.action, 'cleared');
	assert.deepEqual(goals.calls[1], ['clear', AGENT, { id: 'g-1', revision: 3 }]);
});

test('收口·局部重批：属于本对象的当前目标即暂停（pause）', async () => {
	const goals = fakeGoals(goalView());
	const synced = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point: 'rebatch', objectUid: UID, title: '某工单' });
	assert.equal(synced.ok, true);
	assert.equal(synced.action, 'paused');
	assert.deepEqual(goals.calls[1], ['pause', AGENT, { id: 'g-1', revision: 3 }]);
});

test('收口·提交关闭提案：进入「待批准关闭」即暂停推进目标（pause）', async () => {
	// `propose_close` 是收口侧的暂停点：落盘关闭提案那一刻起，工单要做的
	// 不再是「推进到 Gate 2」（那正是自动续轮把工单直接关掉的动力），而是
	// 「等 Human 判定」。宿主只有 paused/blocked/complete 三种停法，其中只有
	// paused 是可恢复的——Human 批准后 close 才能续接。
	const goals = fakeGoals(goalView());
	const synced = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point: 'propose_close', objectUid: UID, title: '某工单' });
	assert.equal(synced.ok, true);
	assert.equal(synced.action, 'paused');
	assert.deepEqual(goals.calls[1], ['pause', AGENT, { id: 'g-1', revision: 3 }]);

	// 已是 paused 时幂等：重复提交提案不重复暂停。
	const again = await syncWorkcaseGoal({ ctx: ctxWith(fakeGoals(goalView({ phase: 'paused', activation: 'disarmed' }))), agent: AGENT, point: 'propose_close', objectUid: UID, title: 't' });
	assert.equal(again.action, 'none');
});

test('环境检查：待批准关闭期的工单不被重新武装——否则提案的暂停会被每回合撤销', async () => {
	// 这是 propose_close 的**第二种撤销形态**（与 rebatch 暂停同类）：
	// `onTurnStart` 的接手逻辑看到「工单还 open 且目标 disarmed」就 resume，
	// 于是下一回合自动续轮又被点燃，等着 Human 的工单被 AI 自己推着关掉。
	const goals = fakeGoals(goalView({ phase: 'paused', activation: 'disarmed' }));
	const out = await rearmInFlightWorkcaseGoal({
		ctx: ctxWith(goals), agent: AGENT,
		readWorkcaseStatus: async () => 'open',
		readAwaitingGate2: async () => true,
	});
	assert.equal(out.action, 'none');
	assert.equal(out.detail.awaiting_gate2, true);
	assert.equal(goals.calls.length, 1, '待批准关闭期不得对目标做写操作');
});

test('环境检查：结果节尚未落盘时照常重新武装（本闸只让位于待批准关闭期）', async () => {
	const goals = fakeGoals(goalView({ phase: 'paused', activation: 'disarmed' }));
	const out = await rearmInFlightWorkcaseGoal({
		ctx: ctxWith(goals), agent: AGENT,
		readWorkcaseStatus: async () => 'open',
		readAwaitingGate2: async () => false,
	});
	assert.equal(out.action, 'rearmed');
});

test('收口三点：本无当前目标时是 none（不是失败——目标可能已由 Human 清除）', async () => {
	for (const point of ['close', 'cancel', 'rebatch']) {
		const goals = fakeGoals(undefined);
		const synced = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point, objectUid: UID, title: 't' });
		assert.equal(synced.ok, true, `${point} 无目标应是 none`);
		assert.equal(synced.action, 'none');
		assert.equal(goals.calls.length, 1, '无目标时不得凭空创建');
	}
});

test('收口三点：已处于目标态时保持幂等（不重复调用）', async () => {
	const closeCase = fakeGoals(goalView({ phase: 'complete' }));
	const closed = await syncWorkcaseGoal({ ctx: ctxWith(closeCase), agent: AGENT, point: 'close', objectUid: UID, title: 't' });
	assert.equal(closed.action, 'none');

	const rebatchCase = fakeGoals(goalView({ phase: 'paused', activation: 'disarmed' }));
	const rebatched = await syncWorkcaseGoal({ ctx: ctxWith(rebatchCase), agent: AGENT, point: 'rebatch', objectUid: UID, title: 't' });
	assert.equal(rebatched.action, 'none');
});

test('服务抛错即如实失败（不当作无目标）', async () => {
	const goals = {
		get: () => { throw new Error('registry says no'); },
	};
	const synced = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point: 'approve', objectUid: UID, title: 't' });
	assert.equal(synced.ok, false);
	assert.equal(synced.code, 'workcase/goals_failed');
	assert.match(synced.message, /registry says no/);

	const throwingCreate = fakeGoals(undefined);
	throwingCreate.create = () => { throw new Error('create refused'); };
	const created = await syncWorkcaseGoal({ ctx: ctxWith(throwingCreate), agent: AGENT, point: 'approve', objectUid: UID, title: 't' });
	assert.equal(created.ok, false);
	assert.equal(created.code, 'workcase/goals_failed');
});

test('未知写入点与缺失对象标识被拒绝（不静默通过）', async () => {
	const goals = fakeGoals(undefined);
	const unknown = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point: 'approve-ish', objectUid: UID, title: 't' });
	assert.equal(unknown.ok, false);
	const noUid = await syncWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, point: 'approve', objectUid: '', title: 't' });
	assert.equal(noUid.ok, false);
	assert.equal(goals.calls.length, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// 接手侧的环境检查（21 §14「以及该会话续接本对象」）
//
// 与受控写入点的分工：那条是「写之前判定、失败即拒绝写入」；本条是**环境性**的，
// 不拒绝任何动作（会话继续干活不该被环境检查拦住），失败只回报原因。
// ─────────────────────────────────────────────────────────────────────────────

test('目标文本是「本会话在办哪一单」的唯一读取口径', () => {
	assert.equal(workcaseUidFromObjective(goalObjectiveFor(UID, 'x')), UID);
	assert.equal(workcaseUidFromObjective('别的目标'), null);
	assert.equal(workcaseUidFromObjective(undefined), null);
});

test('环境检查：执行期工单的目标解除武装时重新武装', async () => {
	const goals = fakeGoals(goalView({ activation: 'disarmed' }));
	const out = await rearmInFlightWorkcaseGoal({
		ctx: ctxWith(goals), agent: AGENT,
		readWorkcaseStatus: async () => 'open',
	});
	assert.equal(out.action, 'rearmed');
	assert.deepEqual(goals.calls[1], ['resume', AGENT, { id: 'g-1', revision: 3 }]);
});

test('环境检查：武装中的执行期工单不动（kept）', async () => {
	const goals = fakeGoals(goalView());
	const out = await rearmInFlightWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, readWorkcaseStatus: async () => 'open' });
	assert.equal(out.action, 'kept');
	assert.equal(goals.calls.length, 1, '不得对已武装的目标做写操作');
});

test('环境检查：工单不在执行期时什么都不做——否则会无声撤销局部重批的暂停', async () => {
	for (const status of ['draft', 'closed', null]) {
		const goals = fakeGoals(goalView({ phase: 'paused', activation: 'disarmed' }));
		const out = await rearmInFlightWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, readWorkcaseStatus: async () => status });
		assert.equal(out.action, 'none', `status=${status} 须不做任何事`);
		assert.equal(goals.calls.length, 1, '只读不写');
	}
});

test('环境检查：目标不承载工单、无目标、服务不可用、身份缺失都只是 none（不拒绝、不抛）', async () => {
	const cases = [
		{ ctx: ctxWith(fakeGoals(goalView({ objective: '推进别的目标' }))), agent: AGENT, word: 'does not carry' },
		{ ctx: ctxWith(fakeGoals(undefined)), agent: AGENT, word: 'no current goal' },
		{ ctx: undefined, agent: AGENT, word: 'unavailable' },
		{ ctx: ctxWith(fakeGoals(goalView())), agent: null, word: 'agent' },
	];
	for (const { ctx, agent, word } of cases) {
		const out = await rearmInFlightWorkcaseGoal({ ctx, agent, readWorkcaseStatus: async () => 'open' });
		assert.equal(out.ok, true, '环境检查不产生失败——它没有可拒绝的对象');
		assert.equal(out.action, 'none');
		assert.match(out.detail.reason, new RegExp(word, 'i'));
	}
});

// ─────────────────────────────────────────────────────────────────────────────
// 回归：目标已 complete 而对象仍在执行期（2026-10-19 修复 workcase-996e207a 的实态）
//
// 修复前的形态：complete 落进 resume 分支 → 宿主抛 GOAL_INVALID_TRANSITION
// （resume 的 resumable 闭集是 {active,paused,blocked}）→ catch 返回
// `{ok:true, action:"none"}` → 每回合失败一次而外部完全不可见。
// ─────────────────────────────────────────────────────────────────────────────

test('环境检查：目标已 complete 而工单仍在执行期时用 create 重建（不再撞 resume 的死路）', async () => {
	const goals = fakeGoals(goalView({ phase: 'complete', activation: 'disarmed' }));
	const out = await rearmInFlightWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, readWorkcaseStatus: async () => 'open' });
	assert.equal(out.ok, true);
	assert.equal(out.action, 'recreated');
	assert.equal(out.detail.previous_phase, 'complete');
	// 只读一次、写一次，且写的必须是 create 而不是 resume
	assert.deepEqual(goals.calls.map((c) => c[0]), ['get', 'create']);
	assert.equal(goals.calls[1][2].objective, goalObjectiveFor(UID, '某工单'));
});

test('环境检查：重建保留原目标的标题措辞', async () => {
	const goals = fakeGoals(goalView({ phase: 'complete', activation: 'disarmed' }));
	await rearmInFlightWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, readWorkcaseStatus: async () => 'open' });
	assert.equal(goals.calls[1][2].objective, `推进 workcase-${UID} 到 Gate 2（某工单）`);
});

test('objectiveTitleOf 从目标文本还原标题', () => {
	assert.equal(objectiveTitleOf(goalObjectiveFor(UID, '事实对象指称须带类型与标题')), '事实对象指称须带类型与标题');
	assert.equal(objectiveTitleOf(goalObjectiveFor(UID, '')), '');
	assert.equal(objectiveTitleOf('推进别的目标'), '');
	assert.equal(objectiveTitleOf(undefined), '');
});

test('环境检查：重建失败不再被吞成 ok:true——对象在执行期而目标无武装必须可见', async () => {
	const goals = fakeGoals(goalView({ phase: 'complete', activation: 'disarmed' }));
	goals.create = () => {
		goals.calls.push(['create-throws']);
		throw new Error('goal create requires a fresh active revision-one goal');
	};
	const out = await rearmInFlightWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, readWorkcaseStatus: async () => 'open' });
	assert.equal(out.ok, false);
	assert.equal(out.code, 'workcase/goals_failed');
	assert.match(out.message, /still in its execution period but its host goal is complete/);
});

test('环境检查：resume 失败同样不再被吞成 ok:true', async () => {
	const goals = fakeGoals(goalView({ phase: 'paused', activation: 'disarmed' }));
	goals.resume = () => {
		goals.calls.push(['resume-throws']);
		throw new Error('goal exhausted its round budget');
	};
	const out = await rearmInFlightWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, readWorkcaseStatus: async () => 'open' });
	assert.equal(out.ok, false);
	assert.equal(out.code, 'workcase/goals_failed');
	assert.match(out.message, /could not be resumed/);
});

test('环境检查：complete 目标但工单已不在执行期时仍什么都不做（不得自行重建已收口的推进）', async () => {
	for (const status of ['draft', 'closed', null]) {
		const goals = fakeGoals(goalView({ phase: 'complete', activation: 'disarmed' }));
		const out = await rearmInFlightWorkcaseGoal({ ctx: ctxWith(goals), agent: AGENT, readWorkcaseStatus: async () => status });
		assert.equal(out.action, 'none', `status=${status} 须不重建`);
		assert.equal(goals.calls.length, 1, '只读不写');
	}
});
