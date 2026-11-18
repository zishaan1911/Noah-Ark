// Cognito group name -> the view it unlocks. A user in both groups gets both; the first listed is home.
export const ROLE_HOME = { operator: '/command', maintainer: '/care' } as const

export type Role = keyof typeof ROLE_HOME

export function rolesFromGroups(groups: readonly string[]): Role[] {
  return (Object.keys(ROLE_HOME) as Role[]).filter((role) => groups.includes(role))
}
