/**
 * Стаб `@deepseek-ai/dsh-home-paths` для тестов вне DSH.
 *
 * Хост-половина берёт из пакета только `resolveDshHome()`; в тестах каталог
 * всё равно задаётся явным `config.dshHome`, но функция должна существовать.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

export const resolveDshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh')

export default { resolveDshHome }
