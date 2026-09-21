/**
 * Стаб `@deepseek-ai/dsh-credentials` для тестов вне DSH.
 *
 * В рантайме `credentialRef` — это брендирование строки (dsh-brand): значение
 * остаётся тем же самым, поэтому для тестов достаточно вернуть его как есть.
 * Настоящий пакет подставляется в профиле DSH при обычной работе плагина.
 */
export const credentialRef = (value) => value

export const credentialKey = (scope, id) => `${scope}/${id}`

export const credentialKeyId = (key) => key.slice(key.indexOf('/') + 1)

export const credentialKeyScope = (key) => key.slice(0, key.indexOf('/'))

export const isCredentialRefName = (value) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value))

export const isCredentialKeySegment = (value) => /^[a-z][a-z0-9-]*$/.test(String(value))

export default { credentialRef, credentialKey, credentialKeyId, credentialKeyScope, isCredentialRefName, isCredentialKeySegment }
