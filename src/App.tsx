import { useEffect } from 'react'
import { useGameStore } from './stores/gameStore'
import { MainMenu } from './components/MainMenu'
import { GameView } from './components/GameView'
import { startupSync } from './sync/syncActions'

function App() {
  const currentGame = useGameStore((s) => s.currentGame)

  // Once sync is set up, Drive holds the games: take them on load.
  useEffect(() => {
    startupSync()
  }, [])

  if (currentGame) {
    return <GameView />
  }

  return <MainMenu />
}

export default App
