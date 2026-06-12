import { useGameStore } from './stores/gameStore'
import { MainMenu } from './components/MainMenu'
import { GameView } from './components/GameView'

function App() {
  const currentGame = useGameStore((s) => s.currentGame)

  if (currentGame) {
    return <GameView />
  }

  return <MainMenu />
}

export default App
