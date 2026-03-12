const TEAM_ROOM_ID = 'plannerbro_team_whiteboard'
const TEAM_ROOM_KEY = 'plannerbro_room_key_22'

function buildTeamBoardUrl() {
  const url = new URL('/excalidraw/', window.location.origin)
  url.hash = `room=${TEAM_ROOM_ID},${TEAM_ROOM_KEY}`
  return url.toString()
}

export function TeamBoard() {
  const boardUrl = buildTeamBoardUrl()

  return (
    <div className="h-[calc(100vh-1rem)] p-2">
      <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">Доска команды</h1>
            <p className="text-xs text-muted-foreground">
              Общая живая доска команды открывается сразу внутри PlannerBro.
            </p>
          </div>
          <a
            href={boardUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-accent"
          >
            В новой вкладке
          </a>
        </div>

        <iframe
          key={boardUrl}
          src={boardUrl}
          title="Доска команды"
          referrerPolicy="no-referrer"
          className="min-h-0 w-full flex-1 bg-background"
        />
      </div>
    </div>
  )
}
