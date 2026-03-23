import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Paperclip, Send, Users, Hash } from 'lucide-react'
import { api } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import type { ChatMessage, ChatUnreadSummary, User } from '@/types'
import { Button } from '@/components/ui/button'
import { formatUserDisplayName } from '@/lib/userName'

function cn(...classes: Array<string | false | undefined>) {
  return classes.filter(Boolean).join(' ')
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

function senderColor(senderId: string) {
  const palette = [
    'text-sky-800 bg-sky-50 border-sky-300',
    'text-emerald-800 bg-emerald-50 border-emerald-300',
    'text-amber-800 bg-amber-50 border-amber-300',
    'text-rose-800 bg-rose-50 border-rose-300',
    'text-violet-800 bg-violet-50 border-violet-300',
    'text-cyan-800 bg-cyan-50 border-cyan-300',
    'text-fuchsia-800 bg-fuchsia-50 border-fuchsia-300',
    'text-lime-800 bg-lime-50 border-lime-300',
    'text-indigo-800 bg-indigo-50 border-indigo-300',
    'text-orange-800 bg-orange-50 border-orange-300',
  ]
  let hash = 0
  for (let i = 0; i < senderId.length; i += 1) hash = (hash * 31 + senderId.charCodeAt(i)) >>> 0
  return palette[hash % palette.length]
}

export function Chat() {
  const currentUser = useAuthStore((s) => s.user)
  const [searchParams, setSearchParams] = useSearchParams()

  const mode = searchParams.get('mode') === 'direct' ? 'direct' : 'global'
  const peerId = searchParams.get('peer') ?? ''

  const [chatInput, setChatInput] = useState('')
  const [chatFile, setChatFile] = useState<File | null>(null)
  const [chatSending, setChatSending] = useState(false)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState<number | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const chatFileRef = useRef<HTMLInputElement | null>(null)
  const messageListRef = useRef<HTMLDivElement | null>(null)

  const { data: users = [] } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: api.listUsers,
    refetchInterval: 60_000,
  })

  const teamList = useMemo(
    () =>
      users
        .filter((u) => u.is_active !== false && u.id !== currentUser?.id)
        .sort((a, b) => formatUserDisplayName(a).localeCompare(formatUserDisplayName(b), 'ru')),
    [users, currentUser?.id]
  )

  const selectedPeer = useMemo(() => teamList.find((u) => u.id === peerId) ?? null, [teamList, peerId])

  const { data: globalChat = [], refetch: refetchGlobalChat } = useQuery<ChatMessage[]>({
    queryKey: ['chat', 'global'],
    queryFn: () => api.listGlobalChatMessages({ limit: 300 }),
    enabled: mode === 'global',
    refetchInterval: mode === 'global' ? 10_000 : false,
  })

  const { data: directChat = [], refetch: refetchDirectChat } = useQuery<ChatMessage[]>({
    queryKey: ['chat', 'direct', selectedPeer?.id],
    queryFn: () => api.listDirectChatMessages(selectedPeer!.id, { limit: 300 }),
    enabled: mode === 'direct' && !!selectedPeer?.id,
    refetchInterval: mode === 'direct' && !!selectedPeer?.id ? 10_000 : false,
  })

  const { data: chatUnread } = useQuery<ChatUnreadSummary>({
    queryKey: ['chat', 'unread'],
    queryFn: api.getChatUnreadSummary,
    refetchInterval: 10_000,
  })

  const unreadDirectMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of chatUnread?.direct ?? []) map.set(item.user_id, item.unread_count)
    return map
  }, [chatUnread])

  const messages = mode === 'global' ? globalChat : directChat

  useEffect(() => {
    if (mode === 'direct' && !selectedPeer?.id) {
      setSearchParams({ mode: 'global' })
    }
  }, [mode, selectedPeer?.id, setSearchParams])

  useEffect(() => {
    if (!messageListRef.current) return
    messageListRef.current.scrollTop = messageListRef.current.scrollHeight
  }, [messages.length])

  const userById = useMemo(() => {
    const map = new Map<string, User>()
    for (const user of users) map.set(user.id, user)
    return map
  }, [users])

  const displayUserName = (user?: User | null) => formatUserDisplayName(user) || user?.name || 'Пользователь'
  const mentionLabel = (user: User) => displayUserName(user)
  const displaySenderName = (msg: ChatMessage) =>
    displayUserName(userById.get(msg.sender_id)) || msg.sender_name || 'Пользователь'

  const mentionCandidates = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase()
    if (!mentionOpen) return [] as User[]
    if (!q) return teamList.slice(0, 8)
    return teamList.filter((u) => mentionLabel(u).toLowerCase().includes(q)).slice(0, 8)
  }, [mentionOpen, mentionQuery, teamList])

  const openGlobal = () => setSearchParams({ mode: 'global' })
  const openDirect = (user: User) => setSearchParams({ mode: 'direct', peer: user.id })

  const insertMention = (user: User) => {
    insertMentionByName(mentionLabel(user))
  }

  const insertMentionByName = (name: string) => {
    if (!textareaRef.current) return
    const cursor = textareaRef.current.selectionStart ?? chatInput.length
    if (mentionStart === null) {
      const appended = `${chatInput}${chatInput.endsWith(' ') || chatInput.length === 0 ? '' : ' '}@${name} `
      setChatInput(appended)
      setTimeout(() => {
        textareaRef.current?.focus()
        const pos = appended.length
        textareaRef.current?.setSelectionRange(pos, pos)
      }, 0)
      setMentionOpen(false)
      return
    }

    const before = chatInput.slice(0, mentionStart)
    const after = chatInput.slice(cursor)
    const next = `${before}@${name} ${after}`
    const nextPos = before.length + name.length + 2
    setChatInput(next)
    setMentionOpen(false)
    setMentionQuery('')
    setMentionStart(null)
    setTimeout(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextPos, nextPos)
    }, 0)
  }

  const detectMention = (value: string, cursor: number) => {
    const beforeCursor = value.slice(0, cursor)
    const match = beforeCursor.match(/(^|\s)@([^\s@]{0,32})$/)
    if (!match) {
      setMentionOpen(false)
      setMentionQuery('')
      setMentionStart(null)
      return
    }
    const query = match[2] ?? ''
    const startIndex = cursor - query.length - 1
    setMentionOpen(true)
    setMentionQuery(query)
    setMentionStart(startIndex)
  }

  const sendMessage = async () => {
    const body = chatInput.trim()
    if ((!body && !chatFile) || chatSending) return
    if (mode === 'direct' && !selectedPeer?.id) return

    setChatSending(true)
    try {
      if (chatFile) {
        await api.sendChatMessageWithFile(
          mode === 'global'
            ? { room_type: 'global', body: body || undefined, file: chatFile }
            : { room_type: 'direct', recipient_id: selectedPeer!.id, body: body || undefined, file: chatFile }
        )
      } else {
        await api.sendChatMessage(
          mode === 'global'
            ? { room_type: 'global', body }
            : { room_type: 'direct', recipient_id: selectedPeer!.id, body }
        )
      }
      setChatInput('')
      setChatFile(null)
      setMentionOpen(false)
      setMentionQuery('')
      setMentionStart(null)
      if (chatFileRef.current) chatFileRef.current.value = ''
      if (mode === 'global') {
        await refetchGlobalChat()
      } else {
        await refetchDirectChat()
      }
    } finally {
      setChatSending(false)
    }
  }

  return (
    <div className="h-full px-4 py-4">
      <div className="grid h-[calc(100vh-165px)] grid-cols-1 gap-4 xl:grid-cols-12">
        <section className="xl:col-span-3 rounded-xl border bg-card p-3">
          <h2 className="mb-3 text-sm font-semibold">Чаты</h2>
          <div className="space-y-1">
            <button
              type="button"
              onClick={openGlobal}
              className={cn(
                'flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-sm',
                mode === 'global' ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
              )}
            >
              <Hash className="h-4 w-4" />
              <span>Общий чат</span>
              {(chatUnread?.global_unread_count ?? 0) > 0 && (
                <span className="ml-auto rounded-full bg-primary px-1.5 py-0 text-[10px] text-primary-foreground">
                  {chatUnread?.global_unread_count}
                </span>
              )}
            </button>
            {teamList.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => openDirect(member)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left text-sm',
                  mode === 'direct' && selectedPeer?.id === member.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-accent'
                )}
              >
                <Users className="h-4 w-4" />
                <span className="truncate">{displayUserName(member)}</span>
                {(unreadDirectMap.get(member.id) ?? 0) > 0 && (
                  <span className="ml-auto rounded-full bg-primary px-1.5 py-0 text-[10px] text-primary-foreground">
                    {unreadDirectMap.get(member.id)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>

        <section className="xl:col-span-9 rounded-xl border bg-card p-3">
          <div className="mb-3 flex items-center justify-between gap-3 border-b pb-2">
            <div>
              <h1 className="text-base font-semibold">
                {mode === 'global' ? 'Общий чат команды' : `Личный чат: ${displayUserName(selectedPeer) || '—'}`}
              </h1>
              <p className="text-xs text-muted-foreground">
                {mode === 'global'
                  ? 'Полноэкранный режим, @упоминания и вложения.'
                  : 'Прямой диалог с коллегой, как в мессенджере.'}
              </p>
            </div>
          </div>

          <div ref={messageListRef} className="h-[calc(100%-140px)] overflow-auto rounded-md border bg-background p-3">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">Сообщений пока нет.</p>
            ) : (
              <div className="space-y-2">
                {messages.map((msg) => {
                  const mine = msg.sender_id === currentUser?.id
                  const tone = senderColor(msg.sender_id)
                  return (
                    <div key={msg.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                      <div className={cn('max-w-[82%] rounded border px-2 py-1.5 text-sm', tone, mine && 'ring-1 ring-primary/40')}>
                        <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <button
                            type="button"
                            className="font-medium hover:text-foreground"
                            onClick={() => {
                              if (msg.sender_id !== currentUser?.id) insertMentionByName(displaySenderName(msg))
                            }}
                          >
                            {displaySenderName(msg)}
                          </button>
                          <span>· {formatTime(msg.created_at)}</span>
                        </div>
                        <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                        {!!msg.attachments?.length && (
                          <div className="mt-1 space-y-1">
                            {msg.attachments.map((att) => (
                              <a
                                key={att.id}
                                href={att.download_url}
                                target="_blank"
                                rel="noreferrer"
                                className="block text-[11px] underline text-foreground"
                              >
                                📎 {att.filename}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="relative mt-3 rounded-md border bg-background p-2">
            {mode === 'global' && mentionOpen && mentionCandidates.length > 0 && (
              <div className="absolute bottom-[84px] left-2 z-10 w-[320px] rounded-md border bg-card p-1 shadow-lg">
                {mentionCandidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => insertMention(candidate)}
                    className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
                  >
                    @{mentionLabel(candidate)}
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              rows={3}
              value={chatInput}
              placeholder={
                mode === 'global'
                  ? 'Написать в общий чат... (используйте @имя)'
                  : `Сообщение для ${displayUserName(selectedPeer) || 'коллеги'}...`
              }
              onChange={(e) => {
                const value = e.target.value
                setChatInput(value)
                if (mode === 'global') {
                  detectMention(value, e.target.selectionStart ?? value.length)
                }
              }}
              onClick={(e) => {
                if (mode === 'global') {
                  const target = e.target as HTMLTextAreaElement
                  detectMention(target.value, target.selectionStart ?? target.value.length)
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendMessage()
                }
              }}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <input
                  ref={chatFileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => setChatFile(e.target.files?.[0] ?? null)}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => chatFileRef.current?.click()}>
                  <Paperclip className="h-4 w-4" />
                </Button>
                {chatFile && <p className="truncate text-xs text-muted-foreground">{chatFile.name}</p>}
              </div>
              <Button type="button" size="sm" onClick={() => void sendMessage()} disabled={chatSending || (!chatInput.trim() && !chatFile)}>
                <Send className="mr-1 h-4 w-4" />
                Отправить
              </Button>
            </div>
            {mode === 'global' && (
              <div className="mt-2 flex flex-wrap gap-1 border-t pt-2">
                <span className="text-xs text-muted-foreground">Быстрые упоминания:</span>
                {teamList.slice(0, 6).map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className="rounded border px-1.5 py-0.5 text-xs hover:bg-accent"
                    onClick={() => insertMention(member)}
                  >
                    @{mentionLabel(member)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
