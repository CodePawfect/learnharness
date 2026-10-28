import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import { emptyLearningData, LearningError, parseLearningData, type LearningStore } from "../core/learning.ts";

export function createLearningStore(directory: string, notify: () => void = () => {}): LearningStore {
	const file = path.join(directory, "learning.json");
	const lock = path.join(directory, "learning.lock");
	const read: LearningStore["read"] = () => {
		let text: string;
		try { text = fs.readFileSync(file, "utf8"); }
		catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyLearningData(); throw error; }
		try { return parseLearningData(JSON.parse(text)); }
		catch { throw new LearningError("Learning history could not be read. The original file has been preserved; check its format or restore a backup.", 500); }
	};
	return {
		read,
		update(change) {
			fs.mkdirSync(directory, { recursive: true });
			let lockFd: number;
			try { lockFd = fs.openSync(lock, "wx", 0o600); }
			catch (error) {
				if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new LearningError("Learning history is busy. Retry; if this persists after a crash, stop the app before removing learning.lock from its data folder.", 409);
				throw error;
			}
			const temporary = `${file}.${crypto.randomUUID()}.tmp`;
			let changed = false;
			try {
				fs.writeFileSync(lockFd, String(process.pid));
				const data = read(), before = JSON.stringify(data);
				const result = change(data);
				parseLearningData(data);
				if (JSON.stringify(data) !== before) {
					const fd = fs.openSync(temporary, "wx", 0o600);
					try { fs.writeFileSync(fd, JSON.stringify(data, null, "\t")); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
					fs.renameSync(temporary, file);
					changed = true;
				}
				return result;
			} finally {
				fs.closeSync(lockFd);
				fs.rmSync(temporary, { force: true });
				fs.unlinkSync(lock);
				if (changed) notify();
			}
		},
	};
}

export const learningStore = createLearningStore(PATHS.data, () => emit("learning-changed", {}));
