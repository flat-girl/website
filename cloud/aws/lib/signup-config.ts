export type SignupEnvironment = 'beta' | 'production'
export interface SignupConfig {
  turnstileSiteKey: string
  beta: { enabled: boolean; listId: number; rateLimit: number; burstLimit: number }
  production: SignupConfig['beta']
}
export const signupParameters = {
  turnstile: '/flat-girl/signup/turnstile-secret',
  brevo: '/flat-girl/signup/brevo-api-key',
}
export const notificationParameter = (env: SignupEnvironment) => `/flat-girl/signup/${env}/notification`
export const notificationName = (env: SignupEnvironment) => `flat-girl-${env}-notification`
export function signupConfig(value: any): SignupConfig {
  if (!value || Object.keys(value).sort().join(',') !== 'beta,production,turnstileSiteKey' ||
      typeof value.turnstileSiteKey !== 'string' ||
      (value.turnstileSiteKey !== '' && !/^0x[A-Za-z0-9_-]{10,100}$/.test(value.turnstileSiteKey)))
    throw new Error('Invalid signup configuration or Turnstile site key; edit cloud/signup.json.')
  for (const env of ['beta', 'production'] as const) {
    const item = value[env]
    if (!item || Object.keys(item).sort().join(',') !== 'burstLimit,enabled,listId,rateLimit' ||
        typeof item.enabled !== 'boolean' || item.listId !== (env === 'beta' ? 5 : 4) ||
        !Number.isFinite(item.rateLimit) || item.rateLimit <= 0 || item.rateLimit > 100 ||
        !Number.isSafeInteger(item.burstLimit) || item.burstLimit < 1 || item.burstLimit > 100 ||
        (item.enabled && !value.turnstileSiteKey))
      throw new Error('Signup requires beta list 5, production list 4, bounded throttles and a real site key before enabling.')
  }
  return value
}
export const signupHost = (env: SignupEnvironment) => env === 'beta' ? 'beta-api.flatgirl.net' : 'api.flatgirl.net'
export const signupOrigin = (env: SignupEnvironment) => env === 'beta' ? 'https://beta.flatgirl.net' : 'https://flatgirl.net'
export const signupNames = (env: SignupEnvironment) => ({
  function: `flat-girl-${env}-signup`, role: `flat-girl-${env}-signup`,
  logs: `/aws/lambda/flat-girl-${env}-signup`,
})
