import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const LDVH_ROOT = process.env.LDVH_ROOT || path.resolve(__dirname, '../../..');
export const LDVH_WORKSPACE_ROOT = process.env.LDVH_WORKSPACE_ROOT || path.dirname(LDVH_ROOT);
export const OBJECT_TYPES = ['pitfall', 'spark', 'report', 'friction', 'norm', 'subgoal'];
