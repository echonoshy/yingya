import { spawn } from "node:child_process";
import { lstat, open } from "node:fs/promises";
// OS advisory locks survive PID namespaces and release automatically on crashes.
// A small child owns flock while its stdin pipe (owned by this process) is open.
export async function acquireLock(filename) {
  try {
    const handle = await open(filename, "wx", 0o600);
    await handle.close();
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const info = await lstat(filename);
  if (info.isSymbolicLink() || !info.isFile()) throw Error("工程锁文件无效");
  const child = spawn(
    "flock",
    [
      "-x",
      "-w",
      "2",
      filename,
      process.execPath,
      "-e",
      "process.stdout.write('locked\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let released = false;
  const ended = new Promise((resolve) => child.once("exit", resolve));
  await new Promise((resolve, reject) => {
    let ready = false;
    child.once("error", reject);
    child.stdout.once("data", () => {
      ready = true;
      resolve();
    });
    child.once("exit", () => {
      if (!ready) reject(Error("EDIT_BUSY: 工程正在保存，请稍后重试"));
    });
  });
  return async () => {
    if (released) return;
    released = true;
    child.stdin.end();
    await ended;
  };
}
