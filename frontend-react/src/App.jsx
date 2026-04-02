import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import BottomNav         from './components/BottomNav'
import HomeScreen        from './screens/HomeScreen'
import WatchlistScreen   from './screens/WatchlistScreen'
import DeepDiveScreen    from './screens/DeepDiveScreen'
import GlobalPulseScreen from './screens/GlobalPulseScreen'
import AlertScreen       from './screens/AlertScreen'
import TrackRecordScreen from './screens/TrackRecordScreen'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"                element={<HomeScreen />} />
        <Route path="/watchlist"       element={<WatchlistScreen />} />
        <Route path="/deepdive"        element={<DeepDiveScreen />} />
        <Route path="/deepdive/:ticker" element={<DeepDiveScreen />} />
        <Route path="/global"          element={<GlobalPulseScreen />} />
        <Route path="/alert"           element={<AlertScreen />} />
        <Route path="/trackrecord"     element={<TrackRecordScreen />} />
      </Routes>
      <BottomNav />
    </BrowserRouter>
  )
}
