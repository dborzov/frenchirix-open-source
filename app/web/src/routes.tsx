// Every route of the app and the screen file it renders. Later steps replace a screen file; they do
// not need to edit this list. `bare` routes are full-screen (no tab bar or rail).
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type Screen = LazyExoticComponent<ComponentType<any>>;

export interface RouteDef {
  path: string;
  screen: Screen;
  bare?: boolean;
}

export const ROUTES: RouteDef[] = [
  { path: '/', screen: lazy(() => import('./screens/Home')) },
  { path: '/unlock', screen: lazy(() => import('./screens/Unlock')) },
  { path: '/practice/:id', screen: lazy(() => import('./screens/Practice')), bare: true },
  { path: '/episodes', screen: lazy(() => import('./screens/Episodes')) },
  { path: '/episodes/:ep', screen: lazy(() => import('./screens/Episode')) },
  { path: '/scene/:id', screen: lazy(() => import('./screens/Scene')) },
  { path: '/karaoke', screen: lazy(() => import('./screens/Karaoke')) },
  { path: '/karaoke/:id', screen: lazy(() => import('./screens/KaraokePlayer')) },
  { path: '/profile', screen: lazy(() => import('./screens/Profile')) },
  { path: '/avatar', screen: lazy(() => import('./screens/AvatarEditor')) },
  { path: '/shop', screen: lazy(() => import('./screens/Shop')) },
  { path: '/chest/:id', screen: lazy(() => import('./screens/Chest')), bare: true },
  { path: '/friends', screen: lazy(() => import('./screens/Friends')) },
  { path: '/league', screen: lazy(() => import('./screens/League')) },
  { path: '/achievements', screen: lazy(() => import('./screens/Achievements')) },
  { path: '/login', screen: lazy(() => import('./screens/Login')), bare: true },
  { path: '/players', screen: lazy(() => import('./screens/Players')), bare: true },
  { path: '/version', screen: lazy(() => import('./screens/Version')) },
  { path: '/dev', screen: lazy(() => import('./screens/dev/DevIndex')) },
  { path: '/dev/scenes', screen: lazy(() => import('./screens/dev/DevScenes')) },
  { path: '/dev/practices', screen: lazy(() => import('./screens/dev/DevPractices')) },
  { path: '/dev/types_of_puzzles', screen: lazy(() => import('./screens/dev/DevPuzzleTypes')) },
  { path: '/dev/panono', screen: lazy(() => import('./screens/dev/DevPractices')) },
  { path: '/dev/speaking', screen: lazy(() => import('./screens/dev/DevSpeaking')) },
  { path: '/dev/ui', screen: lazy(() => import('./screens/dev/DevUi')) },
  { path: '/dev/scene', screen: lazy(() => import('./screens/dev/DevScene')) },
  { path: '/dev/practice', screen: lazy(() => import('./screens/dev/DevPractice')) },
  { path: '/dev/loops', screen: lazy(() => import('./screens/dev/DevLoops')) },
  { path: '/dev/avatar', screen: lazy(() => import('./screens/dev/DevAvatar')) },
];

export const NotFound = lazy(() => import('./screens/NotFound'));
