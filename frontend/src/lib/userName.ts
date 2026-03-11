type UserLike = {
  name?: string | null
  first_name?: string | null
  middle_name?: string | null
  last_name?: string | null
}

function normalizePart(value?: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

export function formatFioShort(lastName?: string | null, firstName?: string | null, middleName?: string | null): string {
  const last = normalizePart(lastName)
  const first = normalizePart(firstName)
  const middle = normalizePart(middleName)
  if (!last && !first && !middle) return ''
  let initials = ''
  if (first) initials += `${first[0].toUpperCase()}.`
  if (middle) initials += `${middle[0].toUpperCase()}.`
  if (!last) return initials
  return `${last} ${initials}`.trim()
}

export function formatUserDisplayName(user?: UserLike | null): string {
  if (!user) return ''
  const byParts = formatFioShort(user.last_name, user.first_name, user.middle_name)
  if (byParts) return byParts
  return normalizePart(user.name)
}
