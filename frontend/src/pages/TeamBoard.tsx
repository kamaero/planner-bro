import { Button } from '@/components/ui/button'

const TEAM_BOARD_URL = '/excalidraw/#room=plannerbro_team_whiteboard,plannerbro_room_key_22'

export function TeamBoard() {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="rounded-2xl border bg-card p-6">
        <h1 className="text-2xl font-bold mb-3">Доска команды</h1>
        <p className="text-muted-foreground mb-6">
          Единая доска для всей команды. Все участники работают в одном общем пространстве.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => {
              window.location.href = TEAM_BOARD_URL
            }}
          >
            Открыть общую доску
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              window.open(TEAM_BOARD_URL, '_blank', 'noopener,noreferrer')
            }}
          >
            Открыть в новой вкладке
          </Button>
        </div>
      </div>
    </div>
  )
}
