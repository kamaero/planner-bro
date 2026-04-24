import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/authStore'
import { api } from '@/api/client'
import type { ChangelogSection } from '@/types'

export function useChangelogModal() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const [isOpen, setIsOpen] = useState(false)
  const [sections, setSections] = useState<ChangelogSection[]>([])
  const [allSections, setAllSections] = useState<ChangelogSection[]>([])
  const [currentHash, setCurrentHash] = useState('')

  useEffect(() => {
    if (!user) return

    api.getChangelog().then((data: { hash: string; sections: ChangelogSection[] }) => {
      if (!data.hash || data.hash === user.last_seen_changelog_hash) return

      const lastDate = user.last_seen_changelog_date ?? null
      const newSections = lastDate
        ? data.sections.filter((s) => s.date > lastDate)
        : data.sections.slice(0, 1)

      if (newSections.length === 0) return

      setCurrentHash(data.hash)
      setSections(newSections)
      setAllSections(data.sections)
      setIsOpen(true)
    }).catch(() => {
      // changelog unavailable — silently skip
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const dismiss = async () => {
    setIsOpen(false)
    try {
      await api.dismissChangelog()
      if (user) {
        setUser({
          ...user,
          last_seen_changelog_hash: currentHash,
          last_seen_changelog_date: sections[0]?.date ?? user.last_seen_changelog_date,
        })
      }
    } catch {
      // non-critical — user sees modal again next login
    }
  }

  return { isOpen, sections, allSections, dismiss }
}
