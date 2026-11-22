import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
	DEFAULT_STATUSES_BY_TYPE,
	INJECTION_EXCLUDED_TYPES,
	REGISTERED_FACT_TYPES,
	recallForAction,
} from "../lib/source-recall.js";
import { buildRecallInjection, renderRecallRow } from "../lib/recall-injection.js";
import { skipWithoutCorpus, seedFactCorpus } from "./helpers.mjs";

const ROOT = join(import.meta.dirname, "..", "..");
const q = (o) => recallForAction({ root: ROOT, excludeTypes: INJECTION_EXCLUDED_TYPES, ...o });
