import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import { LearningError } from "../core/learning.ts";
import { emptyFlashcardData, parseFlashcardData, type FlashcardStore } from "../core/flashcards.ts";

export function createFlashcardStore(directory: string, notify: () => void = () => {}): FlashcardStore {
	const file = path.join(directory, "flashcards.json"), lock = path.join(directory, "flashcards.lock");
	const read: FlashcardStore["read"] = () => {
		let text: string;
		try { text = fs.readFileSync(file, "utf8"); }
		catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyFlashcardData(); throw e; }
		try { return parseFlashcardData(JSON.parse(text)); }
		catch { throw new LearningError("Flashcards could not be read. The original file is preserved; restore a backup or check its format.", 500); }
	};
	return { read, update(change) {
		fs.mkdirSync(directory, { recursive: true });
		let lockFd: number;
		try { lockFd = fs.openSync(lock, "wx", 0o600); }
		catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new LearningError("Flashcards are busy. Please retry.", 409); throw e; }
		const temp = `${file}.${crypto.randomUUID()}.tmp`;
		let changed = false;
		try {
			fs.writeFileSync(lockFd, String(process.pid));
			const data = read(), before = JSON.stringify(data), result = change(data);
			parseFlashcardData(data);
			if (JSON.stringify(data) !== before) {
				const fd = fs.openSync(temp, "wx", 0o600);
				try { fs.writeFileSync(fd, JSON.stringify(data, null, "\t")); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
				fs.renameSync(temp, file); changed = true;
			}
			return result;
		} finally { fs.closeSync(lockFd); fs.rmSync(temp, { force: true }); fs.unlinkSync(lock); if (changed) notify(); }
	} };
}
export const flashcardStore = createFlashcardStore(PATHS.data, () => emit("flashcards-changed", {}));
