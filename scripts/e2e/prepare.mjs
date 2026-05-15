import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databasePath = resolve(".tmp/e2e/dibao.sqlite");

rmSync(databasePath, { force: true });
rmSync(`${databasePath}-shm`, { force: true });
rmSync(`${databasePath}-wal`, { force: true });
mkdirSync(dirname(databasePath), { recursive: true });
