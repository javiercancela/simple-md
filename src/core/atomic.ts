import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let mode = 0o600;
  try {
    mode = fs.statSync(file).mode & 0o777;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const tmp = `${file}.${randomUUID()}.tmp`;
  // Never follow or reuse another writer's temporary file. Contents stay private
  // until complete, then inherit the original POSIX permission bits.
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    try {
      fs.writeFileSync(fd, text, "utf8");
      fs.fchmodSync(fd, mode);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
