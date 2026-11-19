// Installing the app and updating it (docs/app-release.md, "Installing" and "Updates").
// main.tsx imports './pwa/boot' once; screens mount InstallButton (Profile), InstallOffer (Home) and
// BuildStamp (/version). The mascot is DruidMark (drawing in druid.ts, also the source of the icons).
export { BuildStamp } from './BuildStamp';
export { DruidMark } from './DruidMark';
export { InstallButton, InstallOffer, InstallSheet } from './InstallPanel';
export { isStandalone } from './install';
export { BUILD, holdUpdates } from './update';
