export interface Config {
  account: string; region: 'us-east-1'; hostedZoneId: string; domain: 'flatgirl.net';
  operatorPrincipalArn: string | null; betaEnabled: boolean; productionNoindex: boolean
}
export function config(value: any): Config {
  if (!value || !/^\d{12}$/.test(value.account) || value.region !== 'us-east-1' ||
      value.domain !== 'flatgirl.net' || !/^Z[A-Z0-9]+$/.test(value.hostedZoneId) ||
      (value.operatorPrincipalArn !== null && !new RegExp(`^arn:aws:iam::${value.account}:(user|role)/[A-Za-z0-9+=,.@_/-]+$`).test(value.operatorPrincipalArn)) ||
      typeof value.betaEnabled !== 'boolean' || typeof value.productionNoindex !== 'boolean')
    throw new Error('Invalid Flat Girl configuration; supply account, hosted zone, non-root operator ARN and explicit flags.')
  return value
}
export const stacks = { access: 'FlatGirlAccess', certificates: 'FlatGirlCertificates', images: 'FlatGirlImages', beta: 'FlatGirlBetaSite', production: 'FlatGirlProductionSite', 'signup-beta': 'FlatGirlBetaSignup', 'signup-production': 'FlatGirlProductionSignup' }
export const bucketName = (p: Config, kind: string) => `flat-girl-${kind}-${p.account}-${p.region}`
export const roleArn = (p: Config, name: string) => `arn:aws:iam::${p.account}:role/flat-girl-${name}`
